# n8n-nodes-leapfun

This is an n8n community node for [LeapFun AI](https://leapfun.ai), a text-to-speech service with four engine tiers, 100+ voices, 130+ languages and director's notes that steer emotion, pace and accent in plain English.

[n8n](https://n8n.io/) is a fair-code licensed workflow automation platform.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Usage](#usage) · [Example workflows](#example-workflows) · [Compatibility](#compatibility) · [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation. Search for `n8n-nodes-leapfun` in **Settings → Community Nodes**.

To use the node as a tool inside an AI Agent on a self-hosted instance, start n8n with `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true`. Note that an agent only receives the JSON part of the output (job ID, credits, engine); the audio file lands on the item's binary property, so route it to a storage node in the same workflow.

## Credentials

1. Sign in to [app.leapfun.ai](https://app.leapfun.ai). Every plan includes the API, Free too; higher plans get higher rate limits, and commercial use of the audio starts on Starter.
2. Open **Settings → Developer API** and click **Create key**. Keys start with `lf_sk_` and are shown once.
3. In n8n, create a **LeapFun API** credential and paste the key. Leave **Base URL** at `https://api.leapfun.ai/v1`.

The credential test calls `GET /v1/usage`, so a green check also confirms that your plan includes API access. API calls spend the same credits as the LeapFun app.

## Operations

| Resource | Operation | What it does |
| --- | --- | --- |
| Speech | Generate | Converts up to 5,000 characters into an MP3 or WAV file on the item's binary property (default `data`). The JSON output carries `jobId`, `creditsUsed`, `engine`, `voice`, `format` and `ignoredParams`. |
| Voice | Get Many | Lists preset voices and the cloned/designed voices in your workspace, with filters for engine, gender, language, search text and type. |
| Usage | Get | Returns credits used and remaining in the current billing period and your per-minute rate limit. |

### Engines

| Engine | Best for | Billing |
| --- | --- | --- |
| Ultra | Cinematic narration, ads, character work; director's notes | 1.5 credits per UTF-8 byte |
| Pro | Natural multilingual voices with emotion directives | 1 credit per character (or per byte on Ultra-shared voices) |
| Expressive | Expressive English voices; cloned voices speak 23 languages | 1 credit per character |
| Turbo | Fast, economical narration in 9 languages | 0.5 credits per character |

Pick the engine first; the **Voice** list is filtered to voices available on that engine. Ultra voices are also available on Pro at standard-tier billing.

### Director's notes (Ultra and Pro)

Under **Options** you can set a **Style** (newscaster, vocal smile, whisper, storyteller, hype promo, deadpan), a **Pace** (natural, rapid fire, the drift, staccato), an **Accent** (American, British, Australian) and a free-text **Director's Note** of up to 300 characters, for example "warm and unhurried, like a late-night radio host". Options that a voice cannot honour are ignored and listed in `ignoredParams` rather than stopping the workflow.

## Usage

A typical flow is **Trigger → write or fetch text → LeapFun (Speech → Generate) → store the file**. The audio lands on the binary property named in **Put Output File in Field** (default `data`), ready for Google Drive, Dropbox, S3, Telegram, or the Write Binary File node.

Error messages tell you what to do next:

| HTTP | Message |
| --- | --- |
| 401 | The API key was not accepted. Check the LeapFun credential. |
| 402 | Not enough credits for this request. Top up at app.leapfun.ai/billing. |
| 403 | LeapFun refused this request for your plan or workspace role. Check leapfun.ai/pricing or ask a workspace admin. |
| 413 | The text is longer than 5,000 characters. Split it into smaller items. |
| 429 | LeapFun rate limit reached. The node retries up to three times, honouring `Retry-After`, before surfacing this. |
| 502 / 503 | Engine or API busy. Retried up to three times; LeapFun refunds credits before answering 5xx, so retries never double-bill. |

Turn on **Continue On Fail** to receive these as JSON on the failing item instead of stopping the workflow.

## Example workflows

Import any JSON from the [`examples`](./examples) folder via **Workflow → Import from File**:

1. `rss-to-voiceover.json`: RSS feed → OpenAI writes a 60-second script → LeapFun Ultra with a director's note → Google Drive.
2. `sheet-batch-narration.json`: Google Sheets rows → LeapFun Pro per row → file back to Google Drive.
3. `telegram-text-to-voice.json`: Telegram message text → LeapFun Turbo → voice reply.

## Compatibility

Built and tested against n8n 1.100 and later with `n8n-workflow` 2.x. Requires Node.js 20.15 or newer for local development.

## Resources

- [LeapFun developer docs](https://leapfun.ai/developers/)
- [LeapFun API reference](https://api.leapfun.ai/v1/openapi.json)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## Development

```bash
npm install
npm run lint
npm run build
npm run dev   # starts a local n8n with the node loaded (Docker required on n8n 3.x)
```

Releases are published from GitHub Actions with npm provenance (`npm run release`). Local `npm publish` is not used.

## License

[MIT](LICENSE.md)
