// Build replaces the empty index with labels from the published research and
// supplemental native candles. The vision model never sees archive outcomes.
const CHART_SHAPE_ARCHIVE = {};
const CHART_ARCHIVE_TAG_CODES = [null,'DOWN_FINISH','DOWN_THEN_BOUNCE','DROP_RECOVERY','UP_FINISH','UP_THEN_PULLBACK','RALLY_FADE','NARROW','ORDER_UNRESOLVED'];

export function resolveChartShapeArchive(evidence, observation) {
  if (!evidence?.ticker || !observation?.chartObservation || evidence.intervalMinutes !== 5) return observation;
  const {market, date} = observation.chartObservation;
  const symbol = evidence.ticker.split(':').at(-1);
  const row = CHART_SHAPE_ARCHIVE[`${market}|${symbol}|${date}`];
  if (!row || row[0] !== evidence.priorNyHigh || row[1] !== evidence.priorNyLow || row[2] !== evidence.open1930) return observation;
  const sessions = ['NTA', 'ASIA', 'LONDON', 'NY'];
  const cutoff = observation.chartObservation.cutoff;
  if (typeof cutoff !== 'string') return observation;
  const eve = new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0,10);
  const ends = [`${eve}T19:30`, `${date}T02:00`, `${date}T08:30`, `${date}T16:00`];
  const rows = new Map(observation.shapeTags.map(value => [value.session, value]));
  const shapeTags = sessions.map((session, index) => {
    const existing = rows.get(session);
    if (cutoff < ends[index]) return existing;
    const tag = CHART_ARCHIVE_TAG_CODES[row[3][index]];
    return tag ? {session, tag, status: 'archive', reason: 'Matched the archived symbol, date, BBOX and 19:30 open. This tag comes from completed five-minute candles.'} : existing;
  }).filter(Boolean);
  return {...observation, shapeTags};
}
