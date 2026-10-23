import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class LeapFunApi implements ICredentialType {
	name = 'leapFunApi';

	displayName = 'LeapFun API';

	icon: Icon = { light: 'file:../nodes/LeapFun/leapfun.svg', dark: 'file:../nodes/LeapFun/leapfun.dark.svg' };

	documentationUrl = 'https://leapfun.ai/developers/n8n/';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Create a key in LeapFun under Settings → Developer API (available on every plan). Keys start with lf_sk_.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.leapfun.ai/v1',
			description: 'Leave the default unless you were given a different API host',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/usage',
		},
	};
}
