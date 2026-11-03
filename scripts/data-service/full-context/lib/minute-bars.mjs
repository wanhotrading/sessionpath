import { AutoFillError, normalizeYahooChart, MARKET_CONFIG, normalizeGoldPrice, canonicalContract, rootOfSymbol } from './context-calculations.mjs';

const OHLC = ['open', 'high', 'low', 'close'];
const MONTH_CODES = { Jan: 'F', Feb: 'G', Mar: 'H', Apr: 'J', May: 'K', Jun: 'M',
  Jul: 'N', Aug: 'Q', Sep: 'U', Oct: 'V', Nov: 'X', Dec: 'Z' };
function fail(code, message) { throw new AutoFillError(code, message); }

function readNativeCandles(feed, payload, { market, contract, nowMs, intervalSeconds }) {
  const chart = payload?.chart;
  if (!chart || chart.error || !Array.isArray(chart.result) || chart.result.length !== 1)
    fail('SOURCE_ERROR', 'The one-minute source returned an error or an empty chart.');
  const result = chart.result[0], rawMeta = result?.meta, quotes = result?.indicators?.quote;
  if (!rawMeta || !Array.isArray(result.timestamp) || !Array.isArray(quotes) || quotes.length !== 1)
    fail('INVALID_DATA', 'The one-minute source returned an incomplete chart.');
  if (!Object.hasOwn(MARKET_CONFIG,market) || feed?.meta?.market !== market || feed?.meta?.contract !== contract || feed?.meta?.continuous !== false)
    fail('CONTRACT_MISMATCH', 'The missing candles require the same explicit futures contract.');
  if (rawMeta.instrumentType !== 'FUTURE')
    fail('WRONG_INSTRUMENT', 'The one-minute source must identify futures data.');
  if (![60, 120].includes(intervalSeconds) || rawMeta.dataGranularity !== `${intervalSeconds / 60}m`)
    fail('WRONG_INTERVAL', 'The supplementary source must provide the requested native one- or two-minute interval.');
  const suffix = MARKET_CONFIG[market].suffix;
  const symbolMatch = new RegExp('^' + market + '([FGHJKMNQUVXZ])(\\d{2}|\\d{4})\\.' + suffix + '$').exec(String(rawMeta.symbol || '').toUpperCase());
  const minuteContract = symbolMatch && market + symbolMatch[1] + (symbolMatch[2].length === 2 ? '20' : '') + symbolMatch[2];
  if (!minuteContract || minuteContract !== contract)
    fail('CONTRACT_MISMATCH', 'The one-minute source identifies a different futures contract.');
  const name = rawMeta.shortName ?? rawMeta.longName;
  if (typeof name === 'string') {
    const month = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\s-]+(\d{4}|\d{2})\b/i.exec(name);
    const namedRoot = /crude\s+oil/i.test(name) ? 'CL' : /nasdaq\s*100/i.test(name) ? 'NQ' : /(?:s\s*&\s*p|s\s+and\s+p)\s*500/i.test(name) ? 'ES' : /\bgold\b/i.test(name)?(/\b(?:micro|mini)\b/i.test(name)?'MGC':'GC'):null;
    if (namedRoot && namedRoot !== market) fail('CONTRACT_MISMATCH', 'The native-minute source names another futures market.');
    if (month && namedRoot) {
      const monthName = month[1][0].toUpperCase() + month[1].slice(1).toLowerCase();
      if (namedRoot + MONTH_CODES[monthName] + (month[2].length === 2 ? '20' : '') + month[2] !== contract)
        fail('CONTRACT_MISMATCH', 'The native-minute source names another futures contract.');
    }
  }
  if (!Number.isSafeInteger(rawMeta.regularMarketTime) || !Number.isFinite(nowMs))
    fail('INVALID_METADATA', 'The one-minute source did not identify its completed-data time.');
  const count = result.timestamp.length, q = quotes[0];
  for (const key of OHLC) if (!Array.isArray(q?.[key]) || q[key].length !== count)
    fail('INVALID_DATA', 'The one-minute candle arrays have different lengths.');

  const seen = new Set(), bars = new Map();
  const completedThrough = Math.min(Math.floor(nowMs / 1000), rawMeta.regularMarketTime);
  for (let index = 0; index < count; index++) {
    const time = result.timestamp[index];
    if (!Number.isSafeInteger(time)) fail('INVALID_DATA', 'The one-minute source returned a malformed timestamp.');
    if (seen.has(time)) fail('DUPLICATE_BAR', 'The one-minute source returned duplicate timestamps.');
    seen.add(time);
    // Yahoo may append a current trade after its interval candles. Never use it.
    if (time % intervalSeconds !== 0) {
      if (index !== count - 1) fail('INVALID_DATA', 'The one-minute source returned an off-grid historical candle.');
      continue;
    }
    const bar = Object.fromEntries([['time', time], ...OHLC.map(key => [key, q[key][index]])]);
    if (OHLC.some(key => bar[key] === null || bar[key] === undefined)) continue;
    if (!OHLC.every(key => typeof bar[key] === 'number' && Number.isFinite(bar[key])) ||
        bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.high < bar.low)
      fail('INVALID_DATA', 'The one-minute source returned malformed OHLC prices.');
    if(market==='GC')for(const key of OHLC)bar[key]=normalizeGoldPrice(bar[key]);
    if (time + intervalSeconds <= completedThrough) bars.set(time, { ...bar, intervalSeconds });
  }
  return { bars, rawMeta, result };
}

/**
 * Fill only absent 5m bars with an exact non-overlapping cover of completed
 * native 1m/2m candles. Each source interval must lie wholly inside that 5m
 * window. No estimates, partial bars, splitting, or existing-bar replacement.
 */
export function fillMissingFiveMinuteBars(feed, payload, { market, contract, nowMs, twoMinutePayload } = {}) {
  const options = { market, contract, nowMs };
  const one = readNativeCandles(feed, payload, { ...options, intervalSeconds: 60 });
  const two = twoMinutePayload === undefined ? null : readNativeCandles(feed, twoMinutePayload, { ...options, intervalSeconds: 120 });
  const { result, rawMeta } = one;
  const starts = new Set([...one.bars.keys(), ...(two?.bars.keys() || [])].map(time => time - time % 300));
  const groups = [];
  for (const time of [...starts].sort((a, b) => a - b)) {
    const end = time + 300;
    function exactCover(at) {
      if (at === end) return [];
      for (const bar of [one.bars.get(at), two?.bars.get(at)]) {
        if (!bar || at + bar.intervalSeconds > end) continue;
        const rest = exactCover(at + bar.intervalSeconds);
        if (rest) return [bar, ...rest];
      }
      return null;
    }
    const cover = exactCover(time);
    if (!cover) continue;
    groups.push({ time, open: cover[0].open, high: Math.max(...cover.map(bar => bar.high)),
      low: Math.min(...cover.map(bar => bar.low)), close: cover[cover.length - 1].close });
  }
  // No complete group can contribute a price; retain the original coverage error.
  if (!groups.length) return { feed, filledTimes: [] };
  // Reuse all existing five-minute metadata and OHLC checks on the real aggregates.
  const normalized = normalizeYahooChart({ chart: { error: null, result: [{
    ...result, meta: { ...rawMeta, dataGranularity: '5m' }, timestamp: groups.map(bar => bar.time),
    indicators: { quote: [Object.fromEntries(OHLC.map(key => [key, groups.map(bar => bar[key])]))] },
  }] } }, { market });
  if (normalized.meta.continuous || normalized.meta.contract !== contract)
    fail('CONTRACT_MISMATCH', 'The one-minute source does not match the verified futures contract.');
  const existing = new Set(feed.bars.map(bar => bar.time));
  const additions = normalized.bars.filter(bar => !existing.has(bar.time));
  return {
    feed: { bars: [...feed.bars, ...additions].sort((a, b) => a.time - b.time), meta: feed.meta },
    filledTimes: additions.map(bar => bar.time),
  };
}

/**
 * Recover an absent native 15m candle only from all three completed 5m candles
 * in the same contract. Different source intervals can have complementary gaps.
 * Existing 15m candles and the genuine 5m observation feed stay unchanged.
 */
export function fillMissingFifteenMinuteBars(coarse, fine, { market, contract, nowMs } = {}) {
  if (!Object.hasOwn(MARKET_CONFIG, market) || canonicalContract(contract) !== contract || rootOfSymbol(contract) !== market)
    fail('CONTRACT_MISMATCH', 'Fifteen-minute recovery requires a verified futures delivery contract.');
  if (!Number.isFinite(nowMs)) fail('INVALID_TIME', 'The recovery clock is unavailable.');
  function checked(feed, intervalSeconds) {
    const meta = feed?.meta;
    if (!meta || meta.market !== market || meta.continuous !== false || canonicalContract(meta.contract) !== contract ||
        canonicalContract(meta.symbol) !== contract || rootOfSymbol(meta.symbol) !== market)
      fail('CONTRACT_MISMATCH', 'The recovery charts must identify the same explicit futures contract.');
    if (meta.instrumentType !== 'FUTURE') fail('WRONG_INSTRUMENT', 'Recovery requires futures candles.');
    if (meta.intervalSeconds !== intervalSeconds) fail('WRONG_INTERVAL', 'Recovery requires native five- and fifteen-minute charts.');
    if (!Number.isSafeInteger(meta.quoteTime)) fail('INVALID_METADATA', 'The recovery chart did not identify its latest trade time.');
    if (!Array.isArray(feed.bars)) fail('INVALID_DATA', 'The recovery chart returned no candle array.');
    const map = new Map();
    for (const bar of feed.bars) {
      if (!bar || !Number.isSafeInteger(bar.time) || bar.time % intervalSeconds !== 0)
        fail('INVALID_DATA', 'The recovery chart returned a malformed timestamp.');
      if (map.has(bar.time)) fail('DUPLICATE_BAR', 'The recovery chart returned duplicate timestamps.');
      if (!OHLC.every(key => typeof bar[key] === 'number' && Number.isFinite(bar[key])) ||
          bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.high < bar.low)
        fail('INVALID_DATA', 'The recovery chart returned malformed OHLC prices.');
      if (bar.contract !== undefined && canonicalContract(bar.contract) !== contract ||
          bar.symbol !== undefined && canonicalContract(bar.symbol) !== contract)
        fail('CONTRACT_MISMATCH', 'The recovery candles contain another futures contract.');
      if (market === 'GC') for (const key of OHLC) normalizeGoldPrice(bar[key]);
      map.set(bar.time, bar);
    }
    return map;
  }
  const existing = checked(coarse, 900), five = checked(fine, 300);
  const completedThrough = Math.min(Math.floor(nowMs / 1000), coarse.meta.quoteTime, fine.meta.quoteTime);
  const starts = new Set([...five.keys()].map(time => time - time % 900)), additions = [];
  for (const time of [...starts].sort((a, b) => a - b)) {
    if (existing.has(time) || time + 900 > completedThrough) continue;
    const rows = [five.get(time), five.get(time + 300), five.get(time + 600)];
    if (rows.some(bar => !bar)) continue;
    additions.push({ time, open: rows[0].open, high: Math.max(...rows.map(bar => bar.high)),
      low: Math.min(...rows.map(bar => bar.low)), close: rows[2].close });
  }
  if (!additions.length) return { feed: coarse, filledTimes: [] };
  return { feed: { meta: coarse.meta, bars: [...coarse.bars, ...additions].sort((a, b) => a.time - b.time) },
    filledTimes: additions.map(bar => bar.time) };
}
