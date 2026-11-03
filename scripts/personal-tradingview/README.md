# Personal TradingView inputs for SessionPath

This folder contains the independent personal Pine sender, protected Cloudflare
Worker, SQLite-backed Durable Object, and tests. The browser integration lives
in `docs/tradingview-live-core.mjs`. It fills frozen 03:00/05:00/08:30 New York
inputs and refreshes the existing models; the current completed close remains
separate from those decision inputs. The paid-member publishing pipeline is a
different service.

From this folder, with Node 24 recommended:

```sh
npm ci
npm test
npm run build
```

The build emits ignored `backend/worker.bundle.mjs`. Tests include the receiver,
Pine packet interoperability, actual site HTML in jsdom, and a Miniflare SQLite
Durable Object persistence/restart check. The pinned local workerd supports the
runtime test's 2026-08-06 compatibility date; production uses 2026-11-03.
Native compilation and disabled runtime were verified on NYMEX:CL1! with standard
five-minute extended-hours candles and backadjustment off. See
`pine/native-verification.json` for the exact source and scope. The other three
native chart runtimes, authenticated live alert delivery, future roll behavior,
and trusted browser user-event behavior remain separate acceptance checks.

`deployment-contract.json` describes a native Cloudflare API upload. The Worker
exports `PersonalFeed` and uses `PERSONAL_FEEDS`, one object per market. Apply the
`personal-feed-v1` SQLite migration only on initial namespace creation; preserve
the existing namespace and migration state for later code updates. Reuse the
current secret bindings on updates. Configure the independently generated read
and write token digests as runtime secrets; credentials never belong in Git.
This folder contains no deploy command and does not publish through GitHub Pages.

Public `GET /health` exposes no data. `POST /webhook` accepts the sender's JSON
body with its private write token. `GET /api/snapshots?market=CL` (also NQ/ES/GC)
requires the separate read bearer token. Only the SessionPath GitHub Pages origin
receives CORS access; anonymous reads are denied. Responses are never cached.
See `backend/README.md` and `pine/README.md` for exact validation and setup.

The receipt identifies authenticated Pine calculations on unadjusted continuous
front-contract charts. It does not independently rederive raw exchange bars or
assert the owner's real-time data entitlement. Missing/shortened prior weekday
coverage conservatively leaves automatic inputs unavailable; manual inputs and
the existing delayed source remain available.
