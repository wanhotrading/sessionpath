import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateContext, normalizeYahooChart, nyTimeToEpoch, AutoFillError } from './context-calculations.mjs';

const sec = iso => Date.parse(iso) / 1000;
const options = { date: '2026-10-20', cutoff: '03:00', market: 'CL', nowMs: Date.parse('2026-10-20T08:00:00Z') };
function candles(start, count) {
  return Array.from({ length: count }, (_, i) => ({ time: start + i * 300, open: 100, high: 101, low: 99, close: 100 }));
}
function feedFor({ priorStart = sec('2026-10-19T13:30:00Z'), overnightStart = sec('2026-10-19T23:30:00Z'), count = 90,
  symbol = 'CLZ26.NYM', contract = 'CLZ2026', market = 'CL', quoteTime = sec('2026-10-20T08:00:00Z') } = {}) {
  const prior = candles(priorStart, 78);
  prior[0].high = 117;
  prior[77].low = 83;
  const overnight = candles(overnightStart, count);
  overnight[4].high = 106;
  overnight[20].low = 96;
  return { bars: [...prior, ...overnight], meta: { source: 'test delayed futures', symbol, contract, market,
    instrumentType: 'FUTURE', intervalSeconds: 300, quoteTime } };
}
function code(expected, fn) {
  assert.throws(fn, error => error instanceof AutoFillError && error.code === expected, `Expected ${expected}`);
}
function yahoo(feed = feedFor(), meta = {}) {
  return { chart: { error: null, result: [{ meta: { symbol: feed.meta.symbol, instrumentType: 'FUTURE', dataGranularity: '5m',
    shortName: feed.meta.market === 'NQ' ? 'Nasdaq 100 Dec 26' : 'Crude Oil Dec 26', regularMarketTime: feed.meta.quoteTime,
    exchangeTimezoneName: 'America/New_York', ...meta }, timestamp: feed.bars.map(b => b.time), indicators: { quote: [{
      open: feed.bars.map(b => b.open), high: feed.bars.map(b => b.high), low: feed.bars.map(b => b.low), close: feed.bars.map(b => b.close),
    }] } }] } };
}

test('uses the prior NY session and complete 19:30–03:00 range with exact boundary semantics', () => {
  const feed = feedFor();
  feed.bars.push({ time: sec('2026-10-19T20:00:00Z'), open: 100, high: 9999, low: -9999, close: 100 }); // 16:00 endpoint
  feed.bars.push({ time: sec('2026-10-20T07:00:00Z'), open: 100, high: 8888, low: -8888, close: 100 }); // 03:00 endpoint
  const result = calculateContext(feed, options);
  assert.equal(result.priorHigh, 117);
  assert.equal(result.priorLow, 83);
  assert.equal(result.open1930, 100);
  assert.equal(result.rangeHigh, 106);
  assert.equal(result.rangeLow, 96);
  assert.equal(result.up, 6);
  assert.equal(result.down, 4);
  assert.equal(result.priorBarCount, 78);
  assert.equal(result.overnightBarCount, 90);
  assert.equal(result.priorDate, '2026-10-19');
  assert.equal(result.cutoffTime, sec('2026-10-20T07:00:00Z'));
  assert.equal(result.contract, 'CLZ2026');
});

test('05:00 uses all 114 candles and includes expansion after 03:00', () => {
  const feed = feedFor({ count: 114, quoteTime: sec('2026-10-20T09:05:00Z') });
  feed.bars[78 + 105].high = 112;
  const result = calculateContext(feed, { ...options, cutoff: '05:00', nowMs: Date.parse('2026-10-20T09:05:00Z') });
  assert.equal(result.overnightBarCount, 114);
  assert.equal(result.up, 12);
});

test('the first input cannot be generated before 03:00 NY', () => {
  code('CUTOFF_NOT_REACHED', () => calculateContext(feedFor(), { ...options, nowMs: Date.parse('2026-10-20T06:59:59Z') }));
});

test('a delayed last quote before cutoff rejects even if a partial final candle exists', () => {
  code('INCOMPLETE_CUTOFF', () => calculateContext(feedFor({ quoteTime: sec('2026-10-20T06:59:59Z') }), options));
  const feed = feedFor();
  delete feed.meta.quoteTime;
  code('INVALID_METADATA', () => calculateContext(feed, options));
});

test('Monday after spring DST uses Friday EST prior NY and Sunday EDT overnight', () => {
  const feed = feedFor({ priorStart: sec('2024-03-08T14:30:00Z'), overnightStart: sec('2024-03-10T23:30:00Z'),
    quoteTime: sec('2024-03-11T07:05:00Z') });
  const result = calculateContext(feed, { date: '2024-03-11', cutoff: '03:00', market: 'CL', nowMs: Date.parse('2024-03-11T07:05:00Z') });
  assert.equal(result.priorDate, '2024-03-08');
  assert.equal(result.priorStart, sec('2024-03-08T14:30:00Z'));
  assert.equal(result.overnightStart, sec('2024-03-10T23:30:00Z'));
  assert.equal(result.cutoffTime, sec('2024-03-11T07:00:00Z'));
});

test('Monday after fall DST uses Friday EDT prior NY and Sunday EST overnight', () => {
  const feed = feedFor({ priorStart: sec('2024-11-01T13:30:00Z'), overnightStart: sec('2024-11-04T00:30:00Z'),
    quoteTime: sec('2024-11-04T08:05:00Z') });
  const result = calculateContext(feed, { date: '2024-11-04', cutoff: '03:00', market: 'CL', nowMs: Date.parse('2024-11-04T08:05:00Z') });
  assert.equal(result.priorDate, '2024-11-01');
  assert.equal(result.priorEnd, sec('2024-11-01T20:00:00Z'));
  assert.equal(result.overnightStart, sec('2024-11-04T00:30:00Z'));
  assert.equal(result.cutoffTime, sec('2024-11-04T08:00:00Z'));
});

test('an incomplete Monday is never replaced with an older complete Friday', () => {
  const feed = feedFor();
  feed.bars = feed.bars.filter(b => b.time !== sec('2026-10-19T15:00:00Z'));
  feed.bars.push(...candles(sec('2026-10-16T13:30:00Z'), 78));
  code('INCOMPLETE_PRIOR_NY', () => calculateContext(feed, options));
});

test('a holiday or early-close prior NY session fails safely', () => {
  const feed = feedFor();
  feed.bars = feed.bars.filter(b => !(b.time >= sec('2026-10-19T17:00:00Z') && b.time < sec('2026-10-19T20:00:00Z')));
  code('INCOMPLETE_PRIOR_NY', () => calculateContext(feed, options));
});

test('missing 19:30 open and missing final completed candle both prevent filling', () => {
  for (const missing of ['2026-10-19T23:30:00Z', '2026-10-20T06:55:00Z']) {
    const feed = feedFor();
    feed.bars = feed.bars.filter(b => b.time !== sec(missing));
    code('INCOMPLETE_OVERNIGHT', () => calculateContext(feed, options));
  }
});

test('duplicate timestamps are rejected, even for identical candles', () => {
  const feed = feedFor();
  feed.bars.push({ ...feed.bars[0] });
  code('DUPLICATE_BAR', () => calculateContext(feed, options));
});

test('null, nonfinite, string and impossible OHLC candles are rejected', () => {
  for (const value of [null, NaN, Infinity, '101', 50]) {
    const feed = feedFor();
    feed.bars[5].high = value;
    code('INVALID_DATA', () => calculateContext(feed, options));
  }
  const feed = feedFor();
  feed.bars[10] = null;
  code('INVALID_DATA', () => calculateContext(feed, options));
});

test('off-grid normalized bars are rejected', () => {
  const feed = feedFor();
  feed.bars[10].time++;
  code('INVALID_DATA', () => calculateContext(feed, options));
});

test('cash indices, CFDs and wrong futures roots cannot be substituted', () => {
  for (const instrumentType of ['INDEX', 'CFD', 'EQUITY']) {
    const feed = feedFor();
    feed.meta.instrumentType = instrumentType;
    code('WRONG_INSTRUMENT', () => calculateContext(feed, options));
  }
  const feed = feedFor();
  feed.meta.symbol = 'NQ=F';
  code('WRONG_MARKET', () => calculateContext(feed, options));
});

test('mixed contract bars and conflicting contract metadata are rejected', () => {
  const feed = feedFor();
  feed.bars[20].contract = 'CLX2026';
  code('CONTRACT_MISMATCH', () => calculateContext(feed, options));
  delete feed.bars[20].contract;
  feed.meta.contract = 'CLX2026';
  code('CONTRACT_MISMATCH', () => calculateContext(feed, options));
});

test('requested chart contract must match, accepting equivalent symbol formats', () => {
  assert.equal(calculateContext(feedFor(), { ...options, contract: 'NYMEX:CLZ2026' }).contract, 'CLZ2026');
  code('CONTRACT_MISMATCH', () => calculateContext(feedFor(), { ...options, contract: 'CLX2026' }));
});

test('NQ uses the same session rules without rescaling prices', () => {
  const feed = feedFor({ symbol: 'NQZ26.CME', contract: 'NQZ2026', market: 'NQ' });
  for (const bar of feed.bars) for (const key of ['open', 'high', 'low', 'close']) bar[key] *= 200;
  const result = calculateContext(feed, { ...options, market: 'NQ' });
  assert.equal(result.open1930, 20000);
  assert.equal(result.up, 1200);
  assert.equal(result.down, 800);
});

test('direct bar array API requires and uses matching metadata', () => {
  const feed = feedFor();
  assert.equal(calculateContext(feed.bars, { ...options, metadata: feed.meta }).up, 6);
  code('INVALID_METADATA', () => calculateContext(feed.bars, options));
});

test('Yahoo explicit dated futures are normalized with contract verification', () => {
  const feed = normalizeYahooChart(yahoo(), { market: 'CL' });
  assert.equal(feed.meta.contract, 'CLZ2026');
  assert.equal(feed.meta.continuous, false);
  assert.equal(feed.meta.intervalSeconds, 300);
  assert.equal(calculateContext(feed, options).priorLow, 83);
  const nq = normalizeYahooChart(yahoo(feedFor({ symbol: 'NQZ26.CME', contract: 'NQZ2026', market: 'NQ' })), { market: 'NQ' });
  assert.equal(nq.meta.contract, 'NQZ2026');
});

test('Yahoo front-month aliases expose current delivery month and continuous-series status', () => {
  const feed = normalizeYahooChart(yahoo(feedFor(), { symbol: 'CL=F' }), { market: 'CL' });
  assert.equal(feed.meta.contract, 'CLZ2026');
  assert.equal(feed.meta.continuous, true);
  assert.equal(feed.meta.contractBasis, 'provider-short-name');
});

test('Yahoo null off-session rows can be omitted, but null required rows fail coverage', () => {
  const payload = yahoo();
  const result = payload.chart.result[0];
  result.timestamp.push(sec('2026-10-19T22:00:00Z'));
  for (const key of ['open', 'high', 'low', 'close']) result.indicators.quote[0][key].push(null);
  const feed = normalizeYahooChart(payload);
  assert.equal(feed.meta.omitted.nullTimes.length, 1);
  assert.equal(calculateContext(feed, options).up, 6);
  const missing = yahoo();
  missing.chart.result[0].indicators.quote[0].close[78] = null;
  code('INCOMPLETE_OVERNIGHT', () => calculateContext(normalizeYahooChart(missing), options));
});

test('Yahoo trailing current quote is omitted; an off-grid historical bar is rejected', () => {
  const payload = yahoo();
  const result = payload.chart.result[0];
  const time = sec('2026-10-20T07:58:12Z');
  result.timestamp.push(time);
  for (const key of ['open', 'high', 'low', 'close']) result.indicators.quote[0][key].push(999999);
  const feed = normalizeYahooChart(payload);
  assert.deepEqual(feed.meta.omitted.irregularQuoteTimes, [time]);
  assert.equal(calculateContext(feed, options).up, 6);
  payload.chart.result[0].timestamp[5]++;
  code('INVALID_DATA', () => normalizeYahooChart(payload));
});

test('Yahoo arrays must be coherent and timestamp duplicates are rejected', () => {
  const payload = yahoo();
  payload.chart.result[0].indicators.quote[0].open.pop();
  code('INVALID_DATA', () => normalizeYahooChart(payload));
  const duplicate = yahoo();
  duplicate.chart.result[0].timestamp[1] = duplicate.chart.result[0].timestamp[0];
  code('DUPLICATE_BAR', () => normalizeYahooChart(duplicate));
});

test('Yahoo source errors, wrong interval, wrong instrument and contract disagreement fail', () => {
  for (const payload of [null, {}, { chart: { error: { description: 'rate limited' }, result: null } }])
    code('SOURCE_ERROR', () => normalizeYahooChart(payload));
  code('WRONG_INTERVAL', () => normalizeYahooChart(yahoo(feedFor(), { dataGranularity: '15m' })));
  code('WRONG_INSTRUMENT', () => normalizeYahooChart(yahoo(feedFor(), { instrumentType: 'CFD' })));
  code('CONTRACT_MISMATCH', () => normalizeYahooChart(yahoo(feedFor(), { shortName: 'Crude Oil Nov 26' })));
  code('WRONG_MARKET', () => normalizeYahooChart(yahoo(), { market: 'NQ' }));
});

test('invalid dates, weekends and unapproved windows fail', () => {
  code('INVALID_DATE', () => calculateContext(feedFor(), { ...options, date: '2026-02-30' }));
  code('INVALID_DATE', () => calculateContext(feedFor(), { ...options, date: '2026-10-18' }));
  code('INVALID_CUTOFF', () => calculateContext(feedFor(), { ...options, cutoff: '04:00' }));
  code('UNSUPPORTED_MARKET', () => calculateContext(feedFor(), { ...options, market: 'ES' }));
  code('INVALID_TIME', () => calculateContext(feedFor(), { ...options, nowMs: NaN }));
});

test('New York timezone conversion matches independent known UTC dates', () => {
  assert.equal(nyTimeToEpoch('2024-03-08', '09:30'), sec('2024-03-08T14:30:00Z'));
  assert.equal(nyTimeToEpoch('2024-03-11', '09:30'), sec('2024-03-11T13:30:00Z'));
  assert.equal(nyTimeToEpoch('2024-11-04', '19:30'), sec('2024-11-05T00:30:00Z'));
  code('INVALID_TIME', () => nyTimeToEpoch('2024-03-10', '02:30'));
});
