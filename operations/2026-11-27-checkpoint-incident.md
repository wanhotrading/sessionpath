# November 27, 2026 · Morning forecast incident

At 05:59 NY, the CL dashboard displayed the saved November 26 08:30 forecast. After the date-selection correction went live, the dashboard selected November 27 05:00–08:30 but showed empty prices, containment and forecast code. The continuation and first-breach panels also reported that they lacked forecast inputs.

## What happened

1. The November 26 NY reference session ended early. The personal sender required all 78 five-minute candles of a normal 09:30–16:00 reference session before it declared the next day's model inputs ready. CL and GC had 60 reference candles. NQ and ES had 42. TradingView continued sending fresh five-minute observations, with an empty checkpoint list.
2. The old date fallback could display the previous day's last saved checkpoint. The 06:05 NY change correctly selected today's 05:00 window. Its backup lookup checked the dated webhook archive, which also lacked today's checkpoints. Another verified TradingView candle-history source was available to the site but was outside that lookup. November 27 candle-derived records had to be restored.
3. The earlier local browser check asserted the right heading and a disabled copy button. It verified the wrong-date guard while accepting a blank forecast. The publishing workflow checked site files and startup data without exercising this user journey. The proposed holiday-calendar work was not deployed.

## Confirmed impact and recovery

The forecast card and panels that depend on its inputs could be empty. Session paths, headlines and other visible components did not demonstrate a site-wide outage. The authenticated incoming quote and a complete forecast are distinct health signals.

The 03:00 and 05:00 records were restored from the four continuous TradingView charts. For CL at 05:00, the decision open was 85.66 and the frozen AVR was 2.214. The published card displayed both, with containment and an enabled forecast-code button. The receiver and sender now support exchange-confirmed shortened reference sessions, maintain full-session AVR, and can reconstruct missing decisions from verified five-minute history. The dashboard retries a failed read and checks the dated source again. A source outage can still delay genuinely new observations.

The standing change and release checks are in [the repository release rules](../AGENTS.md).

