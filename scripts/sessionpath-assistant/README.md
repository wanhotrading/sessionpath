# SessionPath public assistant

The assistant interprets requests. SessionPath's existing deterministic forecast
engine remains the only source of prices, probabilities and indicator codes.
No model-generated forecast numbers or Pine code are accepted.

The Worker uses only `openrouter/free`, without a fallback array, plugins or
user-selected models. OpenRouter documents that this router falls back only to
free models. `OPENROUTER_API_KEY` must be configured as a Worker secret, never in
GitHub Pages or browser JavaScript. An unavailable free model is an explicit
error; it never falls back to paid inference. Exact commands such as
`CL 03-05 range` use a local parser and are labeled `rules`; natural language
uses the real OpenRouter request and is labeled `openrouter`.

## Request and response

`POST /api/chat`, `Content-Type: application/json`:

```json
{"message":"CL 03-05 range","context":{"market":"CL","window":"03:00-05:00"}}
```

```json
{"ok":true,"action":"forecast","market":"CL","window":"03:00-05:00","concept":null,"message":"I will read the forecast, historical probabilities and available export code from SessionPath for this market and window.","interpreter":"rules"}
```

Supported markets: CL/NQ/ES/GC. Windows: 03:00-05:00, 05:00-08:30,
08:30-16:00 (New York). Actions: forecast/explain/clarify. Explanation concepts:
mean_box/containment/avr_expansion/extension. Unknown input/output fields are
rejected. Messages are limited to 600 characters, HTTP bodies to 3 KiB, upstream
responses to 24 KiB and an upstream attempt to 15 seconds. No automatic retries.

Errors use `{ "ok": false, "error": { "code": "...", "message": "..." } }`.
Errors deliberately omit provider diagnostics, prompts and credentials.

## Persistent public usage limits

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

## Deployment

Run `node build.mjs`, then upload `worker.bundle.mjs` as the module Worker
`sessionpath-assistant` with `deploy-metadata.json`. The metadata enables Workers
observability and trace sampling and declares `ASSISTANT_QUOTA` plus the SQLite
migration. Configure `OPENROUTER_API_KEY` through the platform secret API. The
metadata contains no secret or deployment token. Enable its workers.dev route
or configure an explicit hostname before using the frontend.

`GET /health` exposes service identity and free-only routing, without secrets,
quota counters, prompts or data feed access.

## Verification

`node build.mjs`; `node --test test/assistant.test.mjs`. The runtime test additionally
needs Miniflare and verifies actual RPC, concurrent enforcement, SQLite
persistence and restart behavior. Existing project test dependencies can be
reused via the personal TradingView package-test-loader; no new install is needed.

References: [OpenRouter free router](https://openrouter.ai/docs/guides/routing/model-variants/free),
[structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs),
[Cloudflare SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
