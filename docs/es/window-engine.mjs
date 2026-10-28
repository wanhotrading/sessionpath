// Planning-window analytics. All predictor bars end at or before the as-of time.
// A timeline row is [dayIndex, pre19:30CloseCents, flatHLCcents]. Null bars stay missing.
export const clockMinute = value => {
  const [h, m] = String(value).split(':').map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return NaN;
  const n = h * 60 + m;
  return n >= 1170 ? n - 1440 : n;
};
export const clockLabel = n => {
  const m = ((n % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
export const bucket = q => q < 0 ? 'BELOW' : q < .25 ? 'Q1' : q < .5 ? 'Q2' : q < .75 ? 'Q3' : q <= 1 ? 'Q4' : 'ABOVE';
export const mean = values => values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
export function quantile(values, p) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y), i = (a.length - 1) * Math.max(0, Math.min(1, p)), l = Math.floor(i);
  return a[l] + (a[Math.ceil(i)] - a[l]) * (i - l);
}
export function hasTags(day, tags = [], mode = 'all', minute, library = false) {
  if (!tags.length) return true;
  const set = new Set(library ? day.tags || [] : (day.knownTags || []).filter(t => Number.isFinite(t.minute) && t.minute <= minute).map(t => t.tag));
  return mode === 'any' ? tags.some(t => set.has(t)) : tags.every(t => set.has(t));
}

const EPS = 1e-9;
const layoutFor = timeline => ({
  start: timeline.startMinute ?? -270,
  step: timeline.stepMinutes ?? timeline.step ?? 5,
  scale: timeline.priceScale ?? 100,
});
const timelineRows = timeline => Array.isArray(timeline) ? timeline : timeline.rows;
const isBar = (bars, index) => {
  const at = index * 3;
  if (index < 0 || at + 2 >= bars.length) return false;
  const h = bars[at], l = bars[at + 1], c = bars[at + 2];
  return Number.isFinite(h) && Number.isFinite(l) && Number.isFinite(c) && h >= l && h >= c && l <= c;
};

// Does not inspect a bar beginning at `minute`, even when the future is present.
function snapshot(day, source, minute, layout) {
  const {start, step, scale} = layout, count = (minute - start) / step;
  if (!Number.isInteger(count) || count < 0) return null;
  const bars = source[2], anchor = day.open1930, avr = day.avr;
  if (!Array.isArray(bars) || !Number.isFinite(anchor) || !(avr > 0) || !(day.priorWidth > 0)) return null;
  let high = anchor, low = anchor;
  for (let i = 0; i < count; i++) {
    if (!isBar(bars, i)) return null;
    high = Math.max(high, bars[i * 3] / scale);
    low = Math.min(low, bars[i * 3 + 1] / scale);
  }
  // Decision-time open is known immediately. Never read that candle's H/L/C here.
  const price = Array.isArray(source[3]) ? (Number.isFinite(source[3][count]) ? source[3][count] / scale : null) : count ? bars[(count - 1) * 3 + 2] / scale : Number.isFinite(source[1]) ? source[1] / scale : null;
  if (price == null || !Number.isFinite(day.priorLow)) return null;
  high = Math.max(high, price); low = Math.min(low, price);
  const range = high - low;
  // Behavior always covers a full completed hour. A shorter prehistory cannot match it.
  const priorCount = 60 / step, priorStart = count - priorCount;
  let observedPath = null;
  if (Number.isInteger(priorCount) && priorStart >= 0) {
    const priorPrice = priorStart ? bars[(priorStart - 1) * 3 + 2] / scale : Number.isFinite(source[1]) ? source[1] / scale : null;
    if (priorPrice != null) observedPath = Array.from({length: priorCount}, (_, i) => (bars[(priorStart + i) * 3 + 2] / scale - priorPrice) / avr);
  }
  return {
    minute, rangeAvr: range / avr, upAvr: (high - anchor) / avr, downAvr: (anchor - low) / avr,
    bboxPosition: (price - day.priorLow) / day.priorWidth,
    closeInRunningRange: range > EPS ? (price - low) / range : null,
    closePrice: price, runningHigh: high, runningLow: low, observedPath,
  };
}

// Input-only access: a missing future window must never hide a valid decision snapshot.
export function readSnapshot(day, timeline, minute) {
  const source = (timelineRows(timeline) || []).find(row => row[0] === day.index);
  const layout = layoutFor(timeline), index = (minute - layout.start) / layout.step;
  if (!source || !Array.isArray(source[3]) || !Number.isFinite(source[3][index])) return null;
  const observed = snapshot(day, source, minute, layout);
  return observed ? {...observed, behavior: observed.observedPath ? pathClass(observed.observedPath) : ''} : null;
}

export function deriveRows(days, timeline, asofMinute, endMinute) {
  const layout = layoutFor(timeline), {start, step, scale} = layout;
  if (!Number.isFinite(asofMinute) || !Number.isFinite(endMinute) || asofMinute < start || endMinute < asofMinute ||
      !Number.isInteger((asofMinute - start) / step) || !Number.isInteger((endMinute - start) / step)) {
    throw new Error('Choose an as-of time before the window end, on a five-minute boundary.');
  }
  const dayMap = new Map(days.map((day, i) => [day.index ?? i, day]));
  const from = (asofMinute - start) / step, to = (endMinute - start) / step, result = [];
  for (const source of timelineRows(timeline) || []) {
    const day = dayMap.get(source[0]);
    if (!day) continue;
    const observed = snapshot(day, source, asofMinute, layout);
    if (!observed) continue;
    const bars = source[2];
    let futureHigh = from === to ? observed.closePrice : -Infinity;
    let futureLow = from === to ? observed.closePrice : Infinity, complete = true;
    const path = [];
    for (let i = from; i < to; i++) {
      if (!isBar(bars, i)) { complete = false; break; }
      futureHigh = Math.max(futureHigh, bars[i * 3] / scale);
      futureLow = Math.min(futureLow, bars[i * 3 + 1] / scale);
      path.push((bars[i * 3 + 2] / scale - observed.closePrice) / day.avr);
    }
    if (!complete) continue;
    const extensionUpAvr = Math.max(0, futureHigh - observed.runningHigh) / day.avr;
    const extensionDownAvr = Math.max(0, observed.runningLow - futureLow) / day.avr;
    const totalRangeAvr = observed.rangeAvr + extensionUpAvr + extensionDownAvr;
    result.push({
      dayIndex: source[0], avr: day.avr, ...observed, endMinute, forwardPath: path,
      nextHighAvr: Math.max(0, futureHigh - observed.closePrice) / day.avr,
      nextLowAvr: Math.min(0, futureLow - observed.closePrice) / day.avr,
      extensionUpAvr, extensionDownAvr, additionalRangeAvr: extensionUpAvr + extensionDownAvr, totalRangeAvr,
      totalUpAvr: observed.upAvr + extensionUpAvr, totalDownAvr: observed.downAvr + extensionDownAvr,
      printed75: observed.rangeAvr >= .75 - EPS,
      crossed75: observed.rangeAvr < .75 - EPS && totalRangeAvr >= .75 - EPS,
      // References permit saved observations to be checked at their original clock time.
      _source: source, _layout: layout,
    });
  }
  return result;
}

const fields = [
  ['printed', 'rangeAvr', .25], ['up', 'upAvr', .25], ['down', 'downAvr', .25],
  ['q', 'bboxPosition', .25], ['rangePosition', 'closeInRunningRange', .25],
];
const providedFields = q => fields.filter(([key]) => Number.isFinite(q[key]));
function conditionMatches(day, row, condition) {
  if (!hasTags(day, condition.tags || [], condition.tagMode || 'all', condition.minute)) return false;
  if (condition.location && bucket(row.bboxPosition) !== condition.location) return false;
  if (condition.behavior && (!row.observedPath || pathClass(row.observedPath) !== condition.behavior)) return false;
  return true;
}
export function selectMatches(days, rows, query) {
  const dayMap = new Map(days.map((day, i) => [day.index ?? i, day]));
  const minute = query.minute ?? rows[0]?.minute;
  const current = {...query, minute};
  const observations = (query.observations || []).filter(o => Number.isFinite(o.minute) && o.minute < minute);
  const conditions = [...observations, current];
  const featureSets = conditions.map(providedFields);
  const numericCount = featureSets.reduce((sum, set) => sum + set.length, 0), pool = [], baseline = [];
  for (const row of rows) {
    const day = dayMap.get(row.dayIndex);
    if (!day || (query.beforeDate && day.date >= query.beforeDate) || (query.year && String(day.year ?? day.date.slice(0, 4)) !== String(query.year))) continue;
    baseline.push({day,row,distance:0});
    let sum = 0, eligible = true;
    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i];
      const observed = i === conditions.length - 1 ? row : snapshot(day, row._source, condition.minute, row._layout);
      if (!observed || !conditionMatches(day, observed, condition)) { eligible = false; break; }
      for (const [key, field, scale] of featureSets[i]) {
        if (!Number.isFinite(observed[field])) { eligible = false; break; }
        sum += Math.abs(observed[field] - condition[key]) / scale;
      }
      if (!eligible) break;
    }
    if (eligible) pool.push({day, row, distance: numericCount ? sum / numericCount : 0});
  }
  pool.sort((a, b) => a.distance - b.distance || b.day.date.localeCompare(a.day.date));
  const requested = Number(query.limit), limit = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 100;
  return {pool, baseline, matches: query.limit === 'ALL' ? pool : pool.slice(0, limit), numericCount, observationCount: observations.length};
}

// Direction-aware descriptions of completed close paths; these are not workbook tags.
export function pathClass(path) {
  if (!path?.length) return 'Little net change';
  const p = [0, ...path], end = p.at(-1), low = Math.min(...p), high = Math.max(...p);
  const lowIndex = p.indexOf(low), highIndex = p.indexOf(high), last = p.length - 1;
  const recover = low <= -.08 && end - low >= .08 && lowIndex < last;
  const fade = high >= .08 && high - end >= .08 && highIndex < last;
  if (recover && fade) return lowIndex < highIndex ? 'Trend up then fade' : 'Trend down then recover';
  if (recover) return 'Trend down then recover';
  if (fade) return 'Trend up then fade';
  if (end >= .05) return 'Higher finish';
  if (end <= -.05) return 'Lower finish';
  return 'Little net change';
}
function metric(values, avr) {
  const result = {mean: mean(values), median: quantile(values, .5), p25: quantile(values, .25), p75: quantile(values, .75), min: Math.min(...values), max: Math.max(...values)};
  for (const key of ['mean', 'median', 'p25', 'p75', 'min', 'max']) result[`${key}Points`] = avr > 0 ? result[key] * avr : null;
  return result;
}
export function summarize(matches, options = {}) {
  if (!matches.length) return null;
  const rows = matches.map(m => m.row ?? m), avr = options.avr;
  const summary = {n: rows.length};
  const metrics = {
    up: r => r.nextHighAvr, down: r => -r.nextLowAvr,
    extensionUp: r => r.extensionUpAvr, extensionDown: r => r.extensionDownAvr,
    additionalRange: r => r.additionalRangeAvr, finalRange: r => r.totalRangeAvr,
    endMove: r => r.forwardPath.at(-1) ?? 0, printedRange: r => r.rangeAvr,
    overnightUp: r => r.totalUpAvr, overnightDown: r => r.totalDownAvr,
  };
  for (const [name, fn] of Object.entries(metrics)) {
    summary[name] = metric(rows.map(fn), avr);
    summary[name].meanHistoricalPoints = mean(rows.map(row => fn(row) * row.avr));
    summary[name].medianHistoricalPoints = quantile(rows.map(row => fn(row) * row.avr), .5);
  }
  const eligible = rows.filter(r => !r.printed75), reached = eligible.filter(r => r.crossed75).length;
  summary.crossing75 = {eligible: eligible.length, reached, share: eligible.length ? reached / eligible.length : null};
  const extended = rows.filter(r => r.additionalRangeAvr > EPS).length;
  summary.extendsRange = {count: extended, share: extended / rows.length};
  summary.groups = ['Higher finish', 'Lower finish', 'Trend down then recover', 'Trend up then fade', 'Little net change']
    .map(label => ({label, count: rows.filter(r => pathClass(r.forwardPath) === label).length})).sort((a, b) => b.count - a.count);
  summary.years = Object.fromEntries(['2022', '2023', '2024', '2025', '2026'].map(year => [year, matches.filter(m => String(m.day?.year ?? m.day?.date?.slice(0, 4)) === year).length]));
  summary.levels = Number.isFinite(options.price) && avr > 0 ? {
    averageHigh: options.price + summary.up.meanPoints, averageLow: options.price - summary.down.meanPoints,
    medianHigh: options.price + summary.up.medianPoints, medianLow: options.price - summary.down.medianPoints,
    averageEnd: options.price + summary.endMove.meanPoints,
  } : null;
  // Use today's printed range plus matched additional expansion for a mapped final range.
  summary.mappedFinalRange = Number.isFinite(options.printed) ? {
    mean: options.printed + summary.additionalRange.mean, median: options.printed + summary.additionalRange.median,
    meanPoints: avr > 0 ? (options.printed + summary.additionalRange.mean) * avr : null,
    medianPoints: avr > 0 ? (options.printed + summary.additionalRange.median) * avr : null,
  } : null;
  return summary;
}

// Compare today's range with the eligible same-clock cohort before nearest-neighbor selection.
export function rangeContext(rowsOrMatches, printed) {
  const values = rowsOrMatches.map(item => (item.row ?? item).rangeAvr).filter(Number.isFinite);
  if (!values.length) return null;
  const percentile = Number.isFinite(printed) ?
    (values.filter(v => v < printed - EPS).length + .5 * values.filter(v => Math.abs(v - printed) <= EPS).length) / values.length : null;
  return {
    n: values.length, mean: mean(values), p25: quantile(values, .25), median: quantile(values, .5), p75: quantile(values, .75), percentile,
    label: percentile == null ? 'Add printed range' : percentile < .25 ? 'Underperformed for this time' : percentile > .75 ? 'Extended for this time' : 'Typical for this time',
  };
}
export function wilson(k, n) {
  if (!n) return [0, 1];
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
