# Personal SessionPath TradingView bridge

This separate Worker receives the owner's Pine alerts and serves authenticated
snapshots to the public SessionPath frontend. It does not invoke the paid Model
publisher, touch Supabase, or change the public Yahoo data service.

## Runtime and deployment contract

- Entry: `worker.mjs`; `node build.mjs` emits the equivalent single ES module
  `worker.bundle.mjs` for a native Cloudflare upload.
- Durable Object export: `PersonalFeed`; binding: `PERSONAL_FEEDS`.
- First deployment migration: `{ "tag": "personal-feed-v1",
  "new_sqlite_classes": ["PersonalFeed"] }`. Retain migration history afterward.
- Compatibility date: `2026-11-03`. No Node compatibility flag is required.
- Secrets: `READ_TOKEN_HASH`, `WRITE_TOKEN_HASH`, each the lowercase SHA-256 hex
  digest of an independently generated random 256-bit token. No plaintext token
  belongs in source, GitHub, Worker settings, URLs, logs, or deployment receipts.
- Root must configure the secrets and binding and verify the actual Workers
  runtime before reporting commissioning. Node tests inject the native Node
  timing-safe comparison; production uses Workers' Web Crypto extension.

SQLite-backed Durable Object KV storage retains exactly one `latest` receipt per
market. Its transaction serializes monotonic updates and prevents later alerts
from changing or removing an already accepted cutoff for the same session. It
stores no credential, request body, or request header. No alarm or cron is used.

## HTTP contract

`GET /health` is public and returns only service health.

`POST /webhook` accepts `application/json`, at most 16 KiB, without query
parameters or an Authorization header. Its body includes the write token in
`token` and the `sessionpath.personal.tradingview.v1` packet agreed with the Pine
sender. The token is authenticated and stripped before validation/persistence.
Success is `200 {status:"accepted"|"duplicate"|"ignored"}`. A changed frozen
snapshot returns `409 IMMUTABLE_SNAPSHOT`. Source/receipt times are not refreshed
for duplicate or older observations.

`GET /api/snapshots?market=CL` (also NQ, ES, GC) requires
`Authorization: Bearer <read token>`. It returns:

```json
{
  "schema": "sessionpath.tradingview.read.v1",
  "status": "ready",
  "receivedAt": "2026-11-03T13:35:02.000Z",
  "packet": {},
  "source": "TradingView personal Pine alert",
  "validationBasis": "authenticated_pine_attestation"
}
```

`packet` is the normalized sender packet without `token`. No observation returns
`waiting` with a null packet/receipt. A fresh empty heartbeat returns `waiting`.
Eight minutes without a new observed bar/receipt, or a different target session,
returns `stale`. Clients must not apply stale snapshots. This is a five-minute
confirmed snapshot bridge; `last_price` is separate from frozen model inputs.

Only `https://wanhotrading.github.io` receives CORS access. Foreign Origin headers
are denied, and browser preflights permit only authenticated snapshot GETs.
Server-side requests without an Origin remain credential protected. CORS is not
used as authentication. All responses use `no-store`; errors contain fixed codes.

## Source validation

Only CL1!, NQ1!, ES1!, GC1!, standard five-minute confirmed bars, New York time,
continuous front-contract data, backadjustment off, and the explicit continuous
ten-session AVR profile are accepted. Transport must arrive within 180 seconds
of its aligned bar close. Session date is derived from the completed interval
(`observed_at - 1 ms`), so the 19:25–19:30 bar still belongs to the old anchor.

Frozen cutoff snapshots are cumulative and ordered 03:00, 05:00, 08:30; their
first confirmed delivery occurs at 03:05, 05:05, 08:35. Every model snapshot
requires canonical positive prices, consistent running/session ranges, an exact
previous-evening 19:30 AVR freeze, ten chronological completed-session dates,
the latest prior date/count78, no manual AVR override, and completed Asia data.
London values must remain null until the 08:30 snapshot. No future candles are
inferred by the receiver.

The receiver verifies an authenticated Pine receipt, not independent raw-bar
history or exchange entitlement. Ten complete 78-bar NY sessions are attested by
the sender. The prior session must be the immediately previous weekday
(Monday uses Friday). A wholly missing or shortened prior NY weekday therefore
leaves automated snapshots unavailable, including after a holiday; manual input
remains available. The receiver does not invent a holiday calendar or claim a
continuous baseline is one explicit delivery contract.

## Verification

Run `node --test test/*.test.mjs` and `node build.mjs`. Tests cover scoped auth,
bounded streaming, CORS, malformed/tampered feeds, timestamps/DST/session rollover,
frozen snapshots, duplicate/out-of-order delivery, market isolation, persistence
reconstruction, and concurrent transaction ordering. Actual Durable Object RPC,
SQLite-backed storage, and Workers timingSafeEqual require runtime commissioning.

Primary implementation references:

- https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/
