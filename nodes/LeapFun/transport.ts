import type {
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, sleep } from 'n8n-workflow';

const CREDENTIAL_NAME = 'leapFunApi';
const MAX_RETRIES = 3;

interface LeapFunErrorBody {
	error?: {
		type?: string;
		code?: number;
		message?: string;
		param?: string | null;
		request_id?: string;
	};
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

function parseErrorBody(body: unknown): LeapFunErrorBody['error'] | undefined {
	try {
		if (Buffer.isBuffer(body)) {
			return (JSON.parse(body.toString('utf8')) as LeapFunErrorBody).error;
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

/**
 * Turn an HTTP failure into a NodeApiError with a message that says what happened
 * and how to continue (n8n UX guidelines: no "error/failure" wording, actionable).
 */
export function toNodeError(ctx: IExecuteFunctions | ILoadOptionsFunctions, err: unknown, itemIndex?: number): NodeApiError {
	const e = err as {
		httpCode?: string | number;
		statusCode?: number;
		response?: { status?: number; body?: unknown; headers?: Record<string, string> };
		message?: string;
		cause?: { response?: { status?: number; body?: unknown } };
	};
	const status = Number(e.httpCode ?? e.statusCode ?? e.response?.status ?? e.cause?.response?.status ?? 0);
	const body = parseErrorBody(e.response?.body ?? e.cause?.response?.body);
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
			break;
		default:
			message = `${prefix}${body?.message ?? 'LeapFun did not return audio. Retry in a moment.'}`;
			if (body?.request_id) description = `Reference: ${body.request_id}`;
	}
	return new NodeApiError(ctx.getNode(), (err as JsonObject) ?? {}, {
		message,
		description,
		httpCode: status ? String(status) : undefined,
		itemIndex,
	});
}

function statusOf(err: unknown): number {
	const e = err as { httpCode?: string | number; statusCode?: number; response?: { status?: number } };
	return Number(e.httpCode ?? e.statusCode ?? e.response?.status ?? 0);
}

function retryAfterMs(err: unknown, attempt: number): number {
	const e = err as { response?: { headers?: Record<string, string> } };
	const ra = Number(e.response?.headers?.['retry-after']);
	if (Number.isFinite(ra) && ra > 0) return Math.min(ra, 30) * 1000;
	return 1000 * 2 ** attempt;
}

/** JSON request with auth; retries 429/5xx with backoff (Retry-After honoured). */
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
	let lastErr: unknown;
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			return (await ctx.helpers.httpRequestWithAuthentication.call(ctx, CREDENTIAL_NAME, options)) as T;
		} catch (err) {
			lastErr = err;
			const status = statusOf(err);
			if ((status === 429 || status >= 500) && attempt < MAX_RETRIES) {
				await sleep(retryAfterMs(err, attempt));
				continue;
			}
			throw toNodeError(ctx, err, itemIndex);
		}
	}
	throw toNodeError(ctx, lastErr, itemIndex);
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
		json: true,
		encoding: 'arraybuffer',
		returnFullResponse: true,
	};
	let lastErr: unknown;
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			const resp = (await ctx.helpers.httpRequestWithAuthentication.call(ctx, CREDENTIAL_NAME, options)) as {
				body: ArrayBuffer | Buffer;
				headers: Record<string, string>;
			};
			const headers = Object.fromEntries(
				Object.entries(resp.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
			);
			const mimeType = (headers['content-type'] || 'audio/mpeg').split(';')[0].trim();
			return {
				audio: Buffer.isBuffer(resp.body) ? resp.body : Buffer.from(resp.body as ArrayBuffer),
				mimeType,
				jobId: headers['x-job-id'] ?? '',
				creditsUsed: Number(headers['x-credits-used'] ?? 0),
				engine: headers['x-engine'] ?? '',
				engineVariant: headers['x-engine-variant'] ?? '',
				ignoredParams: headers['x-ignored-params'] ? headers['x-ignored-params'].split(',') : [],
				degraded: headers['x-audio-degraded'] === '1',
			};
		} catch (err) {
			lastErr = err;
			const status = statusOf(err);
			if ((status === 429 || status >= 500) && attempt < MAX_RETRIES) {
				await sleep(retryAfterMs(err, attempt));
				continue;
			}
			throw toNodeError(ctx, err, itemIndex);
		}
	}
	throw toNodeError(ctx, lastErr, itemIndex);
}
