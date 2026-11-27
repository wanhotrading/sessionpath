# SessionPath release rules

These rules apply to every change to the site, receiver and TradingView sender. Use the recorded-data checks on weekends and exchange closures as well.

## Before changing anything

1. Record the current site commit, receiver version and, when relevant, the four active sender versions. Identify which consumer and dependent panels the change can affect.
2. Reproduce the reported case and record the baseline for CL, NQ, ES and GC. Capture the NY date, selected window, contract, decision open, AVR, source timestamp, forecast code availability and a downstream result. Record an existing outage explicitly. A baseline collected during an outage cannot serve as the expected healthy result.
3. Use a fixed date with known-good chart inputs as an independent reference. Changes to forecast definitions, data sources, cutoff times, reference sessions, alert destinations or automated schedules need the owner's explicit approval. Retain a rollback point for each component being changed.

## Behavior to preserve

- Use America/New_York for dates, daylight saving time and cutoffs. From 03:00 to before 05:00 use the same day's 03:00 snapshot. From 05:00 to before 08:30 use 05:00. At 08:30 switch to 08:30 for the NY forecast. Before 03:00 show that today's first decision is still ahead. Keep manual historical replay separate.
- A late page visit or refresh must find the active frozen checkpoint. Its price is the decision candle's actual open. Its other conditions use information known at that instant. A later quote, cutoff-bar high/low, wrong contract or previous day's forecast can never fill that slot.
- Use the user's unadjusted continuous TradingView feed for each market. Shortened prior NY sessions need contiguous observed bars and a verified exchange close. AVR uses ten complete 09:30–16:00 NY sessions. A missing candle, a closed market or a delayed webhook must never silently change the calculation.
- Preserve each first-accepted cutoff. Keep verified, same-day results available during an outage. Display live quote freshness separately. Recover missing cutoffs from verified history, with bounded retries. Keep replay and the user's market selection intact.
- Keep the forecast, copyable indicator code, compression and expansion, BBOX, continuation and first-breach panels on a consistent market and date. Show a reason when a result is genuinely unavailable. Existing site and CV URLs must continue to open.

## What must pass before publishing

- Run the receiver, sender serialization, saved-checkpoint and recovery checks. Rebuild the receiver and compare the result with its committed deployable file.
- Open the candidate dashboard in a browser for each market. Replay the 2026-11-27 06:36 NY failure with an empty live feed. Verify the active 05:00 window, exact open and AVR, containment percentage, compression and expansion, and a forecast code that copies with the correct market and timestamps. A heading, connected badge or HTTP success alone cannot pass.
- Check normal data, an unavailable or delayed response, a fresh heartbeat with no snapshot, recovery after reconnect, and wrong-date or wrong-market inputs. Test both sides of the three decision times and the difference between a full and a shortened reference session.
- Exercise any other user-facing feature touched by the change, including dependent calculations and existing chart-code readers. Use fixtures for reproducible checks. A genuine no-data outcome needs its own test beside the healthy case.
- An unexplained failure blocks release. Fix its cause. Changing a test expectation requires evidence that the intended behavior changed.

## After publishing

- For feed changes, verify an authenticated delivery from each of the four active TradingView alerts and inspect the published forecast. Match price and date to the independent reference. TradingView alerts keep their own script version; verify the running alerts separately from the chart editor.
- During exchange closure, report which checks passed against recorded data and which live observation is still pending. If a release breaks a previously working path, pause the rollout or revert the affected component to its recorded version and verify the recovery.
- Report the release, what passed, any remaining gaps and where the user can verify the result. Keep credentials out of logs and fixtures.

