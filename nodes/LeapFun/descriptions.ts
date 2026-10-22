import type { INodeProperties } from 'n8n-workflow';

export const ENGINE_OPTIONS = [
	{
		name: 'Ultra',
		value: 'ultra',
		description: 'Cinematic expressiveness, 130+ languages, director\'s notes. 1.5 credits per UTF-8 byte.',
	},
	{
		name: 'Pro',
		value: 'pro',
		description: 'Natural multilingual voices with emotion directives. 1 credit per character or byte.',
	},
	{
		name: 'Expressive',
		value: 'expressive',
		description: 'Expressive English voices; cloned voices speak 23 languages. 1 credit per character.',
	},
	{
		name: 'Turbo',
		value: 'turbo',
		description: 'Fastest and most economical. 0.5 credits per character.',
	},
];

const DIRECTOR_ENGINES = ['ultra', 'pro'];

export const speechOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['speech'] } },
		options: [
			{
				name: 'Generate',
				value: 'generate',
				action: 'Generate speech from text',
				description: 'Convert up to 5,000 characters of text into an audio file',
			},
		],
		default: 'generate',
	},
];

export const speechFields: INodeProperties[] = [
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		required: true,
		placeholder: 'e.g. Welcome back to the show. Today we are talking about…',
		description: 'The text to speak, up to 5,000 characters per item',
		displayOptions: { show: { resource: ['speech'], operation: ['generate'] } },
	},
	{
		displayName: 'Engine',
		name: 'engine',
		type: 'options',
		options: ENGINE_OPTIONS,
		default: 'ultra',
		description: 'Engine tier. Pro routes automatically by the voice you pick.',
		displayOptions: { show: { resource: ['speech'], operation: ['generate'] } },
	},
	{
		displayName: 'Voice Source',
		name: 'voiceSource',
		type: 'options',
		options: [
			{ name: 'Preset Voice', value: 'preset' },
			{ name: 'My Cloned / Designed Voice', value: 'mine' },
		],
		default: 'preset',
		description: 'Whether to use a LeapFun preset voice or a voice from your own workspace',
		displayOptions: { show: { resource: ['speech'], operation: ['generate'] } },
	},
	{
		displayName: 'Voice',
		name: 'voice',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'Preset voice. The list is filtered by the selected engine.',
		// Re-fetch the list when Engine changes, and let the UI resolve an Engine expression first.
		typeOptions: { loadOptionsDependsOn: ['engine'] },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchVoices', searchable: true },
			},
			{
				displayName: 'By Slug',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. aurora',
			},
		],
		displayOptions: { show: { resource: ['speech'], operation: ['generate'], voiceSource: ['preset'] } },
	},
	{
		displayName: 'Voice ID',
		name: 'voiceId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 3f9c2a…',
		description: 'ID of a cloned or designed voice in your workspace (Voice → Get Many with Type = Cloned lists them)',
		displayOptions: { show: { resource: ['speech'], operation: ['generate'], voiceSource: ['mine'] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: { show: { resource: ['speech'], operation: ['generate'] } },
		options: [
			{
				displayName: 'Accent',
				name: 'accent',
				type: 'options',
				options: [
					{ name: 'American', value: 'american' },
					{ name: 'Australian', value: 'australian' },
					{ name: 'British', value: 'british' },
					{ name: 'None', value: '' },
				],
				default: '',
				description: 'Director accent preset for English (Ultra, and Pro with Ultra-shared voices)',
				displayOptions: { show: { '/engine': DIRECTOR_ENGINES } },
			},
			{
				displayName: "Director's Note",
				name: 'note',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
				placeholder: 'e.g. Warm and unhurried, like a late-night radio host',
				description: 'Free-text direction for emotion, delivery and tone, up to 300 characters (Ultra and Pro)',
				displayOptions: { show: { '/engine': DIRECTOR_ENGINES } },
			},
			{
				displayName: 'Emotion',
				name: 'emotion',
				type: 'options',
				options: [
					{ name: 'Angry', value: 'angry' },
					{ name: 'Calm', value: 'calm' },
					{ name: 'Gentle', value: 'gentle' },
					{ name: 'Happy', value: 'happy' },
					{ name: 'Neutral', value: 'neutral' },
					{ name: 'Sad', value: 'sad' },
					{ name: 'Serious', value: 'serious' },
					{ name: 'Surprised', value: 'surprised' },
				],
				default: 'neutral',
				description: 'Overall emotion (Pro and Ultra). Ignored by Turbo.',
				displayOptions: { show: { '/engine': DIRECTOR_ENGINES } },
			},
			{
				displayName: 'Exaggeration',
				name: 'exaggeration',
				type: 'number',
				typeOptions: { minValue: 0.25, maxValue: 2, numberPrecision: 2 },
				default: 0.5,
				description: 'Emotion intensity for Expressive voices',
				displayOptions: { show: { '/engine': ['expressive'] } },
			},
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				placeholder: 'e.g. intro.mp3',
				description: 'File name for the audio. Leave empty for speech-&lt;job ID&gt;.&lt;ext&gt;.',
			},
			{
				displayName: 'Output Format',
				name: 'format',
				type: 'options',
				options: [
					{ name: 'MP3', value: 'mp3' },
					{ name: 'WAV', value: 'wav' },
				],
				default: 'mp3',
				description: 'Audio container of the returned file',
			},
			{
				displayName: 'Pace',
				name: 'pace',
				type: 'options',
				options: [
					{ name: 'Natural', value: 'natural' },
					{ name: 'None', value: '' },
					{ name: 'Rapid Fire', value: 'rapid' },
					{ name: 'Staccato', value: 'staccato' },
					{ name: 'The Drift', value: 'drift' },
				],
				default: '',
				description: 'Director pace preset (Ultra, and Pro with Ultra-shared voices)',
				displayOptions: { show: { '/engine': DIRECTOR_ENGINES } },
			},
			{
				displayName: 'Put Output File in Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Name of the binary property that will hold the audio file',
			},
			{
				displayName: 'Speed',
				name: 'speed',
				type: 'number',
				typeOptions: { minValue: 0.5, maxValue: 2, numberPrecision: 2 },
				default: 1,
				description: 'Speaking rate multiplier from 0.5 to 2',
			},
			{
				displayName: 'Style',
				name: 'style',
				type: 'options',
				options: [
					{ name: 'Deadpan', value: 'deadpan' },
					{ name: 'Hype Promo', value: 'hype' },
					{ name: 'Newscaster', value: 'newscaster' },
					{ name: 'None', value: '' },
					{ name: 'Storyteller', value: 'storyteller' },
					{ name: 'Vocal Smile', value: 'smile' },
					{ name: 'Whisper', value: 'whisper' },
				],
				default: '',
				description: 'Director style preset (Ultra, and Pro with Ultra-shared voices)',
				displayOptions: { show: { '/engine': DIRECTOR_ENGINES } },
			},
		],
	},
];

export const voiceOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['voice'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many voices',
				description: 'List preset voices and the cloned voices in your workspace',
			},
		],
		default: 'getAll',
	},
];

export const voiceFields: INodeProperties[] = [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: true,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['voice'], operation: ['getAll'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['voice'], operation: ['getAll'], returnAll: [false] } },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add filter',
		default: {},
		displayOptions: { show: { resource: ['voice'], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Engine',
				name: 'engine',
				type: 'options',
				options: [{ name: 'Any', value: '' }, ...ENGINE_OPTIONS],
				default: '',
			},
			{
				displayName: 'Gender',
				name: 'gender',
				type: 'options',
				options: [
					{ name: 'Any', value: '' },
					{ name: 'Female', value: 'female' },
					{ name: 'Male', value: 'male' },
				],
				default: '',
			},
			{
				displayName: 'Language',
				name: 'lang',
				type: 'string',
				default: '',
				placeholder: 'e.g. en',
				description: 'ISO language code. Multilingual voices always match.',
			},
			{
				displayName: 'Search',
				name: 'q',
				type: 'string',
				default: '',
				placeholder: 'e.g. aurora',
				description: 'Match on voice name or slug',
			},
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				options: [
					{ name: 'All', value: '' },
					{ name: 'Preset', value: 'preset' },
					{ name: 'Cloned', value: 'cloned' },
				],
				default: '',
			},
		],
	},
];

export const usageOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['usage'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Get usage and quota',
				description: 'Credits used and remaining in the current billing period',
			},
		],
		default: 'get',
	},
];
