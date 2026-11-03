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

export const MARKET_CONFIG = Object.freeze({
  CL:Object.freeze({tick:.01,prefix:'NYMEX',suffix:'NYM'}),
  NQ:Object.freeze({tick:.25,prefix:'CME_MINI',suffix:'CME'}),
  ES:Object.freeze({tick:.25,prefix:'CME_MINI',suffix:'CME'}),
  GC:Object.freeze({tick:.1,prefix:'COMEX',suffix:'CMX'}),
});

export function rootOfSymbol(symbol) {
  if (typeof symbol !== 'string') return null;
  const s = symbol.toUpperCase();
  if (/^(CL|NQ|ES|GC)=F$/.test(s)) return s.slice(0, 2);
  const found = /^(?:(NYMEX|CME_MINI|CME|COMEX):)?(CL|NQ|ES|GC)([FGHJKMNQUVXZ])(\d{2}|\d{4})(?:\.(NYM|CME|CMX))?$/.exec(s);
  if (!found) return null;
  const market=found[2],config=MARKET_CONFIG[market];
  const prefixes=market==='GC'?['COMEX']:market==='CL'?['NYMEX']:['CME','CME_MINI'];
  if (found[1] && !prefixes.includes(found[1])) return null;
  if (found[5] && found[5]!==config.suffix) return null;
  return found[2];
}
export function canonicalContract(value) {
  if (typeof value !== 'string') return null;
  const s = value.toUpperCase();
  if (!rootOfSymbol(s)) return null;
  const found = /^(?:(?:NYMEX|CME_MINI|CME|COMEX):)?(CL|NQ|ES|GC)([FGHJKMNQUVXZ])(\d{2}|\d{4})(?:\.(?:NYM|CME|CMX))?$/.exec(s);
  return found ? `${found[1]}${found[2]}${found[3].length === 2 ? '20' : ''}${found[3]}` : null;
}
export function yahooContractSymbol(value) {
  const contract=canonicalContract(value),market=rootOfSymbol(contract);
  if(!contract||!market)fail('CONTRACT_MISMATCH','An explicit supported futures delivery contract is required.');
  return contract.slice(0,3)+contract.slice(-2)+'.'+MARKET_CONFIG[market].suffix;
}

export function contractFromName(name, root) {
  if (typeof name !== 'string') return null;
  const month = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\s-]+(\d{4}|\d{2})\b/i.exec(name);
  const identifiesRoot = root === 'CL' ? /crude\s+oil/i.test(name) : root === 'NQ' ? /nasdaq\s*100/i.test(name) : root==='GC' ? /\bgold\b/i.test(name)&&!/\b(?:micro|mini)\b/i.test(name) : /(?:s\s*&\s*p|s\s+and\s+p)\s*500/i.test(name);
  if (!month || !identifiesRoot) return null;
  const monthName = month[1][0].toUpperCase() + month[1].slice(1).toLowerCase();
  return `${root}${MONTH_CODES[monthName]}${month[2].length === 2 ? '20' : ''}${month[2]}`;
}

/** Gold must carry the reviewed research conventions. Never inherit the
 * equity-market 09:30 baseline merely because its source is copied from ES. */
export function resolveContextConvention(market, convention) {
  if(market!=='GC')return {id:'sessionpath-shared-ny-v1',status:'FROZEN_EXISTING',timeZone:ZONE,bboxSession:{startMinute:570,endMinute:960},avrSession:{startMinute:570,endMinute:960}};
  if(!convention||!String(convention.status||'').startsWith('FROZEN')||!String(convention.id||'').trim()||convention.timeZone!==ZONE||!/(?:Z|[+-]\d{2}:\d{2})$/.test(convention.frozenUTC||'')||!Number.isFinite(Date.parse(convention.frozenUTC||'')))
    fail('GC_CONVENTIONS_PENDING','Gold Auto-fill is not enabled until its AVR and prior-session reference windows are reviewed and frozen.');
  for(const key of ['bboxSession','avrSession']){
    const w=convention[key];
    if(!w||!Number.isInteger(w.startMinute)||!Number.isInteger(w.endMinute)||w.startMinute<0||w.startMinute>=w.endMinute||w.endMinute>1440||w.startMinute%5||w.endMinute%5)
      fail('GC_CONVENTIONS_PENDING','Gold reference windows must be explicit aligned New York times.');
  }
  return {id:convention.id,status:convention.status,timeZone:ZONE,frozenUTC:convention.frozenUTC,bboxSession:{...convention.bboxSession},avrSession:{...convention.avrSession},
    ...(convention.researchConfigSHA256?{researchConfigSHA256:convention.researchConfigSHA256}:{}),
    ...(convention.referenceChoice?{referenceChoice:convention.referenceChoice}:{})};
}

const minuteTime = minute => `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
export function normalizeGoldPrice(value) {
  if(!finite(value)||value<=0||Math.abs(value/.1-Math.round(value/.1))>.010001)
    fail('INVALID_GC_TICK','Gold candles must use the GC $0.10 price increment.');
  // Yahoo can store prices as float32, so a sub-$0.001 representation residue
  // is tolerated and snapped; half-ticks and quarter-point prices are rejected.
  return Number((Math.round(value/.1)*.1).toFixed(1));
}

function validateMeta(meta, market, requestedContract) {
  if (!meta || typeof meta !== 'object') fail('INVALID_METADATA', 'The source did not identify the futures contract.');
  if (meta.instrumentType !== 'FUTURE') fail('WRONG_INSTRUMENT', 'Auto-fill requires futures data, not a cash index or CFD.');
  if (![300, 900].includes(meta.intervalSeconds)) fail('WRONG_INTERVAL', 'The source must provide five- or fifteen-minute candles.');
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
    if (!bar || typeof bar !== 'object' || !Number.isSafeInteger(bar.time) || bar.time % meta.intervalSeconds !== 0)
      fail('INVALID_DATA', 'The source returned a malformed candle timestamp.');
    if (seen.has(bar.time)) fail('DUPLICATE_BAR', 'The source returned duplicate candle timestamps.');
    if (!['open', 'high', 'low', 'close'].every(key => finite(bar[key])) ||
        bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.high < bar.low)
      fail('INVALID_DATA', 'The source returned a malformed OHLC candle.', { time: bar.time });
    if(meta.market==='GC')for(const key of ['open','high','low','close'])normalizeGoldPrice(bar[key]);
    if (bar.contract !== undefined && canonicalContract(bar.contract) !== contract)
      fail('CONTRACT_MISMATCH', 'The candles contain more than one futures contract.');
    if (bar.symbol !== undefined && bar.symbol !== meta.symbol && canonicalContract(bar.symbol) !== contract)
      fail('CONTRACT_MISMATCH', 'The candles contain conflicting futures symbols.');
    seen.set(bar.time, bar);
  }
  return seen;
}

function completeWindow(byTime, start, end, code, message, step = STEP) {
  const result = [];
  const missing = [];
  for (let time = start; time < end; time += step) {
    const bar = byTime.get(time);
    if (!bar) missing.push(time);
    else result.push(bar);
  }
  if (missing.length) fail(code, message, { missingCount: missing.length, firstMissing: missing[0], intervalSeconds: step });
  return result;
}

/**
 * Accepts {bars,meta}, or an array of normalized bars with options.metadata.
 * Strict by default. The on-demand handler may explicitly accept one interior
 * overnight gap after exact recovery fails; those extrema are labelled observed,
 * not complete. Prior NY and opening anchors remain mandatory. No older-date fallback.
 */
export function calculateContext(feed, options = {}) {
  const { date, cutoff, market, contract: requestedContract, nowMs = Date.now() } = options;
  if (!Object.hasOwn(MARKET_CONFIG,market)) fail('UNSUPPORTED_MARKET', 'Select CL, NQ, ES or GC futures.');
  const convention=resolveContextConvention(market,options.convention);
  dateParts(date);
  if ([0, 6].includes(weekday(date))) fail('INVALID_DATE', 'Select a weekday futures trading date.');
  if (!['03:00', '05:00', '08:30'].includes(cutoff)) fail('INVALID_CUTOFF', 'Auto-fill supports the 03:00, 05:00 and 08:30 inputs.');
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
  const priorStart = nyTimeToEpoch(priorDate, minuteTime(convention.bboxSession.startMinute));
  const priorEnd = nyTimeToEpoch(priorDate, minuteTime(convention.bboxSession.endMinute));
  const prior = completeWindow(byTime, priorStart, priorEnd, 'INCOMPLETE_PRIOR_NY',
    `The source does not contain the complete prior NY session (${priorDate}, ${minuteTime(convention.bboxSession.startMinute)}–${minuteTime(convention.bboxSession.endMinute)}).`, meta.intervalSeconds);
  const overnightDate = shiftDate(date, -1);
  const overnightStart = nyTimeToEpoch(overnightDate, '19:30');
  let overnight, coverage;
  try {
    overnight = completeWindow(byTime, overnightStart, cutoffTime, 'INCOMPLETE_OVERNIGHT',
      `The source does not yet contain the complete 19:30–${cutoff} window. Try again after the delayed data arrives.`, meta.intervalSeconds);
  } catch(error) {
    const gap=error.details?.firstMissing;
    if(!(error instanceof AutoFillError)||error.code!=='INCOMPLETE_OVERNIGHT'||options.allowOneMissingOvernightBar!==true||
       error.details.missingCount!==1||gap<=overnightStart||gap+meta.intervalSeconds>=cutoffTime)throw error;
    overnight=[];
    for(let time=overnightStart;time<cutoffTime;time+=meta.intervalSeconds){const bar=byTime.get(time);if(bar)overnight.push(bar);}
    coverage={policy:'one-interior-overnight-candle-v1',complete:false,missingCount:1,intervalSeconds:meta.intervalSeconds,
      missingTime:gap,window:'overnight',observedBars:overnight.length,expectedBars:(cutoffTime-overnightStart)/meta.intervalSeconds,
      approximateFields:['rangeHigh','rangeLow','up','down'],
      warning:`One ${meta.intervalSeconds/60}-minute overnight candle is missing. High/low and U/D use observed prices; an unseen extreme is possible.`};
  }
  const priorHigh = Math.max(...prior.map(bar => bar.high));
  const priorLow = Math.min(...prior.map(bar => bar.low));
  const completedHigh = Math.max(...overnight.map(bar => bar.high));
  const completedLow = Math.min(...overnight.map(bar => bar.low));
  const open1930 = overnight[0].open;
  // Only this candle's open is known at the decision time. Its later H/L/C
  // must never enter the cumulative overnight window, including on a 15m feed.
  const requiresOpen = market==='GC'||cutoff==='08:30';
  const decisionOpen = requiresOpen ? byTime.get(cutoffTime)?.open : undefined;
  if(requiresOpen && !finite(decisionOpen))
    fail('INCOMPLETE_CUTOFF', `The delayed source has not supplied the ${cutoff} opening price yet. Try again when it arrives.`);
  // Gold feature protocol includes the known decision OPEN in the final running
  // anchors. A gap can establish a new extreme. The same bar's later H/L/C must
  // remain excluded. Existing CL/NQ/ES context behavior is preserved.
  const rangeHigh=market==='GC'?Math.max(completedHigh,decisionOpen):completedHigh;
  const rangeLow=market==='GC'?Math.min(completedLow,decisionOpen):completedLow;
  return {
    priorLow, priorHigh, open1930, rangeHigh, rangeLow,
    ...(requiresOpen ? {decisionOpen} : {}),
    up: Math.max(0, rangeHigh - open1930), down: Math.max(0, open1930 - rangeLow),
    date, cutoff, timeZone: ZONE, market, contract,
    priorDate, priorStart, priorEnd, overnightDate, overnightStart, cutoffTime,
    priorBarCount: prior.length, overnightBarCount: overnight.length, intervalSeconds: meta.intervalSeconds,
    source: meta.source, symbol: meta.symbol,
    quoteTime: meta.quoteTime ?? null, sourceDate: meta.sourceDate ?? null,
    continuous: meta.continuous === true,
    contractBasis: meta.contractBasis ?? 'explicit-symbol',
    ...(coverage?{coverage}:{}),
    ...(market==='GC'?{convention,snapshotRule:'completed-context-plus-cutoff-open-v1'}:{}),
  };
}

/**
 * Completed Asia/London prices for NY's Own/Prior position helper. Native 15m
 * prices can provide these aligned OHLC ranges exactly, independently of the
 * five-minute close-count archive and the forecast-utilization direction model.
 * Always require full context: the one-gap approximation is not a position.
 */
export function calculateNYPositions(feed, options = {}) {
  if (options.cutoff !== undefined && options.cutoff !== '08:30')
    fail('INVALID_CUTOFF', 'NY position Auto-fill requires the completed 08:30 New York cutoff.');
  const context = calculateContext(feed, {...options, cutoff:'08:30', allowOneMissingOvernightBar:false});
  const meta = Array.isArray(feed) ? options.metadata : feed?.meta;
  const bars = Array.isArray(feed) ? feed : feed?.bars;
  const tick=MARKET_CONFIG[context.market].tick;
  function canonicalPrice(value) {
    const units=value/tick;
    if (!finite(value) || Math.abs(units-Math.round(units))>.010001)
      fail('INVALID_TICK', `NY position prices must use the ${context.market} ${tick}-point price increment.`);
    return Number((Math.round(units)*tick).toFixed(2));
  }
  // Providers may encode prices as float32. Snap only representation residue,
  // never an actual fractional tick, before quarter-position comparisons.
  const canonicalBars=bars.map(bar=>({...bar,...Object.fromEntries(
    ['open','high','low','close'].map(key=>[key,canonicalPrice(bar[key])]))}));
  const byTime = validateBars(canonicalBars, meta, context.contract);
  function observed(startDate, start, end) {
    const from = nyTimeToEpoch(startDate, start), to = nyTimeToEpoch(context.date, end);
    const rows = completeWindow(byTime, from, to, 'INCOMPLETE_POSITION_WINDOW',
      `NY position Auto-fill needs every completed ${meta.intervalSeconds/60}-minute candle from ${start} to ${end}.`, meta.intervalSeconds);
    return {start, end, open:rows[0].open, high:Math.max(...rows.map(b=>b.high)),
      low:Math.min(...rows.map(b=>b.low)), close:rows.at(-1).close,
      count:rows.length, intervalSeconds:meta.intervalSeconds};
  }
  return {schema:'sessionpath.ny-positions.v1', status:'ready', date:context.date,
    market:context.market, contract:context.contract, timeZone:ZONE,
    completedThrough:context.cutoffTime, intervalSeconds:meta.intervalSeconds,
    priorHigh:canonicalPrice(context.priorHigh), priorLow:canonicalPrice(context.priorLow),
    asia:observed(shiftDate(context.date,-1),'19:30','02:00'),
    london:observed(context.date,'03:00','08:30'),
    ...(context.market==='GC'?{convention:context.convention}:{})};
}

/**
 * Completed early-window observations for NY direction inputs. This deliberately
 * supplies observed prices, not a forecast denominator: the browser must use
 * its own earlier-date-only forecast engine and the day's frozen AVR.
 * A native 15m fallback is sufficient for context H/L, but cannot provide the
 * archived 5m close counts; it must never be split into invented closes.
 */
export function calculateNYDirection(feed, options = {}) {
  const {date, market, contract: requestedContract, contextFeed = feed} = options;
  // Aligned native15m bars may provide exact earlier range H/L when an
  // unrelated overnight5m bar is missing. Never use them for5m close counts.
  const context = calculateContext(contextFeed, {...options, cutoff: '08:30'});
  const meta = Array.isArray(feed) ? options.metadata : feed?.meta;
  const bars = Array.isArray(feed) ? feed : feed?.bars;
  if (meta.intervalSeconds !== STEP)
    fail('FIVE_MINUTE_REQUIRED', 'Direction Auto-fill needs complete five-minute candles; the available context used fifteen-minute candles.');
  if (!Number.isSafeInteger(meta.quoteTime) || meta.quoteTime < nyTimeToEpoch(date,'08:30'))
    fail('INCOMPLETE_CUTOFF', 'The five-minute source has not completed the 08:30 cutoff yet.');
  const contract = validateMeta(meta, market, requestedContract);
  if (context.contract !== contract)
    fail('CONTRACT_MISMATCH', 'The context and five-minute observations identify different futures contracts.');
  const byTime = validateBars(bars, meta, contract);
  const contextMeta = Array.isArray(contextFeed) ? options.metadata : contextFeed?.meta;
  const contextBars = Array.isArray(contextFeed) ? contextFeed : contextFeed?.bars;
  const contextByTime = contextFeed === feed ? byTime : validateBars(contextBars, contextMeta, contract);
  function observed(startDate, start, end, source = byTime, step = STEP) {
    const from = nyTimeToEpoch(startDate, start), to = nyTimeToEpoch(date, end);
    const rows = completeWindow(source, from, to, 'INCOMPLETE_DIRECTION_WINDOW',
      `Direction Auto-fill needs every completed ${step/60}-minute candle from ${start} to ${end}.`,step);
    return {rows, value: {start, end, open: rows[0].open,
      high: Math.max(...rows.map(b => b.high)), low: Math.min(...rows.map(b => b.low)),
      close: rows.at(-1).close, count: rows.length, intervalSeconds:step}};
  }
  const windows = {};
  for (const [key, start, end] of [['three','03:00','05:00'], ['five','05:00','08:30']]) {
    const observedWindow = observed(date, start, end), rows = observedWindow.rows;
    const decisionTime = nyTimeToEpoch(date, start), open = rows[0].open;
    const earlier = calculateContext(contextFeed, {...options, cutoff: start});
    const contextOpen = contextByTime.get(decisionTime)?.open;
    if (!finite(contextOpen) || Math.abs(contextOpen-open)>1e-6)
      fail('CONTEXT_PRICE_MISMATCH', `The context and five-minute ${start} opening prices do not match.`);
    const previousHour = completeWindow(byTime, decisionTime - 3600, decisionTime,
      'INCOMPLETE_DIRECTION_WINDOW', `The completed hour before ${start} is incomplete.`);
    const base = byTime.get(decisionTime - 3900)?.close;
    if (!finite(base)) fail('INCOMPLETE_DIRECTION_WINDOW', `The close preceding the last hour before ${start} is missing.`);
    const closes = rows.map(b => b.close);
    // Use the same tick-equivalence tolerance as the research's comparisons.
    const up = closes.filter(close => close > open + 1e-9).length;
    const down = closes.filter(close => close < open - 1e-9).length;
    windows[key] = {status:'complete', ...observedWindow.value,
      actualUp: Math.max(0, observedWindow.value.high - open),
      actualDown: Math.max(0, open - observedWindow.value.low), closes,
      closeCounts:{up, down, equal:closes.length-up-down, total:closes.length},
      snapshot:{runningHigh:Math.max(earlier.rangeHigh, open), runningLow:Math.min(earlier.rangeLow, open),
        open1930:earlier.open1930, priorHigh:earlier.priorHigh, priorLow:earlier.priorLow,
        decisionOpen:open, previousHourBaseClose:base, previousHourCloses:previousHour.map(b => b.close)}};
  }
  return {schema:'sessionpath.ny-direction.v1', status:'ready', date, market, contract,
    timeZone:ZONE, intervalSeconds:STEP, sourceSymbol:context.symbol,
    completedThrough:nyTimeToEpoch(date,'08:30'), quoteTime:context.quoteTime,
    contextIntervalSeconds:contextMeta.intervalSeconds,
    asia:observed(shiftDate(date,-1),'19:30','02:00',contextByTime,contextMeta.intervalSeconds).value,
    london:observed(date,'03:00','08:30').value, windows,
    ...(market==='GC'?{convention:context.convention}:{})};
}

/** Normalize Yahoo's chart JSON without requesting a network resource. */
/** The same last-hour classifier used by the site's window-engine.mjs.
 * Path values are completed-close changes divided by the day's frozen AVR. */
export function classifyLastHourPath(path) {
  if (!Array.isArray(path) || !path.length || !path.every(finite))
    fail('INVALID_BEHAVIOR_PATH', 'A finite completed close path is required.');
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

function observableFeed(feed, options) {
  const {date, cutoff, market, contract:requestedContract, nowMs=Date.now()}=options;
  if(!Object.hasOwn(MARKET_CONFIG,market))fail('UNSUPPORTED_MARKET','Select a supported futures market.');
  dateParts(date);
  if([0,6].includes(weekday(date)))fail('INVALID_DATE','Select a weekday futures trading date.');
  if(!['03:00','05:00','08:30'].includes(cutoff))fail('INVALID_CUTOFF','Select a supported decision time.');
  const cutoffTime=nyTimeToEpoch(date,cutoff);
  if(!finite(nowMs))fail('INVALID_TIME','The current time is invalid.');
  if(nowMs<cutoffTime*1000)fail('CUTOFF_NOT_REACHED','The selected decision time has not arrived.');
  const meta=Array.isArray(feed)?options.metadata:feed?.meta;
  const bars=Array.isArray(feed)?feed:feed?.bars;
  const contract=validateMeta(meta,market,requestedContract);
  if(!Number.isSafeInteger(meta.quoteTime)||meta.quoteTime<cutoffTime)
    fail('INCOMPLETE_CUTOFF','The delayed source has not reached the decision time.');
  if(meta.continuous===true)fail('CONTRACT_MISMATCH','Observable inputs require one explicit futures contract.');
  const byTime=validateBars(bars,meta,contract);
  return {date,cutoff,market,contract,cutoffTime,meta,bars,byTime};
}

function observablePrice(value,market) {
  const tick=MARKET_CONFIG[market].tick,units=value/tick;
  if(!finite(value)||Math.abs(units-Math.round(units))>.010001)
    fail('INVALID_TICK',`Observable prices must use the ${market} ${tick}-point increment.`);
  return Number((Math.round(units)*tick).toFixed(2));
}

export function calculateDecisionOpen(feed,options={}) {
  const f=observableFeed(feed,options),bar=f.byTime.get(f.cutoffTime);
  if(!bar)fail('INCOMPLETE_CUTOFF',`The source has not supplied the ${f.cutoff} opening price.`);
  return {schema:'sessionpath.decision-open.v1',status:'ready',date:f.date,cutoff:f.cutoff,
    market:f.market,contract:f.contract,timeZone:ZONE,time:f.cutoffTime,
    open:observablePrice(bar.open,f.market)};
}

/** Fixed at the prior calendar day's 19:30, using only this dated contract.
 * Incomplete/early-close sessions are excluded, not averaged as partial ranges.
 * Exactly ten complete sessions are required. The mean is never tick-rounded. */
export function calculateFrozenAVR(feed,options={}) {
  const f=observableFeed(feed,options),convention=resolveContextConvention(f.market,options.convention);
  const freezeDate=shiftDate(f.date,-1),freezeTime=nyTimeToEpoch(freezeDate,'19:30');
  const start=minuteTime(convention.avrSession.startMinute),end=minuteTime(convention.avrSession.endMinute);
  const sessions=[],skipped=[];
  for(let back=0;back<35&&sessions.length<10;back++) {
    const date=shiftDate(freezeDate,-back);
    if([0,6].includes(weekday(date)))continue;
    const from=nyTimeToEpoch(date,start),to=nyTimeToEpoch(date,end);
    if(to>freezeTime)continue;
    let rows;
    try {
      rows=completeWindow(f.byTime,from,to,'INCOMPLETE_AVR_SESSION','The reference session is incomplete.',f.meta.intervalSeconds);
    }catch(error){
      if(!(error instanceof AutoFillError)||error.code!=='INCOMPLETE_AVR_SESSION')throw error;
      skipped.push({date,missingCount:error.details.missingCount,firstMissing:error.details.firstMissing});
      continue;
    }
    const high=Math.max(...rows.map(b=>observablePrice(b.high,f.market)));
    const low=Math.min(...rows.map(b=>observablePrice(b.low,f.market)));
    sessions.push({date,high,low,range:Number((high-low).toFixed(8)),count:rows.length});
  }
  if(sessions.length!==10)fail('INSUFFICIENT_AVR_HISTORY',
    `Frozen AVR needs ten complete prior NY sessions on ${f.contract}; the source supplied ${sessions.length}.`,
    {n:sessions.length,dates:sessions.map(s=>s.date),freezeDate,freezeTime,lookbackDays:35,skipped});
  const ranges=sessions.map(s=>s.range),value=ranges.reduce((sum,x)=>sum+x,0)/10;
  if(!finite(value)||value<=0)fail('INVALID_AVR','The complete-session average range is not positive.');
  return {schema:'sessionpath.frozen-avr.v1',status:'ready',date:f.date,cutoff:f.cutoff,
    market:f.market,contract:f.contract,timeZone:ZONE,convention:convention.id,
    freezeDate,freezeTime,session:{start,end},intervalSeconds:f.meta.intervalSeconds,
    n:10,dates:sessions.map(s=>s.date),ranges,value,sessions,skipped,lookbackDays:35};
}

export function calculateLastHourBehavior(feed,options={}) {
  const f=observableFeed(feed,options),avr=options.avr;
  if(!(finite(avr)&&avr>0))fail('AVR_UNAVAILABLE','Last-hour behavior requires the positive frozen AVR.');
  if(f.meta.intervalSeconds!==STEP)fail('FIVE_MINUTE_REQUIRED','Last-hour behavior requires genuine five-minute closes.');
  const rows=completeWindow(f.byTime,f.cutoffTime-3600,f.cutoffTime,
    'INCOMPLETE_LAST_HOUR','The completed last hour is missing five-minute candles.');
  const preceding=f.byTime.get(f.cutoffTime-3900);
  if(!preceding)fail('INCOMPLETE_LAST_HOUR','The close preceding the completed hour is missing.');
  const baseClose=observablePrice(preceding.close,f.market),closes=rows.map(b=>observablePrice(b.close,f.market));
  const path=closes.map(close=>(close-baseClose)/avr),behavior=classifyLastHourPath(path);
  return {schema:'sessionpath.last-hour.v1',status:'ready',date:f.date,cutoff:f.cutoff,
    market:f.market,contract:f.contract,timeZone:ZONE,intervalSeconds:STEP,
    start:f.cutoffTime-3600,end:f.cutoffTime,baseClose,closes,path,avr,behavior};
}

/** Additive fields stay independent: unavailable history/close paths must never
 * turn an otherwise usable legacy context response into an error. */
export function calculateObservableInputs(feed,options={}) {
  const values={},common={date:options.date,cutoff:options.cutoff,market:options.market,
    contract:options.contract??(Array.isArray(feed)?options.metadata:feed?.meta)?.contract,timeZone:ZONE};
  function attempt(schema,compute) {
    try{return compute();}
    catch(error){return {schema,status:'unavailable',...common,
      code:error instanceof AutoFillError?error.code:'OBSERVABLE_INPUT_UNAVAILABLE',
      error:error instanceof AutoFillError?error.message:'This observable input could not be calculated.',
      ...(error instanceof AutoFillError&&Object.keys(error.details??{}).length?{details:error.details}:{})};}
  }
  const decisionOpen=attempt('sessionpath.decision-open.v1',()=>calculateDecisionOpen(options.contextFeed??feed,options));
  if(decisionOpen.status==='ready')values.decisionOpen=decisionOpen.open;
  const avr=attempt('sessionpath.frozen-avr.v1',()=>calculateFrozenAVR(options.historyFeed??feed,options));
  if(avr.status==='ready')values.avr=avr.value;
  const lastHour=attempt('sessionpath.last-hour.v1',()=>calculateLastHourBehavior(feed,{...options,avr:avr.value}));
  if(lastHour.status==='ready')values.behavior=lastHour.behavior;
  const observableRange=attempt('sessionpath.observable-range.v1',()=>{
    if(decisionOpen.status!=='ready')fail('INCOMPLETE_CUTOFF','The known decision opening price is unavailable.');
    const context=options.context??calculateContext(options.contextFeed??feed,options);
    if(context.date!==common.date||context.cutoff!==common.cutoff||context.market!==common.market||context.contract!==common.contract)
      fail('CONTEXT_PRICE_MISMATCH','The observed range and decision price identify different inputs.');
    // Yahoo OHLC prices can contain float32 representation residue. Match the
    // canonical tick prices in the legacy response before comparing receipts.
    // An actual fractional tick remains invalid under observablePrice's check.
    const completedHigh=observablePrice(context.rangeHigh,common.market);
    const completedLow=observablePrice(context.rangeLow,common.market);
    const open1930=observablePrice(context.open1930,common.market);
    const rangeHigh=Math.max(completedHigh,decisionOpen.open),rangeLow=Math.min(completedLow,decisionOpen.open);
    return {schema:'sessionpath.observable-range.v1',status:'ready',...common,includesCutoffOpen:true,
      rangeHigh,rangeLow,open1930,decisionOpen:decisionOpen.open,
      up:Number(Math.max(0,rangeHigh-open1930).toFixed(2)),down:Number(Math.max(0,open1930-rangeLow).toFixed(2)),
      ...(context.coverage?{coverage:context.coverage}:{})};
  });
  return {values,decisionOpen,avr,lastHour,observableRange};
}

export function normalizeYahooChart(payload, { market, intervalSeconds = 300 } = {}) {
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
  if (![300,900].includes(intervalSeconds) || rawMeta.dataGranularity !== `${intervalSeconds / 60}m`) fail('WRONG_INTERVAL', 'The delayed-data chart must use the requested candle interval.');
  const explicitContract = canonicalContract(rawMeta.symbol);
  if(root==='GC'&&/\b(?:micro|mini)\b/i.test(rawMeta.shortName??rawMeta.longName??''))
    fail('CONTRACT_MISMATCH','Micro Gold prices cannot be labelled as the GC reference contract.');
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
    if (time % intervalSeconds !== 0) {
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
    if(root==='GC')for(const key of ['open','high','low','close'])bar[key]=normalizeGoldPrice(bar[key]);
    bars.push(bar);
  }
  const meta = {
    source: 'Yahoo Finance delayed futures chart', symbol: rawMeta.symbol, market: root,
    contract, instrumentType: rawMeta.instrumentType, intervalSeconds,
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
