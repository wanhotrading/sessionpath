const endpointOutcomes = {
  hh: row => row[4] & 1 ? 1 : 0,
  ll: row => row[4] & 2 ? 1 : 0,
  both: row => Number(row[4] === 3),
  neither: row => Number(row[4] === 0),
};
const breachColumns = {reach120: 7, reach130: 8, return20: 9};
const benchmarks = new WeakMap();
const empty = {n: 0, successes: 0};
const tieTolerance = 1e-10;

function updateCount(counts, key, value) {
  let count = counts.get(key);
  if (!count) {
    count = {n: 0, successes: 0};
    counts.set(key, count);
  }
  count.n++;
  count.successes += value;
}

// Simulate the probability available on each historical observation date.
// Use the existing model's fixed prior and approved time adjustment. Neither
// an observation's result nor another result on that date enters its estimate.
function distribution(data, {kind, market, window, date, metric, timeAdjusted, priorWeight}) {
  const continuation = kind === 'endpoint';
  const marketIndex = data.enums.markets.indexOf(market);
  const windowIndex = (continuation ? data.enums.endpointWindows : data.enums.breachWindows).indexOf(window);
  if (marketIndex < 0 || windowIndex < 0) return [];
  const values = continuation ? endpointOutcomes[metric] : row => row[breachColumns[metric]];
  const rows = data[kind].filter(row => row[0] < date && row[1] === marketIndex && row[2] === windowIndex)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const samples = [];
  const broad = new Map();
  const groups = new Map();
  const minHistory = continuation ? 100 : 50;
  const compareGroup = row => continuation ? '*' : `${row[3]}:${row[4]}`;
  const localGroup = row => continuation ? row[3] : `${compareGroup(row)}:${Math.floor(row[5] / 30)}`;

  for (let start = 0; start < rows.length;) {
    let end = start + 1;
    while (end < rows.length && rows[end][0] === rows[start][0]) end++;
    for (let i = start; i < end; i++) {
      const row = rows[i];
      const value = values(row);
      if (value !== 0 && value !== 1) continue;
      const baseline = broad.get(compareGroup(row));
      if (!baseline || baseline.n < minHistory) continue;
      const baseProbability = (baseline.successes + 1) / (baseline.n + 2);
      const local = groups.get(localGroup(row)) ?? empty;
      samples.push(continuation || timeAdjusted ?
        (local.successes + priorWeight * baseProbability) / (local.n + priorWeight) : baseProbability);
    }
    for (let i = start; i < end; i++) {
      const row = rows[i];
      const value = values(row);
      if (value !== 0 && value !== 1) continue;
      updateCount(broad, compareGroup(row), value);
      if (continuation || timeAdjusted) updateCount(groups, localGroup(row), value);
    }
    start = end;
  }
  return samples;
}

export function percentileBand(percentile) {
  if (percentile <= 10 || percentile >= 90) return 'tail';
  if (percentile < 25) return 'low';
  if (percentile >= 70) return 'high';
  return 'middle';
}

export function rankFollowup(data, result, priorWeight) {
  if (!benchmarks.has(data)) benchmarks.set(data, new Map());
  const cache = benchmarks.get(data);
  const kind = result.kind === 'endpoint_continuation' ? 'endpoint' : 'breach';
  const {market, window, asOf: date} = result;
  const ranks = {};
  for (const [metric, outcome] of Object.entries(result.outcomes)) {
    if (!outcome.available || !Number.isFinite(outcome.probability)) continue;
    const timeAdjusted = outcome.approvedTimeAdjustment === true;
    const key = [kind, market, window, date, metric, timeAdjusted, priorWeight].join('|');
    if (!cache.has(key)) {
      if (cache.size >= 56) cache.delete(cache.keys().next().value);
      cache.set(key, distribution(data, {kind, market, window, date, metric, timeAdjusted, priorWeight}));
    }
    const samples = cache.get(key);
    if (samples.length < 20) continue;
    let below = 0;
    let ties = 0;
    for (const value of samples) {
      const difference = value - outcome.probability;
      if (Math.abs(difference) <= tieTolerance) ties++;
      else if (difference < 0) below++;
    }
    const percentile = (below + ties / 2) / samples.length * 100;
    ranks[metric] = {percentile, band: percentileBand(percentile), comparisons: samples.length};
  }
  return ranks;
}
