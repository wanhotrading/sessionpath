// CFTC counts are positions outstanding, not executed orders or price forecasts.
export const COT_PARTICIPANTS = {
  CL: [
    { id: 'producer', label: 'Producers / merchants', role: 'Physical businesses managing commodity exposure; net positions do not establish speculative conviction.' },
    { id: 'swap', label: 'Swap dealers', role: 'Intermediated swap exposure and hedging; the final clients and their full portfolios are not identified.' },
    { id: 'managed', label: 'Managed money', role: 'Money managers holding directional and hedged futures exposure.' },
    { id: 'other', label: 'Other reportables', role: 'Other reportable traders with varied investment and hedging purposes.' },
    { id: 'nonreportable', label: 'Nonreportables', role: 'Residual positions below reporting thresholds; not a uniform retail strategy.' },
  ],
  TFF: [
    { id: 'asset', label: 'Asset managers', role: 'Institutional investment and hedging; structural longs are not necessarily fresh bullish purchases.' },
    { id: 'leveraged', label: 'Leveraged funds', role: 'Directional, arbitrage and hedged strategies; a futures short may offset exposure elsewhere.' },
    { id: 'dealer', label: 'Dealers / intermediaries', role: 'Client intermediation and risk management; net shorts do not identify dealer gamma or bearish conviction.' },
    { id: 'other', label: 'Other reportables', role: 'Other reportable investment and business hedging exposures.' },
    { id: 'nonreportable', label: 'Nonreportables', role: 'Residual positions below reporting thresholds; not a uniform retail strategy.' },
  ],
};

const DAY = 86400000;
const ratio = (value, denominator) => Number.isFinite(value) && denominator > 0 ? 100 * value / denominator : null;
const difference = (a, b) => Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
const daysBetween = (a, b) => (Date.parse(a) - Date.parse(b)) / DAY;
const net = participant => participant.long - participant.short;
const gross = (participant, side) => participant.spreading === null && participant.spreadReported !== false ? null : participant[side] + (participant.spreading ?? 0);

/** Midrank against a prior-only reference; this is not a COT min/max index. */
export function empiricalPercentile(value, reference) {
  const values = reference.filter(Number.isFinite);
  if (!Number.isFinite(value) || !values.length) return null;
  const less = values.filter(v => v < value).length;
  const equal = values.filter(v => v === value).length;
  return 100 * (less + equal / 2) / values.length;
}

export function prepareRows(input) {
  if (!Array.isArray(input) || !input.length) throw new Error('No COT rows supplied.');
  const byDate = new Map();
  for (const raw of input) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date) || !Number.isFinite(Date.parse(raw.date)) || new Date(raw.date).toISOString().slice(0, 10) !== raw.date) throw new Error('Invalid COT snapshot date.');
    if (!(Number.isFinite(raw.openInterest) && raw.openInterest > 0) || !raw.participants || typeof raw.participants !== 'object') throw new Error('Missing COT open interest or participant positions.');
    for (const p of Object.values(raw.participants)) {
      if (![p.long, p.short].every(x => Number.isFinite(x) && x >= 0)) throw new Error('Invalid COT long/short positions.');
      if (p.spreading !== null && !(Number.isFinite(p.spreading) && p.spreading >= 0)) throw new Error('Invalid COT spreading positions.');
    }
    if (byDate.has(raw.date) && JSON.stringify(byDate.get(raw.date)) !== JSON.stringify(raw)) throw new Error(`Conflicting COT rows for ${raw.date}.`);
    byDate.set(raw.date, raw);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function compatibleWindow(rows, index, weeks) {
  if (index < weeks) return null;
  const earlier = rows[index - weeks];
  if (Math.abs(daysBetween(rows[index].date, earlier.date) - 7 * weeks) > 2) return null;
  for (let i = index - weeks + 1; i <= index; i++) {
    const gap = daysBetween(rows[i].date, rows[i - 1].date);
    if (gap < 6 || gap > 8) return null;
  }
  return earlier;
}

function rowFlow(rows, index, id) {
  const previous = compatibleWindow(rows, index, 1);
  return previous && previous.participants[id] ? ratio(net(rows[index].participants[id]) - net(previous.participants[id]), previous.openInterest) : null;
}

function referenceContext(rows, index, id, window) {
  const prior = rows.slice(Math.max(0, index - window), index);
  const positions = prior.map(row => row.participants[id] ? ratio(net(row.participants[id]), row.openInterest) : null).filter(Number.isFinite);
  const flows = prior.map((_, offset) => rowFlow(rows, Math.max(0, index - window) + offset, id)).filter(Number.isFinite);
  const current = rows[index];
  const currentFlow = rowFlow(rows, index, id);
  return {
    n: positions.length, flowN: flows.length, fullWindow: positions.length === window && flows.length === window,
    netPercentile: positions.length === window ? empiricalPercentile(ratio(net(current.participants[id]), current.openInterest), positions) : null,
    flowPercentile: flows.length === window ? empiricalPercentile(currentFlow, flows) : null,
    absFlowPercentile: flows.length === window && Number.isFinite(currentFlow) ? empiricalPercentile(Math.abs(currentFlow), flows.map(Math.abs)) : null,
  };
}

export function describeMechanism(weekly, grossAvailable) {
  if (!Number.isFinite(weekly.net)) return 'Comparable previous-week data unavailable.';
  const longs = grossAvailable ? weekly.grossLong : weekly.long;
  const shorts = grossAvailable ? weekly.grossShort : weekly.short;
  const prefix = grossAvailable ? 'Gross' : 'Reported residual';
  if (weekly.net === 0) return `${prefix} changes left net exposure unchanged.`;
  if (weekly.net > 0) {
    if (longs > 0 && shorts < 0) return `${prefix} long additions and short reductions increased net exposure.`;
    if (longs > 0 && shorts === 0) return `${prefix} long additions increased net exposure; shorts were unchanged.`;
    if (longs === 0 && shorts < 0) return `${prefix} short reductions increased net exposure; longs were unchanged.`;
    if (longs < 0 && shorts < 0) return `${prefix} sides contracted; short reductions were larger, improving net exposure.`;
    if (longs > 0 && shorts > 0) return `${prefix} sides grew; long additions were larger, improving net exposure.`;
    return `${prefix} changes increased net exposure.`;
  }
  if (longs < 0 && shorts > 0) return `${prefix} long reductions and short additions reduced net exposure.`;
  if (longs < 0 && shorts === 0) return `${prefix} long reductions reduced net exposure; shorts were unchanged.`;
  if (longs === 0 && shorts > 0) return `${prefix} short additions reduced net exposure; longs were unchanged.`;
  if (longs < 0 && shorts < 0) return `${prefix} sides contracted; long reductions were larger, weakening net exposure.`;
  if (longs > 0 && shorts > 0) return `${prefix} sides grew; short additions were larger, weakening net exposure.`;
  return `${prefix} changes reduced net exposure.`;
}

const pctText = value => Number.isFinite(value) ? `${Math.abs(value).toFixed(2)}% of previous OI` : 'unavailable';

function assessBias(instrument, participants, oi) {
  const find = id => participants.find(p => p.id === id);
  const limitations = [
    'A positioning reading, not a validated next-week price forecast or trading probability.',
    'Category nets balance against counterpart groups; they are not independent confirmations.',
    'COT covers the report’s maturities and is delayed, not the current intraday chart.',
  ];
  const mainParticipants = instrument === 'CL' ? [find('managed')] : [find('asset'), find('leveraged')];
  if (mainParticipants.some(p => !Number.isFinite(p.weekly.net))) {
    return {
      label: 'Weekly comparison unavailable', direction: 'neutral',
      summary: 'The current position levels are available, but there is no compatible previous-week snapshot. No weekly positioning bias is assigned.',
      evidence: ['A missing comparison is not an unchanged position or zero flow.'], limitations,
    };
  }
  if (instrument === 'CL') {
    const p = find('managed');
    const sign = Math.sign(p.weekly.net ?? 0);
    const label = sign < 0 ? 'Managed money weakened' : sign > 0 ? 'Managed money strengthened' : 'Managed money unchanged';
    return {
      label, direction: sign < 0 ? 'bearish' : sign > 0 ? 'bullish' : 'neutral',
      summary: `${label}, ${sign < 0 ? 'reducing' : sign > 0 ? 'adding' : 'with no change to'} net exposure${sign ? ` by ${pctText(p.weekly.flowPctPrevOI)}` : ''}. ${p.mechanism}`,
      evidence: [
        `${p.net >= 0 ? 'Still net long' : 'Still net short'}: ${Math.abs(p.net).toLocaleString('en-US')} contracts (${p.netPctOI.toFixed(2)}% of OI).`,
        Number.isFinite(oi.change) && Number.isFinite(oi.changePct) ? `Open interest ${oi.change >= 0 ? 'increased' : 'decreased'} ${Math.abs(oi.change).toLocaleString('en-US')} (${Math.abs(oi.changePct).toFixed(2)}%). OI alone is not directional cash flow.` : 'Comparable weekly OI change unavailable.',
        `Two-week net change: ${p.flow2wPct === null ? 'unavailable' : p.flow2wPct.toFixed(2) + '% of its starting OI'}; four-week: ${p.flow4wPct === null ? 'unavailable' : p.flow4wPct.toFixed(2) + '% of its starting OI'}.`,
      ], limitations,
    };
  }
  const asset = find('asset'), leveraged = find('leveraged');
  const a = Math.sign(asset.weekly.net ?? 0), l = Math.sign(leveraged.weekly.net ?? 0);
  const aligned = a && a === l;
  const unchanged = a === 0 && l === 0;
  const direction = unchanged ? 'neutral' : aligned ? (a > 0 ? 'bullish' : 'bearish') : 'mixed';
  const label = unchanged ? 'Buy-side nets unchanged' : aligned ? (a > 0 ? 'Buy-side nets improved' : 'Buy-side nets weakened') : 'Buy-side positioning is mixed';
  return {
    label, direction,
    summary: `${label}. Asset managers ${a > 0 ? 'increased' : a < 0 ? 'reduced' : 'held'} net exposure; leveraged funds ${l > 0 ? 'increased' : l < 0 ? 'reduced' : 'held'} theirs. This describes the weekly shift, not the direction of their complete portfolios.`,
    evidence: [
      `Asset managers: ${asset.weekly.flowPctPrevOI?.toFixed(2) ?? 'unavailable'}% of previous OI. ${asset.mechanism}`,
      `Leveraged funds: ${leveraged.weekly.flowPctPrevOI?.toFixed(2) ?? 'unavailable'}% of previous OI. ${leveraged.mechanism}`,
      `Leveraged funds remain ${leveraged.net < 0 ? 'net short' : 'net long'} (${leveraged.netPctOI.toFixed(2)}% of OI). Futures shorts can hedge exposure held elsewhere.`,
    ], limitations,
  };
}

export function computeMarket(input, metadata) {
  const rows = prepareRows(input), index = rows.length - 1, current = rows[index];
  const previous = compatibleWindow(rows, index, 1);
  const definitions = COT_PARTICIPANTS[metadata.instrument === 'CL' ? 'CL' : 'TFF'];
  for (const row of rows) for (const definition of definitions) if (!row.participants[definition.id]) throw new Error(`Missing participant ${definition.id}.`);
  const participants = definitions.map(definition => {
    const id = definition.id, p = current.participants[id], before = previous?.participants[id];
    const grossLong = gross(p, 'long'), grossShort = gross(p, 'short');
    const weekly = {
      long: difference(p.long, before?.long), short: difference(p.short, before?.short),
      spreading: p.spreading === null ? null : difference(p.spreading, before?.spreading),
      net: before ? net(p) - net(before) : null,
      grossLong: before ? difference(grossLong, gross(before, 'long')) : null,
      grossShort: before ? difference(grossShort, gross(before, 'short')) : null,
      flowPctPrevOI: rowFlow(rows, index, id),
    };
    const persistence = weeks => {
      const earlier = compatibleWindow(rows, index, weeks);
      return earlier ? ratio(net(p) - net(earlier.participants[id]), earlier.openInterest) : null;
    };
    return {
      ...definition, long: p.long, short: p.short, spreading: p.spreading, spreadReported: p.spreadReported,
      net: net(p), grossLong, grossShort, weekly, netPctOI: ratio(net(p), current.openInterest),
      flow2wPct: persistence(2), flow4wPct: persistence(4),
      context: { 52: referenceContext(rows, index, id, 52), 156: referenceContext(rows, index, id, 156) },
      mechanism: describeMechanism(weekly, grossLong !== null && grossShort !== null),
    };
  });
  const oi = {
    value: current.openInterest, change: previous ? current.openInterest - previous.openInterest : null,
    changePct: previous ? ratio(current.openInterest - previous.openInterest, previous.openInterest) : null,
    context: Object.fromEntries([52, 156].map(window => {
      const prior = rows.slice(Math.max(0, index - window), index).map(r => r.openInterest);
      return [window, { n: prior.length, percentile: prior.length === window ? empiricalPercentile(current.openInterest, prior) : null }];
    })),
  };
  const reconciliation = {
    longDifference: participants.some(p => p.grossLong === null) ? null : participants.reduce((sum, p) => sum + p.grossLong, 0) - current.openInterest,
    shortDifference: participants.some(p => p.grossShort === null) ? null : participants.reduce((sum, p) => sum + p.grossShort, 0) - current.openInterest,
    netSum: participants.reduce((sum, p) => sum + p.net, 0),
  };
  return {
    ...metadata, snapshotDate: current.date, previousDate: previous?.date ?? null,
    coverage: { start: rows[0].date, end: current.date, observations: rows.length },
    openInterest: oi, participants, bias: assessBias(metadata.instrument, participants, oi),
    quality: { ...(metadata.quality ?? {}), reconciliation },
    history: rows.slice(-157).map((r, offset) => {
      const rowIndex = Math.max(0, rows.length - 157) + offset;
      return { date: r.date, openInterest: r.openInterest, participants: Object.fromEntries(definitions.map(({ id }) => [id, {
        net: net(r.participants[id]), netPctOI: ratio(net(r.participants[id]), r.openInterest), flowPctPrevOI: rowFlow(rows, rowIndex, id),
      }])) };
    }),
  };
}

export function compareEquityMarkets(nq, es) {
  if (nq.snapshotDate !== es.snapshotDate) return { available: false, note: 'NQ and ES dates differ; a same-date comparison is unavailable.' };
  return {
    available: true, snapshotDate: nq.snapshotDate,
    note: 'Compare each market using its own OI. These differences do not identify paired rotation or forecast NQ/ES relative returns.',
    participants: nq.participants.map(p => {
      const other = es.participants.find(row => row.id === p.id);
      return {
        id: p.id, label: p.label, nqNetPctOI: p.netPctOI, esNetPctOI: other.netPctOI,
        nqFlowPctPrevOI: p.weekly.flowPctPrevOI, esFlowPctPrevOI: other.weekly.flowPctPrevOI,
        flowDifferencePp: difference(p.weekly.flowPctPrevOI, other.weekly.flowPctPrevOI),
        netDifferencePp: difference(p.netPctOI, other.netPctOI),
      };
    }),
  };
}
