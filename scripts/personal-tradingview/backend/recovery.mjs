import {nyEpoch,datePlus,PERSONAL_MARKETS,PERSONAL_CUTOFFS,normalizeSnapshot} from './validation.mjs';
// Decode the sender's contiguous five-minute history. Only a checkpoint candle's
// open is consumed for that checkpoint. Later OHLC is never used in its forecast.
export function recoverCandleSnapshots(evidence, {date, market, observedMs, known}) {
  if (!evidence || evidence.v !== 1 || !Array.isArray(evidence.bars) || !evidence.bars.length ||
      evidence.bars.length > 157 || !Number.isSafeInteger(evidence.base) || evidence.base <= 0) return [];
  const start = nyEpoch(datePlus(date,-1),'19:30');
  if (evidence.from !== start || evidence.from + evidence.bars.length * 300000 > observedMs) return [];
  const tick = PERSONAL_MARKETS[market];
  let base = evidence.base;
  const bars = [];
  for (const row of evidence.bars) {
    if (!Array.isArray(row) || row.length !== 4 || !row.every(Number.isSafeInteger)) return [];
    const [o,h,l,c] = row.map(delta => Number(((base + delta) * tick).toFixed(2)));
    if (l <= 0 || h > 1e9 || h < Math.max(o,c) || l > Math.min(o,c)) return [];
    if (!bars.length && row[0] !== 0) return [];
    bars.push({o,h,l,c}); base += row[3];
  }
  const ref = evidence.reference;
  if (!ref || !Array.isArray(ref.avr_dates) || !(ref.avr > 0)) return [];
  const high = rows => Math.max(...rows.map(b => b.h));
  const low = rows => Math.min(...rows.map(b => b.l));
  const asia = bars.slice(0,78);
  const result = [];
  for (const cutoff of PERSONAL_CUTOFFS) {
    const stamp = nyEpoch(date,cutoff), index = (stamp-start)/300000;
    if (known.some(s => s.cutoff === cutoff) || !bars[index] || asia.length !== 78) continue;
    const past = bars.slice(0,index), open = bars[index].o;
    const lastHour = past.slice(-13), baseClose = lastHour.shift().c;
    const moves = [0,...lastHour.map(b => (b.c-baseClose)/ref.avr)];
    const hi = Math.max(...moves), lo = Math.min(...moves), end = moves.at(-1);
    const bounce = lo <= -.08 && end-lo >= .08 && moves.indexOf(lo) < 12;
    const fade = hi >= .08 && hi-end >= .08 && moves.indexOf(hi) < 12;
    const rule = bounce && fade ? (moves.indexOf(lo)<moves.indexOf(hi)?4:3) : bounce?3:fade?4:end>=.05?1:end<=-.05?2:5;
    const london = cutoff === '08:30' ? past.slice(90) : null;
    const candidate = {...ref,cutoff,as_of:new Date(stamp).toISOString(),ready:true,reference_price:open,
      open_1930:bars[0].o,range_high:Math.max(high(past),open),range_low:Math.min(low(past),open),
      last_hour_rule:rule,avr_count:10,avr_frozen_at:new Date(start).toISOString(),avr_override:false,
      asia_high:high(asia),asia_low:low(asia),asia_close:asia.at(-1).c,asia_complete:true,
      london_high:london?high(london):null,london_low:london?low(london):null,london_close:london?.at(-1).c??null,london_complete:!!london};
    result.push(normalizeSnapshot(candidate,{date,market,observedMs,tick,decisionOpen:false}));
  }
  return result;
}
