import { nyEpoch, PERSONAL_MARKETS } from './validation.mjs';

const OVERNIGHT_STEP_MS = 300_000;
const OVERNIGHT_EPS = 1e-8;
const overnightMask = (high, low, upper, lower) =>
  Number(high > upper + OVERNIGHT_EPS) + 2 * Number(low < lower - OVERNIGHT_EPS);
const overnightSide = (price, upper, lower) => overnightMask(price, price, upper, lower);
const overnightFlag = value => Number.isInteger(value) && value >= 0 && value <= 3 ? value : null;

// The current sender supplies contiguous H/L/C from 03:00 when coverage is complete.
// Its 19:30–03:00 checkpoint supplies edge flags, but no sequence of within-window closes.
export function summarizeOvernightTiming(packet) {
  if (!packet || !['CL', 'NQ', 'ES'].includes(packet.market) || !packet.snapshots.length) return null;
  const at03 = nyEpoch(packet.session_date, '03:00');
  const stamp = Date.parse(packet.observed_at);
  const elapsed = (stamp - at03) / OVERNIGHT_STEP_MS;
  if (!Number.isInteger(elapsed) || elapsed < 0) return null;
  const step = Math.min(174, 108 + elapsed);
  const window = step < 132 ? 2 : 3;
  const cutoff = window === 2 ? '03:00' : '05:00';
  const start = window === 2 ? 108 : 132;
  const opening = packet.snapshots.find(snapshot => snapshot.cutoff === cutoff);
  const { prior_high: upper, prior_low: lower, prior_ny_date: priorDate } = opening || packet.snapshots[0];
  const matching = packet.snapshots.filter(s => s.prior_high === upper && s.prior_low === lower && s.prior_ny_date === priorDate);
  const tick = PERSONAL_MARKETS[packet.market];
  const bars = packet.research_bars || [];
  function barAt(closeStep) {
    const index = (closeStep - 109) * 3;
    if (!Number.isFinite(bars[index])) return null;
    return bars.slice(index, index + 3).map(value => value * tick);
  }
  const phases = matching.find(s => s.bbox_history)?.bbox_history.phases;
  const asia = overnightFlag(phases?.[0]);
  const gap = overnightFlag(phases?.[1]);
  const night = asia === null || gap === null ? null : asia | gap;
  const early = matching.filter(s => s.cutoff !== '03:00')
    .map(s => overnightFlag(s.bbox_history?.phases?.[2])).find(v => v !== null);

  function scan(from, through) {
    let mask = 0;
    let complete = true;
    for (let close = from + 1; close <= through; close++) {
      const bar = barAt(close);
      if (!bar) { complete = false; continue; }
      mask |= overnightMask(bar[0], bar[1], upper, lower);
    }
    return { mask, complete };
  }

  function traces(through) {
    return [1, 2].map(edge => {
      let breached = Boolean(night & edge);
      let returnConfirmed = false;
      let armed = false;
      let freshWindow = null;
      for (let close = 109; close <= through; close++) {
        const bar = barAt(close);
        if (!bar) { armed = false; continue; }
        const wick = Boolean(overnightMask(bar[0], bar[1], upper, lower) & edge);
        // Test the wick first. A close back inside on this bar cannot arm
        // the same bar as a fresh attempt, regardless of its intrabar path.
        if (wick && armed) { freshWindow ??= close <= 132 ? 2 : 3; armed = false; }
        breached ||= wick;
        if (breached && overnightSide(bar[2], upper, lower) === 0) {
          returnConfirmed = true;
          armed = true;
        }
      }
      return { returnConfirmed, freshWindow };
    });
  }

  const active = scan(start, step);
  const earlyBars = window === 3 && early === undefined ? scan(108, 132) : null;
  const openingSide = opening ? overnightSide(opening.reference_price, upper, lower) : null;
  const price = step === start ? opening?.reference_price :
    elapsed <= 66 ? packet.last_price : packet.endpoint_closes?.['08:30'] ?? barAt(174)?.[2];
  const position = Number.isFinite(price) ? overnightSide(price, upper, lower) : null;
  return {
    version: 1, window, step, price: price ?? null, position, openingSide, lower, upper,
    past: [null, night, ...(window === 3 ? [early ?? (earlyBars?.complete ? earlyBars.mask : null)] : [])],
    activeMask: active.mask | (openingSide ?? 0) | (position ?? 0),
    activeComplete: openingSide !== null && active.complete,
    priorPaths: traces(start), observedPaths: traces(step),
  };
}
