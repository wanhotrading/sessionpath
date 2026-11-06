const PREFIX = 'SPPATH1';
const markets = new Set(['CL', 'NQ', 'ES']);
const tags = new Set([
  'DOWN_FINISH', 'DOWN_THEN_BOUNCE', 'DROP_RECOVERY', 'UP_FINISH',
  'UP_THEN_PULLBACK', 'RALLY_FADE', 'NARROW', 'ORDER_UNRESOLVED',
]);
const sessions = ['NTA', 'ASIA', 'LONDON'];
const tickerPattern = /^(?:(?:CME_MINI|COMEX|NYMEX|CME):)?M?(CL|NQ|ES)(?:[12]!|[FGHJKMNQUVXZ]\d{1,4})$/u;

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validCutoff(value) {
  const time = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(value);
  return time !== null && time[0] === value && value >= '08:30' && Number(time[2]) % 5 === 0;
}

export function parseSessionPathCode(text) {
  if (typeof text !== 'string') return null;
  const fields = text.trim().split('|');
  if (fields.length !== 7) return null;
  const [prefix, market, date, cutoff, nta, asia, london] = fields;
  if (prefix !== PREFIX || !markets.has(market) || !validDate(date) || !validCutoff(cutoff)) return null;
  if (![nta, asia, london].every(tag => tags.has(tag))) return null;
  return {market, date, cutoff, choices: {nta, asia, london}};
}

export function makeChartSessionPathCode(body) {
  const observation = body?.chartObservation;
  if (!observation || !Array.isArray(body.shapeTags)) return '';
  const {market, date, cutoff, ticker, timezone, intervalMinutes} = observation;
  const tickerMatch = typeof ticker === 'string' ? tickerPattern.exec(ticker) : null;
  // The response envelope echoes the selected page. The observation identifies the chart.
  if (!markets.has(market) || tickerMatch?.[0] !== ticker || tickerMatch?.[1] !== market) return '';
  if (timezone !== 'America/New_York' || intervalMinutes !== 5 || !validDate(date)) return '';
  if (typeof cutoff !== 'string' || !cutoff.startsWith(`${date}T`)) return '';
  const time = cutoff.slice(11);
  if (!validCutoff(time)) return '';

  const choices = new Map();
  for (const row of body.shapeTags) {
    if (!sessions.includes(row?.session)) continue;
    if (choices.has(row.session) || row.status !== 'archive' || !tags.has(row.tag)) return '';
    choices.set(row.session, row.tag);
  }
  if (choices.size !== sessions.length) return '';
  return [PREFIX, market, date, time, ...sessions.map(session => choices.get(session))].join('|');
}
