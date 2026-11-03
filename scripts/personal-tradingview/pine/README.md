# Personal TradingView input exporter

`sessionpath-personal-exporter.pine` is a separate, disabled-by-default observation sender. Use the same script independently on four standard five-minute futures charts: `NYMEX:CL1!`, `CME_MINI:NQ1!`, `CME_MINI:ES1!`, and `COMEX:GC1!`. Create one private TradingView alert per chart. It does not modify the paid-member sender or send orders.

The exporter sends one bounded JSON heartbeat per newly confirmed real-time five-minute candle. A heartbeat contains the current completed close for display and all complete frozen model checkpoints available for that session. Empty `snapshots: []` means that no checkpoint is ready; it must not be presented as a current forecast.

| Frozen checkpoint in New York | Price used by the model | First confirmed delivery |
| --- | --- | --- |
| 03:00 | Exact 03:00 opening price | 03:05 |
| 05:00 | Exact 05:00 opening price | 05:05 |
| 08:30 | Exact 08:30 opening price | 08:35 |

Each checkpoint is captured before its own candle's high, low or close enters the running range. Its cached JSON is then immutable. `observed_at` identifies the newly completed transport candle; `as_of` identifies the earlier frozen checkpoint. `last_price` must never replace `reference_price` in a frozen model. Repeated heartbeats refresh connection status, not the historical checkpoint's conditions. Intermediate 04:00/06:00/07:00 checkpoints are not exported in this version because the current website's main models support 03:00/05:00, with the separate NY model at 08:30.

The session date rolls at the opening of the 19:30 candle. Thus the 19:25–19:30 candle still carries the old target date, and the first new-night heartbeat arrives at 19:35. Old checkpoints clear when the target date changes, including after a weekend. A receiver should derive the just-completed bar's target date using `observed_at - 1ms`, while a current-page check can use the current New York clock.

The reviewed current market indicators are pinned to commit `0449c1466fb0176a59d03bfccdf3b7054ebaad8c`; exact GitHub paths/blob hashes and the inspected first 245 lines are recorded in `source-audit.json`. All four, including GC, use prior complete **09:30–16:00 New York** reference high/low and ten complete 78-bar sessions for AVR. Asia is 19:30–02:00 (78 bars). London is 03:00–08:30 (66 bars), so London values remain null at 03:00 and 05:00. The last-hour classification preserves the source arithmetic, with an additional continuity check on its base candle. Range/U/D inputs are derived from the frozen high/low and 19:30 open, not fitted forecast distances.

The source is explicitly the unadjusted continuous front feed, requested independently of the chart's B-ADJ toggle. Its ten-session mean freezes at 19:30 and carries ten chronological reference dates. It can span delivery contracts and roll gaps; `continuous-prior10-0930-1600-frozen-before1930-v1` identifies this distinct baseline. It does not claim to resolve a monthly contract or reproduce a same-contract AVR. The receipt is an authenticated Pine-computation attestation, not independent verification of all 780 raw candles by the receiver.

Only contiguous confirmed source bars count. The most recent observed NY attempt must be complete; it cannot silently fall back to an older valid BBOX. The prior date must also be the immediately preceding weekday of the target session (Monday uses Friday). An entirely missing weekday or weekday exchange closure therefore disables automatic checkpoints conservatively. This version does not infer holidays or early closes from absent data. Use the site's manual inputs until another complete reference session is available; a reviewed exchange-calendar policy would be a separate enhancement.

Configure the dedicated personal **write** token only in the private indicator input, then enable the sender. The source file intentionally contains no token or webhook destination. Set the personal receiver's HTTPS URL in TradingView's alert dialog and select **Any alert() function call**. Keep the generated JSON message intact. Configure one alert on each qualified continuous symbol. Use a suitable real-time data entitlement and load enough overnight history plus ten full earlier NY sessions. A source more than two minutes behind its candle close emits no heartbeat. Closed markets and missing ticks can therefore make the feed stale.

The receiving service should respond promptly and store the authenticated token-free envelope; TradingView cancels webhook requests exceeding three seconds. A page read token and a sender write token must be distinct. Recreate TradingView alerts after changing the script, token, symbol or timeframe because existing alerts retain their saved configuration. The script cannot fetch website responses or automatically import website forecast codes into an existing chart indicator.

The sender's ingress contract is `packet-schema.json`. The receiver additionally validates chronological dates, matching market ticks, prior-weekday identity, exact cutoff timestamps, monotone cumulative ranges, identical session receipts, freshness and replay protection. A page adapter must apply each market/date/cutoff/hash once, avoid overriding later manual edits, preserve user method/filters/AVR unless explicitly applied, and suspend automatic application while replaying another date. Missing or stale snapshots must not silently supply old values. These page behaviors are outside this Pine folder.

Run `node --test pine/sender-audit.test.mjs` from `scripts/personal-tradingview/`, or run `npm test` there for all suites. Its 16 checks exercise the exact Pine JSON concatenation expressions, payload bounds, market identities, London null handling, source arithmetic and structural timing/security guards. They also pass the generated packets through the actual personal receiver validator, including all four markets and the 19:30 date boundary. They do **not** execute Pine's series/state runtime. Native TradingView compilation and real-time transport/model comparison are separate required checks; neither is claimed by this local suite.

Primary references: [confirmed bar states](https://www.tradingview.com/pine-script-docs/concepts/bar-states/), [alert configuration snapshots and cadence](https://www.tradingview.com/pine-script-docs/concepts/alerts/), [webhook JSON and response deadline](https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/).

Native verification was subsequently completed on 2026-11-03 for the exact
exporter source on NYMEX:CL1!, standard five-minute extended-hours candles,
backadjustment off. The disabled script compiled and ran with a ready frozen
03:00 checkpoint. No token or alert was configured. `native-verification.json`
records the limited scope; the other markets' native runtime, live alert delivery
and a future contract roll remain unverified.
