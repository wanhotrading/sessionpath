# SessionPath delayed-data service

Public on-demand Yahoo endpoint for CL, NQ, ES and GC. This is separate from the private TradingView connection and requires no keys, database or paid-plan change. Source prices remain delayed.

The original context rules are preserved. Optional decision-open, latest complete ten-session frozen AVR, completed last-hour behavior and known-cutoff-open range receipts are additive. The optional 35-day dated-contract history request shares the original request deadline; failure preserves usable context and reports unavailable AVR. Ten complete 09:30–16:00 New York reference sessions are required, frozen before the preceding 19:30 anchor. Missing historical sessions are never filled with invented prices.

The worker serves /api/context and /api/health, with CORS limited to the SessionPath site origins. Private keys and chart snapshots belong to the separate personal connection.

Test: node --test bridge/public-worker.test.mjs
