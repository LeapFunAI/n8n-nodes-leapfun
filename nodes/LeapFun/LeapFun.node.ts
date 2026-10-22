import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	speechFields,
	speechOperations,
	usageOperations,
	voiceFields,
	voiceOperations,
} from './descriptions';
import { apiRequest, isHttpError, speechRequest, toNodeError, toOperationError } from './transport';

interface VoiceRow {
	voice?: string;
	voice_id?: string;
	name: string;
	engines: string[];
	lang?: string;
	gender?: string;
	type: string;
}

interface VoicesResponse {
	voices: VoiceRow[];
	count: number;
}

export class LeapFun implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'LeapFun',
		name: 'leapFun',
		icon: { light: 'file:leapfun.svg', dark: 'file:leapfun.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Generate speech with LeapFun AI text-to-speech',
		defaults: { name: 'LeapFun' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'leapFunApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Speech', value: 'speech' },
					{ name: 'Voice', value: 'voice' },
					{ name: 'Usage', value: 'usage' },
				],
				default: 'speech',
			},
			...speechOperations,
			...speechFields,
			...voiceOperations,
			...voiceFields,
			...usageOperations,
		],
	};

	methods = {
		listSearch: {
			async searchVoices(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
				let engine = this.getCurrentNodeParameter('engine') as string | undefined;
				// An unresolved expression (e.g. "={{ $json.engine }}") cannot filter the list; show all voices.
				if (engine && engine.startsWith('=')) engine = undefined;
				const data = await apiRequest<VoicesResponse>(this, 'GET', '/voices', undefined, {
					engine: engine || undefined,
					q: filter || undefined,
					type: 'preset',
				});
				const results = data.voices
					.filter((v) => v.voice)
					.map((v) => ({
						name: `${v.name}${v.gender ? ` · ${v.gender}` : ''}${v.lang && v.lang !== 'multi' ? ` · ${v.lang}` : ''}`,
						value: v.voice as string,
					}));
				return { results };
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				if (resource === 'speech' && operation === 'generate') {
					returnData.push(await generateSpeech.call(this, i));
				} else if (resource === 'voice' && operation === 'getAll') {
					returnData.push(...(await getVoices.call(this, i)));
				} else if (resource === 'usage' && operation === 'get') {
					const usage = await apiRequest<IDataObject>(this, 'GET', '/usage', undefined, undefined, i);
					returnData.push({ json: usage, pairedItem: { item: i } });
				} else {
					throw new NodeOperationError(this.getNode(), `The operation "${operation}" is not supported for resource "${resource}"`, {
						itemIndex: i,
					});
				}
			} catch (err) {
				let nodeError: NodeOperationError | NodeApiError;
				if (err instanceof NodeOperationError || err instanceof NodeApiError) nodeError = err;
				else if (isHttpError(err)) nodeError = toNodeError(this, err, i);
				else nodeError = toOperationError(this, err, i);
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: nodeError.message, description: nodeError.description ?? undefined },
						pairedItem: { item: i },
					});
					continue;
				}
				throw nodeError;
			}
		}
		return [returnData];
	}
}

async function generateSpeech(this: IExecuteFunctions, i: number): Promise<INodeExecutionData> {
	const text = this.getNodeParameter('text', i) as string;
	const engine = this.getNodeParameter('engine', i) as string;
	const voiceSource = this.getNodeParameter('voiceSource', i, 'preset') as string;
	const options = this.getNodeParameter('options', i, {}) as {
		speed?: number;
		emotion?: string;
		style?: string;
		pace?: string;
		accent?: string;
		note?: string;
		exaggeration?: number;
		format?: 'mp3' | 'wav';
		binaryPropertyName?: string;
		fileName?: string;
	};

	if (!text || !text.trim()) {
		throw new NodeOperationError(this.getNode(), 'The Text parameter is empty. Map the text you want spoken.', {
			itemIndex: i,
		});
	}

	const body: Record<string, unknown> = {
		text,
		engine,
		format: options.format ?? 'mp3',
	};
	if (voiceSource === 'mine') {
		body.voice_id = this.getNodeParameter('voiceId', i) as string;
	} else {
		const voice = this.getNodeParameter('voice', i, '', { extractValue: true }) as string;
		if (voice) body.voice = voice;
	}
	if (options.speed !== undefined) body.speed = options.speed;
	// Sent whenever the option is present, including 'neutral' (the API treats neutral as a no-op,
	// so a user can explicitly force neutral delivery).
	if (options.emotion) body.emotion = options.emotion;
	if (options.style) body.style = options.style;
	if (options.pace) body.pace = options.pace;
	if (options.accent) body.accent = options.accent;
	if (options.note && options.note.trim()) body.note = options.note.trim();
	if (options.exaggeration !== undefined && engine === 'expressive') body.exaggeration = options.exaggeration;

	const result = await speechRequest(this, '/tts', body, i);
	const ext = result.mimeType.includes('wav') ? 'wav' : 'mp3';
	const fileName = (options.fileName && options.fileName.trim()) || `speech-${result.jobId || i}.${ext}`;
	const binaryPropertyName = options.binaryPropertyName || 'data';
	const binary = await this.helpers.prepareBinaryData(result.audio, fileName, result.mimeType);

	return {
		json: {
			jobId: result.jobId,
			creditsUsed: result.creditsUsed,
			engine: result.engine || engine,
			engineVariant: result.engineVariant,
			voice: body.voice ?? body.voice_id ?? null,
			format: ext,
			characters: text.length,
			utf8Bytes: Buffer.byteLength(text, 'utf8'),
			ignoredParams: result.ignoredParams,
			degraded: result.degraded,
		},
		binary: { [binaryPropertyName]: binary },
		pairedItem: { item: i },
	};
}

async function getVoices(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', i, true) as boolean;
	const limit = this.getNodeParameter('limit', i, 50) as number;
	const filters = this.getNodeParameter('filters', i, {}) as Record<string, string>;
	const data = await apiRequest<VoicesResponse>(
		this,
		'GET',
		'/voices',
		undefined,
		{
			engine: filters.engine || undefined,
			gender: filters.gender || undefined,
			lang: filters.lang || undefined,
			q: filters.q || undefined,
			type: filters.type || undefined,
		},
		i,
	);
	const rows = returnAll ? data.voices : data.voices.slice(0, limit);
	return rows.map((v) => ({ json: v as unknown as IDataObject, pairedItem: { item: i } }));
}
