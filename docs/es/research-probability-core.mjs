/**
 * SessionPath research probability runtime, schema v1. Pure browser/Node ESM.
 *
 * Dataset tuples (integer indexes refer to data.enums):
 * endpoint: [date,market,window,state,HH/LL bit mask,originalForecastCases]
 * breach: [date,market,window,side,type,completionMinute,strengthBand,
 *          future120,future130,return20,already120/130 bit mask,originalCases]
 * Binary outcomes use 0/1; -1 means ineligible, never a failure. Strength -1
 * denotes a wick-only candle. Dates are NY trading dates, not UTC timestamps.
 * Every selector requires asOf and uses dates STRICTLY BEFORE that date.
 * Wilson intervals describe the raw local cell, not the shrunk estimate.
 */

export const RESEARCH_SCHEMA_VERSION = 1;
export const FIXED_PRIOR_WEIGHT = 20;
export const WINDOW_BOUNDS = Object.freeze({
  '03-05': Object.freeze([180, 300]),
  '05-0830': Object.freeze([300, 510]),
  '0830-1600': Object.freeze([510, 960]),
});

const INDEX = new WeakMap();
const SUPPORTED_TIME = new Set() // No ES time adjustment is validated yet.;

function requireChoice(value, choices, name) {
  if (!choices.includes(value)) throw new RangeError(`Invalid ${name}: ${String(value)}`);
  return value;
}

export function validateAsOf(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('asOf must be a NY trading date in YYYY-MM-DD format.');
  }
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError('asOf is not a valid calendar date.');
  }
  return value;
}

export function completionTimeBlock(minute) {
  if (!Number.isInteger(minute) || minute < 0 || minute > 1440 || minute % 5 !== 0) {
    throw new RangeError('Completion time must be a completed five-minute close in NY minutes.');
  }
  return Math.floor(minute / 30) * 30;
}

export function closingStrengthBand(percent) {
  if (!Number.isFinite(percent) || percent < 0) throw new RangeError('Closing overshoot must be a non-negative percentage of the full box width.');
  return Math.floor((percent + 1e-8) / 10) * 10;
}

export function wilsonInterval(successes, n) {
  if (!Number.isInteger(n) || !Number.isInteger(successes) || n < 0 || successes < 0 || successes > n) throw new RangeError('Invalid binary counts.');
  if (!n) return null;
  const z = 1.959963984540054, p = successes / n, den = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / den;
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

function indexData(data) {
  if (!data || data.schemaVersion !== RESEARCH_SCHEMA_VERSION || !data.enums || !Array.isArray(data.endpoint) || !Array.isArray(data.breach)) {
    throw new TypeError('Unsupported SessionPath research dataset.');
  }
  if (INDEX.has(data)) return INDEX.get(data);
  const maps = { endpoint: new Map(), breach: new Map() };
  for (const kind of ['endpoint', 'breach']) {
    for (const r of data[kind]) {
      const windows = kind === 'endpoint' ? data.enums.endpointWindows : data.enums.breachWindows;
      const key = `${data.enums.markets[r[1]]}|${windows[r[2]]}`;
      if (!maps[kind].has(key)) maps[kind].set(key, []);
      maps[kind].get(key).push(r);
    }
    for (const rows of maps[kind].values()) rows.sort((a, b) => a[0].localeCompare(b[0]));
  }
  INDEX.set(data, maps);
  return maps;
}

function rowsBefore(data, kind, market, window, asOf) {
  validateAsOf(asOf);
  const rows = indexData(data)[kind].get(`${market}|${window}`) || [];
  // Lexical ISO date comparison is intentional; same-date outcomes are excluded.
  return rows.filter(r => r[0] < asOf);
}

function count(rows, getOutcome) {
  let n = 0, successes = 0;
  for (const r of rows) {
    const y = getOutcome(r);
    if (y !== 0 && y !== 1) continue;
    n += 1;
    successes += y;
  }
  return { n, successes };
}

function dateSpan(rows) {
  return { from: rows.length ? rows[0][0] : null, through: rows.length ? rows[rows.length - 1][0] : null };
}

function unavailable(reason) {
  return { available: false, reason, n: 0, successes: 0, raw: null, smoothed: null, probability: null, interval: null, rawInterval: null, intervalBasis: 'raw cell frequency', reliability: 'unavailable' };
}

function estimate(localRows, broadRows, getOutcome, options = {}) {
  const local = count(localRows, getOutcome), broad = count(broadRows, getOutcome);
  if (!broad.n) return unavailable('No eligible observations strictly before the selected trading date.');
  const p0 = (broad.successes + 1) / (broad.n + 2);
  const smoothed = options.adjusted ? (local.successes + FIXED_PRIOR_WEIGHT * p0) / (local.n + FIXED_PRIOR_WEIGHT) : p0;
  const rawInterval = wilsonInterval(local.successes, local.n);
  const eligibleLocal = localRows.filter(r => [0, 1].includes(getOutcome(r)));
  return {
    available: true,
    n: local.n,
    successes: local.successes,
    failures: local.n - local.successes,
    raw: local.n ? local.successes / local.n : null,
    smoothed,
    probability: smoothed,
    interval: rawInterval,
    rawInterval,
    intervalBasis: 'raw cell frequency; not an interval for the smoothed estimate',
    prior: { n: broad.n, successes: broad.successes, probability: p0, weight: options.adjusted ? FIXED_PRIOR_WEIGHT : 2, kind: options.adjusted ? 'fixed 20-event broad baseline' : 'Beta(1,1) broad baseline' },
    reliability: !local.n ? 'baseline_fallback' : local.n < 20 ? 'small_sample' : local.n < 50 ? 'limited_sample' : 'historical_sample',
    evaluationHistory: broad.n < (options.evaluationMinimum || 50) ? `below research evaluation minimum of ${options.evaluationMinimum || 50} earlier outcomes` : 'sufficient broader history for the study minimum',
    dates: dateSpan(eligibleLocal),
  };
}

/**
 * Endpoint-only continuation summary. It is descriptive, overlapping information
 * already available from running position and printed AVR, not an independent
 * improvement to the SessionPath range estimator. Either/both extremes may form.
 */
export function selectEndpointProbability(data, { market, window, state, asOf } = {}) {
  requireChoice(market, ['ES'], 'market');
  requireChoice(window, ['05-0830', '0830-1600'], 'endpoint window');
  requireChoice(state, ['ABOVE_U', 'INSIDE', 'BELOW_D'], 'endpoint state');
  const rows = rowsBefore(data, 'endpoint', market, window, asOf);
  const stateIndex = data.enums.endpointStates.indexOf(state);
  const local = rows.filter(r => r[3] === stateIndex);
  const f = {
    hh: r => (r[4] & 1) ? 1 : 0,
    ll: r => (r[4] & 2) ? 1 : 0,
    both: r => r[4] === 3 ? 1 : 0,
    neither: r => r[4] === 0 ? 1 : 0,
  };
  const outcomes = Object.fromEntries(Object.entries(f).map(([key, fn]) => [key, estimate(local, rows, fn, { adjusted: true, evaluationMinimum: 100 })]));
  return {
    kind: 'endpoint_continuation', schemaVersion: RESEARCH_SCHEMA_VERSION,
    available: outcomes.hh.available, market, window, state, asOf,
    anchorMinute: WINDOW_BOUNDS[window][0], endMinute: WINDOW_BOUNDS[window][1],
    reference: 'Running high/low from previous calendar 19:30 through this endpoint, frozen before the next window.',
    outcomeDefinition: 'Any subsequent strict high/low beyond the frozen boundary. Touch equals no new extreme. Both can occur.',
    sample: { n: local.length, broaderN: rows.length, ...dateSpan(local), trainingThrough: dateSpan(rows).through, priorWeight: FIXED_PRIOR_WEIGHT, thinOriginalForecasts: local.filter(r => r[5] < 50).length },
    outcomes,
    evidence: {
      status: 'descriptive_endpoint_only', independentImprovement: false,
      primaryTestsPassed: data.provenance?.endpointPrimaryPassed ?? null, primaryTests: data.provenance?.endpointPrimaryTests ?? null,
      note: data.policy?.endpoint || 'Descriptive ES endpoint summary. Consult the audited ES study for evidence of incremental improvement beyond running position and printed AVR.',
    },
  };
}

/**
 * First-breach probabilities observed AFTER the first five-minute breach candle.
 * Extension targets use later high/low touches; return20 uses later completed
 * closes and requires all four remaining bars. User must confirm first breach.
 * alreadyReached supplied by caller prevents a previously hit target from being
 * misrepresented as a future target. Strength adjustment is experimental/off.
 */
export function selectFirstBreachProbability(data, {
  market, window, side, signalType, completionMinute, asOf,
  strengthPercent, experimentalStrength = false, alreadyReached = {},
} = {}) {
  requireChoice(market, ['ES'], 'market');
  requireChoice(window, Object.keys(WINDOW_BOUNDS), 'breach window');
  requireChoice(side, ['U', 'D'], 'breach side');
  requireChoice(signalType, ['WICK_ONLY', 'CLOSE_OUTSIDE'], 'signal type');
  const [start, end] = WINDOW_BOUNDS[window];
  const timeBlock = completionTimeBlock(completionMinute);
  if (completionMinute <= start || completionMinute > end) throw new RangeError('The first-breach completion time must fall after window start and at or before its endpoint.');
  if (typeof experimentalStrength !== 'boolean') throw new TypeError('experimentalStrength must be boolean.');
  const strengthBand = signalType === 'CLOSE_OUTSIDE' && strengthPercent !== undefined ? closingStrengthBand(strengthPercent) : null;
  if (experimentalStrength && signalType === 'CLOSE_OUTSIDE' && strengthBand === null) throw new RangeError('Experimental closing-strength adjustment requires strengthPercent.');
  const rows = rowsBefore(data, 'breach', market, window, asOf);
  const sideIndex = data.enums.sides.indexOf(side), typeIndex = data.enums.signalTypes.indexOf(signalType);
  const baseline = rows.filter(r => r[3] === sideIndex && r[4] === typeIndex);
  const outcomes = {};
  for (const [key, column] of [['reach120', 7], ['reach130', 8], ['return20', 9]]) {
    const approvedTime = SUPPORTED_TIME.has(`${market}|${window}|${key}`);
    if (key === 'return20' && signalType !== 'CLOSE_OUTSIDE') {
      outcomes[key] = unavailable('A wick-only candle already closed inside. It is not a subsequent 20-minute return.');
      continue;
    }
    if (key === 'return20' && end - completionMinute < 20) {
      outcomes[key] = unavailable('Fewer than four subsequent five-minute candles remain before this window ends.');
      continue;
    }
    if (key !== 'return20' && completionMinute === end) {
      outcomes[key] = unavailable('The breach candle finishes at the window endpoint; no future candles remain.');
      continue;
    }
    if (key !== 'return20' && alreadyReached[key] === true) {
      outcomes[key] = unavailable('This target was already reached by the signal candle; exclude it from future-target forecasting.');
      continue;
    }
    const strengthAdjusted = key === 'return20' && experimentalStrength;
    const local = approvedTime ? baseline.filter(r => completionTimeBlock(r[5]) === timeBlock)
      : strengthAdjusted ? baseline.filter(r => r[6] === strengthBand) : baseline;
    const result = estimate(local, baseline, r => r[column], { adjusted: approvedTime || strengthAdjusted });
    outcomes[key] = {
      ...result, approvedTimeAdjustment: approvedTime, experimental: strengthAdjusted,
      model: approvedTime ? 'time_block' : strengthAdjusted ? 'closing_strength_experimental' : 'side_and_signal_type_baseline',
      filter: approvedTime ? { timeBlock } : strengthAdjusted ? { strengthBand } : null,
      eligibility: key === 'return20' ? 'Close-outside signals with a complete subsequent 20 minutes; inclusive close back inside.' : 'Target not already touched in the signal candle; later same-side high/low touch before this window ends.',
      evidence: approvedTime ? (market === 'ES' ? 'Passed the pre-set test screen; timing result is sensitive to the block-length assumption and needs caution.' : 'Passed the pre-set first-breach timing test screen.') : strengthAdjusted ? 'Exploratory only. No 20-minute return filter passed the adjusted primary test screen.' : 'Historical baseline frequency, not a separately established forecasting improvement.',
    };
  }
  return {
    kind: 'first_breach', schemaVersion: RESEARCH_SCHEMA_VERSION,
    available: Object.values(outcomes).some(r => r.available),
    market, window, side, signalType, completionMinute, timeBlock, remainingMinutes: end - completionMinute,
    strengthBand, asOf, experimentalStrength,
    sample: { n: baseline.length, ...dateSpan(baseline), thinOriginalForecasts: baseline.filter(r => r[11] < 50).length },
    outcomes,
    assumptions: ['Only the first strict high/low breach in the window.', 'Observed only after the signal candle is complete.', 'Signal candle excluded from subsequent returns and target paths.', 'Retrospective history, not an untouched prospective test or trade win rate.'],
  };
}
