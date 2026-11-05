# SessionPath public assistant

The assistant interprets requests. SessionPath's existing deterministic forecast
engine remains the only source of prices, probabilities and indicator codes.
No model-generated forecast numbers or Pine code are accepted.
The separate opt-in screenshot route returns bounded visual descriptions only;
it never calls the forecast adapter or generates a trading recommendation.

The Worker uses only `nvidia/nemotron-3.5-super-vl:free`, without a fallback array,
plugins or user-selected models. The official OpenRouter model catalog verified
zero prompt/completion pricing, optional reasoning and structured-output support
for this exact free variant. `OPENROUTER_API_KEY` must be configured as a Worker secret, never in
GitHub Pages or browser JavaScript. An unavailable free model is an explicit
error; it never falls back to paid inference. Exact commands such as
`CL 03-05 range` and recognized direct requests with dates use a local parser
and are labeled `rules`; other natural language uses the real OpenRouter request
and is labeled `openrouter`.

Intent classification explicitly sends `reasoning: {enabled: false}` while
retaining a 512-token output cap. Some free reasoning models
otherwise consume the entire cap before returning JSON; hiding reasoning text
alone does not prevent that consumption. Output-limit and empty-result failures
have fixed error codes without returning provider reasoning, usage or raw text.
The exact free variant is pinned because the dynamic free router rejected the
reasoning-control combination in an actual request. There is no automatic model
substitution if this pinned free endpoint becomes unavailable.

## Request and response

`POST /api/chat`, `Content-Type: application/json`:

```json
{"message":"CL 03-05 range","context":{"market":"CL","window":"03:00-05:00"}}
```

```json
{"ok":true,"action":"forecast","market":"CL","window":"03:00-05:00","concept":null,"date":null,"message":"I will read the forecast, historical probabilities and available export code from SessionPath for this market and window.","interpreter":"rules"}
```

Supported markets: CL/NQ/ES/GC. Windows: 03:00-05:00, 05:00-08:30,
08:30-16:00 (New York). Actions: forecast/explain/clarify. Explanation concepts:
mean_box/containment/avr_expansion/extension. Unknown input/output fields are
rejected. Messages are limited to 600 characters, HTTP bodies to 3 KiB, upstream
responses to 24 KiB and an upstream attempt to 15 seconds. No automatic retries.

### Requested trading dates

`context.date` is optional for existing clients and accepts `null` (live/current)
or a real `YYYY-MM-DD` date on or before today's New York date. Every successful
intent now includes `date`. The model's strict schema requires it, while older
intents omitting it are normalized to the server's resolved date.
Sending `context.date` explicitly, including `null`, also declares that the
client can handle dated results. An older cached client omitting that field
can still request a live forecast, but dated requests receive a clarification
asking it to reload. This prevents a cached UI from dropping `response.date`
and silently fetching today's data for a historical request. The capability
flag is internal and is never forwarded to the AI or returned as an intent.

Examples include `can you fetch the CL 03-05 code of 2nd Nov?`,
`NQ 05-0830 on September 17th, 2024`, `GC 0830-1600 2025-06-23`,
and `請給我CL 03-05的11月2日代碼`. ISO dates, English full/abbreviated
month names and ordinals, and Chinese Arabic/Chinese-numeral month/day forms
are resolved locally, independently of the AI. When a year is omitted, use the
most recent valid calendar date on/before New York today; leap-day requests use
the latest applicable leap year. The full resolved year is returned for display.

Commands without an explicit date inherit `context.date`; `today`, `now`,
`今天` or `現在` clear a historical context to live mode. Yesterday means the
previous calendar date; it does not silently substitute a different trading day.
Invalid dates, explicit future dates, multiple dates, ambiguous numeric dates
and abbreviated comma-separated years produce a clarification without fetching
live data or consuming AI quota. The AI may never change the locally resolved
date. Historical availability is checked by the website's archive adapter:
missing dates must report unavailable, never reuse live checkpoint data or
invent historical prices/codes. This backend returns an intent only.

Errors use `{ "ok": false, "error": { "code": "...", "message": "..." } }`.
Errors deliberately omit provider diagnostics, prompts and credentials.
Fixed error codes distinguish upstream request rejection (400/422), rejected
API keys (401), account/key credit restrictions (402), denied access (403),
capacity limits (429), and other availability failures. A 402 classification
does not assume whether an account balance or a particular key limit caused it.
For 400/422 responses only, at most 8 KiB of provider error text is inspected to
select a fixed reasoning-control, structured-output or credit/key-budget
classification. Only the top error message is classified; when it is generic,
the nested `metadata.raw` JSON error message may be used. Other metadata fields
are never scanned. Raw error text and metadata are never returned, logged or stored.
Oversized or unreadable error bodies remain the generic request-rejected error.

## Persistent public usage limits

Both text interpretation and screenshot reading reserve from the same budget.

SQLite-backed `AssistantQuota` coordinates one global budget of 40 actual AI
attempts per UTC day, with 10 per client/day and 5 per rolling ten minutes.
Reservations are atomic and persist across restarts. Failed upstream attempts
count. Exact deterministic commands do not consume the AI budget.

Only Cloudflare's trusted `CF-Connecting-IP` is used; X-Forwarded-For and request
body IPs cannot bypass quota. Client addresses are hashed with a private random
nonce and UTC day before storage. Only the current day's bounded counters are
retained: no raw IPs, prompts, responses or credentials. CORS allows only the
GitHub Pages origin; server-side requests still require a trusted Cloudflare
address before AI inference. CORS is not an authentication mechanism: this is
intentionally a public assistant with a strict shared free-use budget.

## Screenshot descriptions

`POST /api/chart` accepts one user-initiated image upload:

```json
{"message":"Describe the visible movement so far.","context":{"market":"CL","window":"03:00-05:00","date":null},"image":{"dataUrl":"data:image/jpeg;base64,..."}}
```

`message` is optional or may be blank; its default is “Describe the visible price
movement so far.” Other fields are exact and `context.date` is explicitly nullable.
Only base64 JPEG/PNG/WebP data URLs are accepted. The HTTP body is capped at
2 MiB, the data URL at 1.5 MiB, image headers at 4096 pixels per edge and 12 MP.
GIF, SVG, remote image URLs, mismatched MIME signatures, corrupt/truncated headers
and animated image headers are rejected before quota is reserved. Image headers
and chunk boundaries are inspected without decompressing pixels; JPEG frame
headers must be within the first 64 KiB, as in normalized browser screenshots.
This is bounded header validation, not a full image codec decoder.

The existing pinned free model receives an official Chat Completions multipart
user message: a `text` content part followed by `image_url` with the base64 data
URL. No remote image fetch, tool or paid fallback is enabled. It uses the same
server secret and quota object as text chat, with a 40-second upstream deadline,
1600-token output cap and no automatic retry. Images are processed for the
requested call and are not stored or logged by this Worker. The selected free
provider receives the upload, so its own data terms still apply.

The shared reference in `docs/chart-reading-reference.mjs` is inlined into the
Worker during build and also supplies the user-copyable comparison prompt.

The exact success response is:

```json
{"ok":true,"schema":"sessionpath.assistant.chart.v1","action":"describe_chart","market":"CL","window":"03:00-05:00","date":null,"model":"nvidia/nemotron-3.5-super-vl:free","referenceVersion":"sessionpath-chart-v1","analysis":{"summary":"...","sequence":["..."],"bbox":"...","sessionpath":"...","uncertainties":["..."]}}
```

Analysis fields are plain descriptive text: summary at most 800 characters,
sequence one to eight observations of at most 400 each, BBOX and SessionPath
descriptions at most 600 each, and uncertainties one to eight items of at most
300 each. Total text is capped at 6000 characters. Strict output validation
rejects additional fields, explicit numerical probability claims, URLs, markup,
indicator-code strings and common trade-instruction patterns. Exact legible
percentage annotations such as AVR usage may be described as visible evidence;
they are not converted into a new live probability or forecast. Blank,
cropped or unreadable charts must identify uncertainty instead of fabricating
candles, levels or the unseen next outcome. Context metadata is a user label,
not independent proof of the chart's symbol, date or timezone.

## Deployment

Run `node build.mjs`, then upload `worker.bundle.mjs` as the module Worker
`sessionpath-assistant` with `deploy-metadata.json`. The metadata enables Workers
observability and trace sampling and declares `ASSISTANT_QUOTA` plus the SQLite
migration. Configure `OPENROUTER_API_KEY` through the platform secret API. The
metadata contains no secret or deployment token. Enable its workers.dev route
or configure an explicit hostname before using the frontend.
The migration in the metadata is for the initial deployment only. For later
updates, omit migrations, keep the existing `ASSISTANT_QUOTA` namespace, and
preserve secret bindings with `keep_bindings: ["secret_text"]`.

`GET /health` exposes service identity and free-only routing, without secrets,
quota counters, prompts or data feed access.

## Verification

`node build.mjs`; `node --test test/assistant.test.mjs`. The runtime test additionally
needs Miniflare and verifies actual RPC, concurrent enforcement, SQLite
persistence and restart behavior. Existing project test dependencies can be
reused via the personal TradingView package-test-loader; no new install is needed.

References: [verified free model](https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free),
[OpenRouter free variants](https://openrouter.ai/docs/guides/routing/model-variants/free),
[structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs),
[reasoning token controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens),
[Chat Completions image schema](https://openrouter.ai/openapi.json),
[image inputs](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding),
[Cloudflare SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
