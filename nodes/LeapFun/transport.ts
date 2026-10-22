import type {
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

const CREDENTIAL_NAME = 'leapFunApi';
const MAX_RETRIES = 3;
// The LeapFun API refunds the credit reservation before answering 5xx, and 503 is raised
// before any reservation, so retrying these cannot double-bill. 4xx are never retried.
const RETRY_STATUSES = new Set([429, 502, 503, 504]);

interface LeapFunErrorBody {
	error?: {
		type?: string;
		code?: number;
		message?: string;
		param?: string | null;
		request_id?: string;
	};
}

/** Shape of the axios error that n8n keeps on `NodeApiError.cause`. */
interface AxiosLike {
	response?: {
		status?: number;
		data?: unknown;
		headers?: Record<string, unknown>;
	};
	message?: string;
}

export interface AudioResult {
	audio: Buffer;
	mimeType: string;
	jobId: string;
	creditsUsed: number;
	engine: string;
	engineVariant: string;
	ignoredParams: string[];
	degraded: boolean;
}

async function baseUrl(ctx: IExecuteFunctions | ILoadOptionsFunctions): Promise<string> {
	const creds = (await ctx.getCredentials(CREDENTIAL_NAME)) as { baseUrl?: string };
	return (creds.baseUrl || 'https://api.leapfun.ai/v1').replace(/\/+$/, '');
}

function axiosOf(err: unknown): AxiosLike | undefined {
	const e = err as { cause?: unknown; response?: unknown };
	// httpRequestWithAuthentication throws NodeApiError whose `cause` is the axios error;
	// fall back to the object itself in case a raw axios error ever surfaces.
	const cause = e?.cause as AxiosLike | undefined;
	if (cause && typeof cause === 'object' && 'response' in cause) return cause;
	if (e && typeof e === 'object' && 'response' in e) return e as AxiosLike;
	return undefined;
}

function statusOf(err: unknown): number {
	const e = err as { httpCode?: string | number | null; statusCode?: number };
	const fromNode = Number(e?.httpCode ?? e?.statusCode ?? 0);
	if (fromNode) return fromNode;
	return Number(axiosOf(err)?.response?.status ?? 0);
}

function parseErrorBody(body: unknown): LeapFunErrorBody['error'] | undefined {
	try {
		if (Buffer.isBuffer(body)) {
			return (JSON.parse(body.toString('utf8')) as LeapFunErrorBody).error;
		}
		if (body instanceof ArrayBuffer) {
			return (JSON.parse(Buffer.from(body).toString('utf8')) as LeapFunErrorBody).error;
		}
		if (typeof body === 'string') {
			return (JSON.parse(body) as LeapFunErrorBody).error;
		}
		if (body && typeof body === 'object') {
			return (body as LeapFunErrorBody).error;
		}
	} catch {
		// not JSON — fall through
	}
	return undefined;
}

function retryAfterMs(err: unknown, attempt: number): number {
	const headers = axiosOf(err)?.response?.headers ?? {};
	const raw = headers['retry-after'] ?? headers['Retry-After'];
	const ra = Number(raw);
	if (Number.isFinite(ra) && ra > 0) return Math.min(ra, 30) * 1000;
	return 1000 * 2 ** attempt;
}

/**
 * Turn an HTTP failure into a NodeApiError whose message says what happened and how to
 * continue (n8n UX guidelines). The thrown object is already a NodeApiError, and
 * `new NodeApiError(node, existingNodeApiError, …)` returns it unchanged, so we build the
 * error from a plain object carrying the API's own error body instead.
 */
export function toNodeError(ctx: IExecuteFunctions | ILoadOptionsFunctions, err: unknown, itemIndex?: number): NodeApiError {
	const status = statusOf(err);
	const body = parseErrorBody(axiosOf(err)?.response?.data);
	const prefix = itemIndex !== undefined ? `[Item ${itemIndex}] ` : '';

	let message: string;
	let description: string | undefined = body?.message;
	switch (status) {
		case 401:
			message = `${prefix}The API key was not accepted. Check the LeapFun credential.`;
			break;
		case 402:
			message = `${prefix}Not enough credits for this request. Top up at app.leapfun.ai/billing.`;
			break;
		case 403:
			message = `${prefix}Your LeapFun plan does not include API access. Upgrade at leapfun.ai/pricing.`;
			break;
		case 404:
			message = `${prefix}${body?.message ?? 'The requested voice was not found. Pick one from the Voice list.'}`;
			break;
		case 413:
			message = `${prefix}The text is longer than 5,000 characters. Split it into smaller items.`;
			break;
		case 429:
			message = `${prefix}LeapFun rate limit reached. Add a Wait node or reduce parallel items.`;
			break;
		case 400:
			message = `${prefix}${body?.message ?? 'LeapFun rejected the request. Check the parameters.'}`;
			if (body?.param) description = `Parameter: ${body.param}`;
			break;
		case 503:
			message = `${prefix}LeapFun is busy right now. Retry in a few seconds.`;
			break;
		default:
			message = `${prefix}${body?.message ?? 'LeapFun did not return audio. Retry in a moment.'}`;
	}
	if (body?.request_id) description = `${description ? `${description} · ` : ''}Reference: ${body.request_id}`;

	const source: JsonObject = {
		message: body?.message ?? (err as Error)?.message ?? 'Request failed',
		status,
		type: body?.type ?? null,
		param: body?.param ?? null,
		request_id: body?.request_id ?? null,
	};
	return new NodeApiError(ctx.getNode(), source, {
		message,
		description,
		httpCode: status ? String(status) : undefined,
		itemIndex,
	});
}

/** Non-HTTP failures (unexpected payload shape, programming errors) → NodeOperationError. */
export function toOperationError(ctx: IExecuteFunctions, err: unknown, itemIndex: number): NodeOperationError {
	const e = err instanceof Error ? err : new Error(String(err));
	return new NodeOperationError(ctx.getNode(), e, {
		itemIndex,
		description: 'The LeapFun API answered in an unexpected shape. Update the node or contact support@leapfun.ai.',
	});
}

export function isHttpError(err: unknown): boolean {
	return statusOf(err) > 0;
}

async function withRetry<T>(fn: () => Promise<T>, ctx: IExecuteFunctions | ILoadOptionsFunctions, itemIndex?: number): Promise<T> {
	let lastErr: unknown;
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastErr = err;
			const status = statusOf(err);
			if (RETRY_STATUSES.has(status) && attempt < MAX_RETRIES) {
				await sleep(retryAfterMs(err, attempt));
				continue;
			}
			throw toNodeError(ctx, err, itemIndex);
		}
	}
	throw toNodeError(ctx, lastErr, itemIndex);
}

/** JSON request with auth; retries 429/502/503/504 with backoff (Retry-After honoured). */
export async function apiRequest<T = unknown>(
	ctx: IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	path: string,
	body?: Record<string, unknown>,
	qs?: Record<string, string | number | boolean | undefined>,
	itemIndex?: number,
): Promise<T> {
	const url = `${await baseUrl(ctx)}${path}`;
	const options: IHttpRequestOptions = { method, url, json: true };
	if (body) options.body = body;
	if (qs) {
		options.qs = Object.fromEntries(Object.entries(qs).filter(([, v]) => v !== undefined && v !== ''));
	}
	return withRetry(
		async () => (await ctx.helpers.httpRequestWithAuthentication.call(ctx, CREDENTIAL_NAME, options)) as T,
		ctx,
		itemIndex,
	);
}

/** POST that returns audio bytes plus the LeapFun accounting headers. */
export async function speechRequest(
	ctx: IExecuteFunctions,
	path: string,
	body: Record<string, unknown>,
	itemIndex?: number,
): Promise<AudioResult> {
	const url = `${await baseUrl(ctx)}${path}`;
	const options: IHttpRequestOptions = {
		method: 'POST',
		url,
		body,
		// Not `json: true`: that would send `Accept: application/json` to an endpoint that answers
		// with audio. axios still serialises the plain-object body as JSON.
		headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg, audio/wav, application/json' },
		encoding: 'arraybuffer',
		returnFullResponse: true,
	};
	return withRetry(
		async () => {
			const resp = (await ctx.helpers.httpRequestWithAuthentication.call(ctx, CREDENTIAL_NAME, options)) as {
				body: ArrayBuffer | Buffer | string;
				headers: Record<string, unknown>;
			};
			const headers = Object.fromEntries(
				Object.entries(resp.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
			);
			const mimeType = (headers['content-type'] || 'audio/mpeg').split(';')[0].trim();
			let audio: Buffer;
			if (Buffer.isBuffer(resp.body)) audio = resp.body;
			else if (typeof resp.body === 'string') audio = Buffer.from(resp.body, 'binary');
			else audio = Buffer.from(resp.body as ArrayBuffer);
			return {
				audio,
				mimeType,
				jobId: headers['x-job-id'] ?? '',
				creditsUsed: Number(headers['x-credits-used'] ?? 0),
				engine: headers['x-engine'] ?? '',
				engineVariant: headers['x-engine-variant'] ?? '',
				ignoredParams: headers['x-ignored-params'] ? headers['x-ignored-params'].split(',') : [],
				degraded: headers['x-audio-degraded'] === '1',
			};
		},
		ctx,
		itemIndex,
	);
}
