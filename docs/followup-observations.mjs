const EPS = 1e-8;
const BAR_MINUTES = 5;

export const contractSymbol = contract => contract?.split(':').at(-1);

export function archivedResearchBar(days, timeline, {date, contract}) {
  const day = days.find(day => day.date === date && contractSymbol(day.contract) === contractSymbol(contract));
  const row = day && (Array.isArray(timeline) ? timeline : timeline.rows)?.find(row => row[0] === day.index);
  if (!row) return null;
  const start = timeline.startMinute ?? -270;
  const step = timeline.stepMinutes ?? timeline.step ?? BAR_MINUTES;
  const scale = timeline.priceScale ?? 100;
  if (step !== BAR_MINUTES || scale <= 0) return null;
  return minute => readBar(row[2], (minute - step - start) / step, scale);
}

function readBar(values, index, scale) {
  const i = 3 * index;
  if (!Array.isArray(values) || !Number.isInteger(index) || index < 0 || i + 2 >= values.length) return null;
  const [h, l, c] = [values[i], values[i + 1], values[i + 2]];
  if (![h, l, c].every(Number.isFinite) || h < c || l > c) return null;
  return {high: h / scale, low: l / scale, close: c / scale};
}

export function completedEndpointClose(record, minute, barAt, exactClose) {
  return barAt?.(minute)?.close ?? exactClose ?? (minute === 510 && record.snapshot.london_complete ? record.snapshot.london_close : null);
}

export function firstCompletedBreach({start, end, through, bounds, barAt}) {
  const last = Math.min(end, through);
  if (last < start + BAR_MINUTES) return {status: 'waiting'};
  if (!barAt) return {status: 'unavailable'};
  for (let minute = start + BAR_MINUTES; minute <= last; minute += BAR_MINUTES) {
    const bar = barAt(minute);
    if (!bar) return {status: 'gap'};
    const upper = bar.high > bounds.upper + EPS;
    const lower = bar.low < bounds.lower - EPS;
    if (upper && lower) return {status: 'ambiguous', minute};
    if (upper || lower) return {status: 'breach', minute, bar};
  }
  return {status: 'unbreached', minute: last};
}
