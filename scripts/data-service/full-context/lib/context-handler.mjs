import { AutoFillError, normalizeYahooChart, calculateContext, calculateNYPositions, calculateNYDirection, calculateObservableInputs, nyTimeToEpoch, MARKET_CONFIG, yahooContractSymbol, resolveContextConvention } from './context-calculations.mjs';
import { fillMissingFiveMinuteBars, fillMissingFifteenMinuteBars } from './minute-bars.mjs';

const SOURCE = 'Yahoo Finance';
const SCHEMA = 'sessionpath.autofill.v2';
const MARKETS = new Set(Object.keys(MARKET_CONFIG));
const CUTOFFS = new Set(['03:00', '05:00', '08:30']);
const DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});
const DEFAULT_ORIGINS = ['https://wanhotrading.github.io', 'https://session-path-research.jjj-jason2345.chatgpt.site'];
const MISSING_TIME_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const MISSING_WINDOW_CODES = new Set(['INCOMPLETE_PRIOR_NY', 'INCOMPLETE_OVERNIGHT']);

function missingDetails(error) {
  if (!(error instanceof AutoFillError) || !MISSING_WINDOW_CODES.has(error.code) ||
      !Number.isSafeInteger(error.details?.missingCount) || !Number.isSafeInteger(error.details?.firstMissing)) return null;
  return { missingCount: error.details.missingCount, firstMissing: error.details.firstMissing,
    intervalSeconds: error.details.intervalSeconds ?? 300, firstMissingNY: MISSING_TIME_FORMAT.format(new Date(error.details.firstMissing * 1000)) };
}

function nyDate(nowMs) {
  const parts = Object.fromEntries(DATE_FORMAT.formatToParts(new Date(nowMs)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function problem(code, message, status = 502, details = {}) {
  const error = new AutoFillError(code, message, details);
  error.httpStatus = status;
  return error;
}

function errorStatus(error) {
  if (error.httpStatus) return error.httpStatus;
  if (['INVALID_DATE', 'INVALID_TIME', 'INVALID_CUTOFF', 'UNSUPPORTED_MARKET'].includes(error.code)) return 400;
  if (error.code === 'CUTOFF_NOT_REACHED') return 409;
  if (error.code === 'GC_CONVENTIONS_PENDING') return 409;
  if (['INCOMPLETE_CUTOFF', 'INCOMPLETE_PRIOR_NY', 'INCOMPLETE_OVERNIGHT'].includes(error.code)) return 422;
  return 502;
}

function roundedValues(data, market) {
  const tick = MARKET_CONFIG[market].tick;
  const values = Object.fromEntries(['priorLow', 'priorHigh', 'open1930', 'rangeHigh', 'rangeLow'].map(key =>
    [key, Number((Math.round(data[key] / tick) * tick).toFixed(2))]));
  values.up = Number((values.rangeHigh - values.open1930).toFixed(2));
  values.down = Number((values.open1930 - values.rangeLow).toFixed(2));
  if(Number.isFinite(data.decisionOpen))values.decisionOpen=Number((Math.round(data.decisionOpen/tick)*tick).toFixed(2));
  return values;
}

/**
 * Portable Fetch API handler: Node 20+, Cloudflare Workers, or another HTTPS runtime.
 * Every GET performs new alias and dated-contract requests. No snapshots, cache,
 * arbitrary upstream URL, credentials, or previous-date fallback are accepted.
 */
export function createContextHandler({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = 10000,
  allowedOrigins = DEFAULT_ORIGINS,
  requestId = () => globalThis.crypto.randomUUID(),
  gcConvention = null,
  extendedHistory = true,
} = {}) {
  if (typeof fetchImpl !== 'function' || typeof now !== 'function' || typeof requestId !== 'function')
    throw new TypeError('A fetch function, clock, and request-id function are required.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
    throw new TypeError('Timeout must be between 1 and 30000 milliseconds.');
  const origins = new Set(allowedOrigins);

  return async function handleContext(request) {
    const startedAt = now();
    let date, market, cutoff, convention;
    const headers = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'CDN-Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'Expires': '0',
      'X-Content-Type-Options': 'nosniff',
      'Vary': 'Origin',
    });
    const origin = request.headers.get('Origin');
    if (origin && origins.has(origin)) headers.set('Access-Control-Allow-Origin', origin);
    function reply(body, status) {
      return new Response(body === null ? null : JSON.stringify(body), { status, headers });
    }
    let controller, timeout, aborted;
    try {
      if (!Number.isFinite(startedAt)) throw problem('INVALID_TIME', 'The current time is unavailable.', 503);
      date = nyDate(startedAt);
      const url = new URL(request.url);
      if (url.pathname !== '/api/context') throw problem('NOT_FOUND', 'This endpoint was not found.', 404);
      if (request.method === 'OPTIONS') {
        if (!origin || !origins.has(origin)) throw problem('ORIGIN_NOT_ALLOWED', 'This website is not allowed to use this endpoint.', 403);
        headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        headers.set('Access-Control-Max-Age', '0');
        return reply(null, 204);
      }
      if (request.method !== 'GET') {
        headers.set('Allow', 'GET, OPTIONS');
        throw problem('METHOD_NOT_ALLOWED', 'Use GET to read the current session context.', 405);
      }
      const params = url.searchParams;
      if ([...params.keys()].some(key => !['market', 'cutoff', 'date', 'v'].includes(key)) ||
          [...new Set(params.keys())].some(key => params.getAll(key).length !== 1))
        throw problem('INVALID_QUERY', 'Use only market, cutoff, today’s New York date, and a numeric request timestamp.', 400);
      if (params.has('v') && !/^\d{1,20}$/.test(params.get('v')))
        throw problem('INVALID_QUERY', 'The request timestamp is invalid.', 400);
      market = params.get('market');
      cutoff = params.get('cutoff');
      if (!MARKETS.has(market)) throw problem('UNSUPPORTED_MARKET', 'Select CL, NQ, ES or GC futures.', 400);
      convention=resolveContextConvention(market,gcConvention);
      if (!CUTOFFS.has(cutoff)) throw problem('INVALID_CUTOFF', 'Select the 03:00, 05:00 or 08:30 New York cutoff.', 400);
      if (params.has('date') && params.get('date') !== date)
        throw problem('DATE_MISMATCH', `Auto-fill reads today’s New York session (${date}).`, 409);
      if ([0, 6].includes(new Date(date + 'T12:00:00Z').getUTCDay()))
        throw problem('INVALID_DATE', 'Auto-fill requires a weekday New York trading date.', 400);
      if (startedAt < nyTimeToEpoch(date, cutoff) * 1000)
        throw problem('CUTOFF_NOT_REACHED', `Wait until ${cutoff} New York time before auto-filling this date.`, 409);

      controller = new AbortController();
      const cancel = () => controller.abort();
      request.signal.addEventListener('abort', cancel, { once: true });
      aborted = () => request.signal.removeEventListener('abort', cancel);
      if (request.signal.aborted) cancel();
      timeout = setTimeout(cancel, timeoutMs);
      const nonce = requestId();
      if (typeof nonce !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(nonce))
        throw problem('INVALID_REQUEST_ID', 'The request could not be prepared.', 503);

      async function chart(symbol, interval = '5m', history = false) {
        const upstream = new URL('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol));
        const query={interval,includePrePost:'true',_request:nonce};
        if(history&&interval==='5m'&&!symbol.endsWith('=F')) {
          // The optional explicit-contract history read follows a successful
          // legacy context read. It must never make that usable context fail.
          query.period1=String(Math.floor(startedAt/1000)-35*86400);
          query.period2=String(Math.floor(startedAt/1000));
        }else query.range='5d';
        upstream.search = new URLSearchParams(query).toString();
        let response;
        try {
          response = await fetchImpl(upstream.href, {
            method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'manual',
            headers: { Accept: 'application/json', 'Cache-Control': 'no-cache', Pragma: 'no-cache', 'User-Agent': 'SessionPath/1.0 (on-demand delayed futures context)' },
            signal: controller.signal,
          });
        } catch (error) {
          // Fixed public upstream only: never log request headers, bodies, or credentials.
          console.error('SessionPath chart fetch failed', JSON.stringify({
            stage: 'chart-fetch', symbol,
            name: String(error?.name || 'Error').slice(0, 80),
            message: String(error?.message || 'Unknown fetch error').replace(/[\r\n]/g, ' ').slice(0, 500),
            aborted: controller.signal.aborted,
          }));
          if (controller.signal.aborted) throw problem('SOURCE_TIMEOUT', 'The delayed-data source timed out. Try again.', 504);
          throw problem('SOURCE_UNAVAILABLE', 'Could not read the delayed-data source. Try again.', 502);
        }
        if (!response.ok)
          throw problem(response.status === 429 ? 'SOURCE_RATE_LIMITED' : 'SOURCE_UNAVAILABLE',
            response.status === 429 ? 'The delayed-data source is busy. Try again shortly.' : 'Could not read the delayed-data source. Try again.', response.status === 429 ? 503 : 502);
        try { return await response.json(); }
        catch {
          if (controller.signal.aborted) throw problem('SOURCE_TIMEOUT', 'The delayed-data source timed out. Try again.', 504);
          throw problem('INVALID_SOURCE_JSON', 'The delayed-data source returned an unreadable chart.', 502);
        }
      }

      const alias = normalizeYahooChart(await chart(market + '=F'), { market });
      const contract = alias.meta.contract;
      if (!new RegExp('^' + market + '[FGHJKMNQUVXZ]\\d{4}$').test(contract))
        throw problem('CONTRACT_MISMATCH', 'The front-month futures contract could not be verified.');
      const symbol = yahooContractSymbol(contract);
      const feed = normalizeYahooChart(await chart(symbol), { market });
      if (controller.signal.aborted) throw problem('SOURCE_TIMEOUT', 'The delayed-data source timed out. Try again.', 504);
      if (feed.meta.continuous || feed.meta.contract !== contract)
        throw problem('CONTRACT_MISMATCH', 'The front-month futures contract changed while reading. Click auto-fill again.');
      let finishedAt = now();
      if (nyDate(finishedAt) !== date)
        throw problem('DATE_ROLLOVER', 'The New York trading date changed while reading. Click auto-fill again.', 409);
      let data, observationFeed = feed, contextFeed = feed, minuteFilledBarCount = 0, twoMinuteFilledBarCount = 0, fifteenMinuteFilledBarCount = 0;
      try {
        data = calculateContext(feed, { date, cutoff, market, contract, convention, nowMs: finishedAt });
      } catch (error) {
        if (!MISSING_WINDOW_CODES.has(error.code)) throw error;
        console.error('SessionPath five-minute chart coverage incomplete', JSON.stringify({
          stage: 'five-minute-coverage', market, date, cutoff, contract, code: error.code, ...missingDetails(error),
        }));
        // One extra request, to this same dated contract, within the original deadline.
        const minutePayload = await chart(symbol, '1m');
        finishedAt = now();
        if (controller.signal.aborted) throw problem('SOURCE_TIMEOUT', 'The delayed-data source timed out. Try again.', 504);
        if (nyDate(finishedAt) !== date)
          throw problem('DATE_ROLLOVER', 'The New York trading date changed while reading. Click auto-fill again.', 409);
        const supplemented = fillMissingFiveMinuteBars(feed, minutePayload, { market, contract, nowMs: finishedAt });
        observationFeed = supplemented.feed;
        contextFeed = supplemented.feed;
        minuteFilledBarCount = supplemented.filledTimes.length;
        try {
          data = calculateContext(supplemented.feed, { date, cutoff, market, contract, convention, nowMs: finishedAt });
        } catch (minuteError) {
          if (!MISSING_WINDOW_CODES.has(minuteError.code)) throw minuteError;
          console.error('SessionPath one-minute coverage incomplete', JSON.stringify({
            stage: 'one-minute-coverage', market, date, cutoff, contract, code: minuteError.code, ...missingDetails(minuteError),
          }));
          // Last bounded attempt: native 2m intervals may exactly tile gaps with
          // retained 1m intervals. Never split a 2m candle at a 5m boundary.
          const twoMinutePayload = await chart(symbol, '2m');
          finishedAt = now();
          if (controller.signal.aborted) throw problem('SOURCE_TIMEOUT', 'The delayed-data source timed out. Try again.', 504);
          if (nyDate(finishedAt) !== date)
            throw problem('DATE_ROLLOVER', 'The New York trading date changed while reading. Click auto-fill again.', 409);
          const tiled = fillMissingFiveMinuteBars(supplemented.feed, minutePayload, { market, contract, nowMs: finishedAt, twoMinutePayload });
          observationFeed = tiled.feed;
          contextFeed = tiled.feed;
          twoMinuteFilledBarCount = tiled.filledTimes.length;
          try {
            data = calculateContext(tiled.feed, { date, cutoff, market, contract, convention, nowMs: finishedAt });
          } catch (coverageError) {
            if (!MISSING_WINDOW_CODES.has(coverageError.code)) throw coverageError;
            // Whole aligned 15m windows preserve exact open/high/low; no synthetic bars.
            const coarse = normalizeYahooChart(await chart(symbol, '15m'), { market, intervalSeconds: 900 });
            finishedAt = now();
            if (controller.signal.aborted) throw problem('SOURCE_TIMEOUT', 'The delayed-data source timed out. Try again.', 504);
            if (nyDate(finishedAt) !== date) throw problem('DATE_ROLLOVER', 'The New York trading date changed. Click auto-fill again.', 409);
            if (coarse.meta.continuous || coarse.meta.contract !== contract) throw problem('CONTRACT_MISMATCH', 'The supplementary chart identifies another contract.');
            const recovered=fillMissingFifteenMinuteBars(coarse,observationFeed,{market,contract,nowMs:finishedAt});
            fifteenMinuteFilledBarCount=recovered.filledTimes.length;
            contextFeed=recovered.feed;
            data = calculateContext(contextFeed, { date, cutoff, market, contract, convention, nowMs: finishedAt, allowOneMissingOvernightBar:true });
            // Retain any genuine smaller candles inside the unresolved block as
            // additional observed extremes, without fabricating the missing OHLC.
            if(data.coverage){
              const gap=data.coverage.missingTime,end=gap+data.coverage.intervalSeconds;
              const partial=observationFeed.bars.filter(bar=>bar.time>=gap&&bar.time+300<=end);
              if(partial.length){
                data.rangeHigh=Math.max(data.rangeHigh,...partial.map(b=>b.high));
                data.rangeLow=Math.min(data.rangeLow,...partial.map(b=>b.low));
                data.up=data.rangeHigh-data.open1930;data.down=data.open1930-data.rangeLow;
                data.coverage.additionalObservedFiveMinuteBars=partial.length;
              }
            }
          }
        }
      }
      let observable=calculateObservableInputs(observationFeed,{date,cutoff,market,contract,convention,
        context:data,contextFeed,historyFeed:feed,nowMs:finishedAt});
      if(extendedHistory&&observable.avr.code==='INSUFFICIENT_AVR_HISTORY'&&!controller.signal.aborted) {
        try {
          const historyFeed=normalizeYahooChart(await chart(symbol,'5m',true),{market});
          if(historyFeed.meta.continuous||historyFeed.meta.contract!==contract)
            throw problem('CONTRACT_MISMATCH','The additional AVR history identifies another futures contract.');
          finishedAt=now();
          observable=calculateObservableInputs(observationFeed,{date,cutoff,market,contract,convention,
            context:data,contextFeed,historyFeed,nowMs:finishedAt});
        }catch(error){
          observable.avr={...observable.avr,code:error instanceof AutoFillError?error.code:'AVR_HISTORY_UNAVAILABLE',
            error:error instanceof AutoFillError?error.message:'The extra frozen-AVR history could not be read.',historyUnavailable:true};
        }
        finishedAt=now();
        if(nyDate(finishedAt)!==date)
          throw problem('DATE_ROLLOVER','The New York trading date changed while reading. Click auto-fill again.',409);
      }
      const generatedAt = new Date(finishedAt).toISOString();
      const result = {
        status: 'ready', date, cutoff, market, generatedAt, source: SOURCE,
        sourceSymbol: data.symbol, contract: data.contract, continuous: false,
        quoteTime: data.quoteTime, priorDate: data.priorDate,
        priorBarCount: data.priorBarCount, overnightBarCount: data.overnightBarCount,
        minuteFilledBarCount, twoMinuteFilledBarCount, fifteenMinuteFilledBarCount, intervalSeconds: data.intervalSeconds,
        values: {...roundedValues(data, market),...observable.values},
        decisionOpen:observable.decisionOpen,avr:observable.avr,lastHour:observable.lastHour,
        observableRange:observable.observableRange,
        ...(data.coverage?{coverage:{...data.coverage,missingTimeNY:MISSING_TIME_FORMAT.format(new Date(data.coverage.missingTime*1000))}}:{}),
        ...(market==='GC'?{convention,snapshotRule:data.snapshotRule}:{}),
      };
      if (cutoff === '08:30') {
        try {
          result.nyPositions = calculateNYPositions(contextFeed, {date, cutoff, market, contract, convention, nowMs:finishedAt});
        } catch (error) {
          // Aligned native 15m prices can locate completed Asia/London closes
          // without invented 5m close counts. Missing context stays unavailable.
          result.nyPositions = {schema:'sessionpath.ny-positions.v1', status:'unavailable', date, market, contract,
            code:error instanceof AutoFillError ? error.code : 'POSITIONS_UNAVAILABLE',
            error:error instanceof AutoFillError ? error.message : 'NY position inputs could not be calculated.'};
        }
        try {
          result.nyDirection = calculateNYDirection(observationFeed, {date, market, contract, convention, contextFeed, nowMs:finishedAt});
        } catch (error) {
          // A usable native 15m context must not masquerade as observed 5m
          // archive close counts. Keep legacy context Auto-fill independent.
          result.nyDirection = {schema:'sessionpath.ny-direction.v1', status:'unavailable', date, market, contract,
            code:error instanceof AutoFillError ? error.code : 'DIRECTION_UNAVAILABLE',
            error:error instanceof AutoFillError ? error.message : 'Direction inputs could not be calculated.'};
        }
      }
      return reply({ schema: SCHEMA, generatedAt, source: SOURCE, mode: 'on-demand', result }, 200);
    } catch (error) {
      const generatedAt = new Date(Number.isFinite(startedAt) ? startedAt : Date.now()).toISOString();
      const failure = {
        status: 'unavailable', date, cutoff, market, generatedAt,
        code: error instanceof AutoFillError ? error.code : 'INTERNAL_ERROR',
        error: error instanceof AutoFillError ? error.message : 'Auto-fill could not complete. Try again.',
      };
      const details = missingDetails(error);
      if (details) {
        failure.details = details;
        failure.error = `The delayed chart is missing ${details.missingCount} required ${details.intervalSeconds / 60}-minute candle${details.missingCount === 1 ? '' : 's'}, starting ${details.firstMissingNY} New York.`;
        console.error('SessionPath chart coverage failed', JSON.stringify({
          stage: 'final-coverage', market, date, cutoff, code: error.code, ...details,
        }));
      }
      return reply({ schema: SCHEMA, generatedAt, source: SOURCE, mode: 'on-demand', result: failure },
      error instanceof AutoFillError ? errorStatus(error) : 500);
    } finally {
      clearTimeout(timeout);
      aborted?.();
    }
  };
}

export default createContextHandler();
