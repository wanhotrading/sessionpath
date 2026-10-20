// Pure calculations shared by a browser client and a Node data collector.
// Bar timestamps are UTC epoch seconds marking the START of a five-minute bar.
// Session boundaries are always New York civil times, including DST.

const ZONE = 'America/New_York';
const STEP = 300;
const NY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const MONTH_CODES = { Jan: 'F', Feb: 'G', Mar: 'H', Apr: 'J', May: 'K', Jun: 'M',
  Jul: 'N', Aug: 'Q', Sep: 'U', Oct: 'V', Nov: 'X', Dec: 'Z' };

export class AutoFillError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AutoFillError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new AutoFillError(code, message, details); }
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function dateParts(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    fail('INVALID_DATE', 'Choose a valid trading date.');
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (year < 1970 || value.toISOString().slice(0, 10) !== date)
    fail('INVALID_DATE', 'Choose a valid trading date.');
  return { year, month, day };
}
function shiftDate(date, days) {
  const { year, month, day } = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
function weekday(date) {
  const { year, month, day } = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
function localParts(epochSeconds) {
  const out = {};
  for (const item of NY_FORMAT.formatToParts(new Date(epochSeconds * 1000)))
    if (item.type !== 'literal') out[item.type] = Number(item.value);
  return out;
}

// These session times are unambiguous and exist on NY daylight-saving dates.
export function nyTimeToEpoch(date, time) {
  const { year, month, day } = dateParts(date);
  if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time))
    fail('INVALID_TIME', 'Choose a valid New York time.');
  const [hour, minute] = time.split(':').map(Number);
  if (hour > 23 || minute > 59) fail('INVALID_TIME', 'Choose a valid New York time.');
  const civil = Date.UTC(year, month - 1, day, hour, minute) / 1000;
  let guess = civil;
  for (let attempt = 0; attempt < 5; attempt++) {
    const p = localParts(guess);
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000;
    const correction = civil - represented;
    if (!correction) return guess;
    guess += correction;
  }
  fail('INVALID_TIME', 'That New York time does not exist on this date.');
}

function rootOfSymbol(symbol) {
  if (typeof symbol !== 'string') return null;
  const s = symbol.toUpperCase();
  if (/^(CL|NQ)=F$/.test(s)) return s.slice(0, 2);
  const found = /^(?:(NYMEX|CME_MINI|CME):)?(CL|NQ)([FGHJKMNQUVXZ])(\d{2}|\d{4})(?:\.(NYM|CME))?$/.exec(s);
  if (!found) return null;
  if (found[1] && (found[2] === 'CL' ? found[1] !== 'NYMEX' : !['CME', 'CME_MINI'].includes(found[1]))) return null;
  if (found[5] && (found[2] === 'CL' ? found[5] !== 'NYM' : found[5] !== 'CME')) return null;
  return found[2];
}
function canonicalContract(value) {
  if (typeof value !== 'string') return null;
  const s = value.toUpperCase();
  const found = /^(?:(?:NYMEX|CME_MINI|CME):)?(CL|NQ)([FGHJKMNQUVXZ])(\d{2}|\d{4})(?:\.(?:NYM|CME))?$/.exec(s);
  return found ? `${found[1]}${found[2]}${found[3].length === 2 ? '20' : ''}${found[3]}` : null;
}
function contractFromName(name, root) {
  if (typeof name !== 'string') return null;
  const month = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4}|\d{2})\b/i.exec(name);
  const identifiesRoot = root === 'CL' ? /crude\s+oil/i.test(name) : /nasdaq\s*100/i.test(name);
  if (!month || !identifiesRoot) return null;
  const monthName = month[1][0].toUpperCase() + month[1].slice(1).toLowerCase();
  return `${root}${MONTH_CODES[monthName]}${month[2].length === 2 ? '20' : ''}${month[2]}`;
}

function validateMeta(meta, market, requestedContract) {
  if (!meta || typeof meta !== 'object') fail('INVALID_METADATA', 'The source did not identify the futures contract.');
  if (meta.instrumentType !== 'FUTURE') fail('WRONG_INSTRUMENT', 'Auto-fill requires futures data, not a cash index or CFD.');
  if (meta.intervalSeconds !== STEP) fail('WRONG_INTERVAL', 'The source must provide five-minute candles.');
  const root = rootOfSymbol(meta.symbol);
  if (!root || root !== market || meta.market !== market)
    fail('WRONG_MARKET', `The source does not match ${market} futures.`);
  const contract = canonicalContract(meta.contract);
  if (!contract || rootOfSymbol(contract) !== market)
    fail('INVALID_METADATA', 'The source did not identify the active futures contract.');
  const symbolContract = canonicalContract(meta.symbol);
  if (symbolContract && symbolContract !== contract)
    fail('CONTRACT_MISMATCH', 'The source contains conflicting futures contract metadata.');
  if (typeof meta.source !== 'string' || !meta.source.trim())
    fail('INVALID_METADATA', 'The data source is missing.');
  if (requestedContract !== undefined) {
    const requested = canonicalContract(requestedContract);
    if (!requested || rootOfSymbol(requested) !== market || requested !== contract)
      fail('CONTRACT_MISMATCH', 'The source contract does not match the selected chart contract.');
  }
  return contract;
}

function validateBars(bars, meta, contract) {
  if (!Array.isArray(bars) || !bars.length) fail('INVALID_DATA', 'The source returned no usable five-minute candles.');
  const seen = new Map();
  for (const bar of bars) {
    if (!bar || typeof bar !== 'object' || !Number.isSafeInteger(bar.time) || bar.time % STEP !== 0)
      fail('INVALID_DATA', 'The source returned a malformed candle timestamp.');
    if (seen.has(bar.time)) fail('DUPLICATE_BAR', 'The source returned duplicate candle timestamps.');
    if (!['open', 'high', 'low', 'close'].every(key => finite(bar[key])) ||
        bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.high < bar.low)
      fail('INVALID_DATA', 'The source returned a malformed OHLC candle.', { time: bar.time });
    if (bar.contract !== undefined && canonicalContract(bar.contract) !== contract)
      fail('CONTRACT_MISMATCH', 'The candles contain more than one futures contract.');
    if (bar.symbol !== undefined && bar.symbol !== meta.symbol && canonicalContract(bar.symbol) !== contract)
      fail('CONTRACT_MISMATCH', 'The candles contain conflicting futures symbols.');
    seen.set(bar.time, bar);
  }
  return seen;
}

function completeWindow(byTime, start, end, code, message) {
  const result = [];
  const missing = [];
  for (let time = start; time < end; time += STEP) {
    const bar = byTime.get(time);
    if (!bar) missing.push(time);
    else result.push(bar);
  }
  if (missing.length) fail(code, message, { missingCount: missing.length, firstMissing: missing[0] });
  return result;
}

/**
 * Accepts {bars,meta}, or an array of normalized bars with options.metadata.
 * Every required bar must exist: missing/holiday sessions never silently fall
 * back to an older complete date. Only Saturday/Sunday are skipped for prior NY.
 */
export function calculateContext(feed, options = {}) {
  const { date, cutoff, market, contract: requestedContract, nowMs = Date.now() } = options;
  if (!['CL', 'NQ'].includes(market)) fail('UNSUPPORTED_MARKET', 'Select CL or NQ futures.');
  dateParts(date);
  if ([0, 6].includes(weekday(date))) fail('INVALID_DATE', 'Select a weekday futures trading date.');
  if (!['03:00', '05:00'].includes(cutoff)) fail('INVALID_CUTOFF', 'Auto-fill supports the 03:00 and 05:00 inputs.');
  if (!finite(nowMs)) fail('INVALID_TIME', 'The current time is invalid.');
  const cutoffTime = nyTimeToEpoch(date, cutoff);
  if (nowMs < cutoffTime * 1000) fail('CUTOFF_NOT_REACHED', `Wait until ${cutoff} New York time before auto-filling this date.`);
  const meta = Array.isArray(feed) ? options.metadata : feed?.meta;
  const bars = Array.isArray(feed) ? feed : feed?.bars;
  const contract = validateMeta(meta, market, requestedContract);
  if (!Number.isSafeInteger(meta.quoteTime))
    fail('INVALID_METADATA', 'The source did not report its latest trade time.');
  if (meta.quoteTime < cutoffTime)
    fail('INCOMPLETE_CUTOFF', `The delayed source has not reached ${cutoff} New York time yet. Try again when the data arrives.`);
  const byTime = validateBars(bars, meta, contract);
  let priorDate = shiftDate(date, -1);
  while ([0, 6].includes(weekday(priorDate))) priorDate = shiftDate(priorDate, -1);
  const priorStart = nyTimeToEpoch(priorDate, '09:30');
  const priorEnd = nyTimeToEpoch(priorDate, '16:00');
  const prior = completeWindow(byTime, priorStart, priorEnd, 'INCOMPLETE_PRIOR_NY',
    `The source does not contain all 78 five-minute candles for prior NY (${priorDate}, 09:30–16:00). Fill this session manually.`);
  const overnightDate = shiftDate(date, -1);
  const overnightStart = nyTimeToEpoch(overnightDate, '19:30');
  const overnight = completeWindow(byTime, overnightStart, cutoffTime, 'INCOMPLETE_OVERNIGHT',
    `The source does not yet contain the complete 19:30–${cutoff} window. Try again after the delayed data arrives.`);
  const priorHigh = Math.max(...prior.map(bar => bar.high));
  const priorLow = Math.min(...prior.map(bar => bar.low));
  const rangeHigh = Math.max(...overnight.map(bar => bar.high));
  const rangeLow = Math.min(...overnight.map(bar => bar.low));
  const open1930 = overnight[0].open;
  return {
    priorLow, priorHigh, open1930, rangeHigh, rangeLow,
    up: Math.max(0, rangeHigh - open1930), down: Math.max(0, open1930 - rangeLow),
    date, cutoff, timeZone: ZONE, market, contract,
    priorDate, priorStart, priorEnd, overnightDate, overnightStart, cutoffTime,
    priorBarCount: prior.length, overnightBarCount: overnight.length,
    source: meta.source, symbol: meta.symbol,
    quoteTime: meta.quoteTime ?? null, sourceDate: meta.sourceDate ?? null,
    continuous: meta.continuous === true,
    contractBasis: meta.contractBasis ?? 'explicit-symbol',
  };
}

/** Normalize Yahoo's chart JSON without requesting a network resource. */
export function normalizeYahooChart(payload, { market } = {}) {
  const chart = payload?.chart;
  if (!chart || chart.error || !Array.isArray(chart.result) || chart.result.length !== 1)
    fail('SOURCE_ERROR', 'The delayed-data source returned an error or an empty chart.');
  const result = chart.result[0];
  const rawMeta = result?.meta;
  const quote = result?.indicators?.quote;
  if (!rawMeta || !Array.isArray(result.timestamp) || !Array.isArray(quote) || quote.length !== 1)
    fail('INVALID_DATA', 'The delayed-data chart response is incomplete.');
  const root = rootOfSymbol(rawMeta.symbol);
  if (!root || (market !== undefined && root !== market)) fail('WRONG_MARKET', 'The source returned the wrong futures market.');
  if (rawMeta.instrumentType !== 'FUTURE') fail('WRONG_INSTRUMENT', 'Auto-fill requires futures data, not a cash index or CFD.');
  if (rawMeta.dataGranularity !== '5m') fail('WRONG_INTERVAL', 'The delayed-data chart must use five-minute candles.');
  const explicitContract = canonicalContract(rawMeta.symbol);
  const namedContract = contractFromName(rawMeta.shortName ?? rawMeta.longName, root);
  if (explicitContract && namedContract && explicitContract !== namedContract)
    fail('CONTRACT_MISMATCH', 'The source names a different contract from its futures symbol.');
  const contract = explicitContract ?? namedContract;
  if (!contract) fail('INVALID_METADATA', 'The source did not identify the active futures delivery month.');
  const q = quote[0];
  const count = result.timestamp.length;
  for (const key of ['open', 'high', 'low', 'close'])
    if (!Array.isArray(q?.[key]) || q[key].length !== count)
      fail('INVALID_DATA', 'The delayed-data candle arrays have different lengths.');
  const bars = [];
  const omitted = { nullTimes: [], irregularQuoteTimes: [] };
  const timestamps = new Set();
  for (let index = 0; index < count; index++) {
    const time = result.timestamp[index];
    if (!Number.isSafeInteger(time)) fail('INVALID_DATA', 'The source returned a malformed candle timestamp.');
    if (timestamps.has(time)) fail('DUPLICATE_BAR', 'The source returned duplicate candle timestamps.');
    timestamps.add(time);
    // Yahoo can append its latest quote after the regular interval candles.
    // This quote is never treated as a completed five-minute candle.
    if (time % STEP !== 0) {
      if (index !== count - 1) fail('INVALID_DATA', 'The source returned an off-grid historical candle.');
      omitted.irregularQuoteTimes.push(time);
      continue;
    }
    const bar = { time, open: q.open[index], high: q.high[index], low: q.low[index], close: q.close[index] };
    // Nulls can occur during off-session intervals. Required-window coverage is
    // validated separately; a missing required candle always stops auto-fill.
    if (['open', 'high', 'low', 'close'].some(key => bar[key] === null || bar[key] === undefined)) {
      omitted.nullTimes.push(time);
      continue;
    }
    bars.push(bar);
  }
  const meta = {
    source: 'Yahoo Finance delayed futures chart', symbol: rawMeta.symbol, market: root,
    contract, instrumentType: rawMeta.instrumentType, intervalSeconds: STEP,
    continuous: !explicitContract,
    contractBasis: explicitContract ? 'explicit-symbol' : 'provider-short-name',
    quoteTime: Number.isSafeInteger(rawMeta.regularMarketTime) ? rawMeta.regularMarketTime : null,
    sourceDate: Number.isSafeInteger(rawMeta.regularMarketTime)
      ? new Date(rawMeta.regularMarketTime * 1000).toISOString() : null,
    exchangeTimeZone: rawMeta.exchangeTimezoneName ?? null,
    shortName: rawMeta.shortName ?? null,
    omitted,
  };
  validateMeta(meta, root);
  validateBars(bars, meta, contract);
  return { bars, meta };
}
