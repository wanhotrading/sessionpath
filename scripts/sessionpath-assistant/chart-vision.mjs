import {MARKETS, WINDOWS, validDate} from './intent.mjs';
import {CHART_REFERENCE_VERSION, CHART_READING_SYSTEM} from '../../docs/chart-reading-reference.mjs';
import {resolveChartShapeArchive} from './chart-shape-archive.mjs';
import {CHART_VISUAL_SESSIONS, CHART_VISUAL_TAG_CODES, CHART_VISUAL_CONFIDENCES, CHART_VISUAL_TEXT_LIMITS, chartVisualPlainText} from '../../docs/chart-visual-contract.mjs';

export const CHART_MAX_REQUEST_BYTES = 2 * 1024 * 1024;
export const CHART_MAX_DATA_URL_LENGTH = 1.5 * 1024 * 1024;
export const CHART_MODEL = 'x-ai/grok-4.7';
export const CHART_TIMEOUT_MS = 180_000;
export const CHART_MAX_OUTPUT_TOKENS = 6000;
// Pricing caps constrain routing; actual reasoning charges still count toward
// the account/key budget. The output-token setting is not a dollar ceiling.
export const CHART_PROVIDER = Object.freeze({only: Object.freeze(['xai']), allow_fallbacks: false, require_parameters: true, max_price: Object.freeze({prompt: 2, completion: 6, image: 0, request: 0})});
const CHART_RESPONSE_MAX_BYTES = 65_536;
export const CHART_TEXT_LIMITS = Object.freeze({summary: 800, sequence: 400, bbox: 600, sessionpath: 600, uncertainties: 300, total: 6000, items: 8});
const CHART_LEGACY_REFERENCE_VERSION = 'sessionpath-chart-v1';
const CHART_SHAPE_SESSIONS = Object.freeze(['NTA', 'ASIA', 'LONDON', 'NY']);
const CHART_SHAPE_END = Object.freeze({NTA: -270, ASIA: 120, LONDON: 510, NY: 960});
const CHART_SHAPE_ORDER = Object.freeze(['high_first', 'low_first', 'same_bar']);
const CHART_SHAPE_KEYS = Object.freeze(['market', 'ticker', 'date', 'cutoff', 'timezone', 'intervalMinutes', 'priorNyHigh', 'priorNyLow', 'open1930', 'sessions']);
const CHART_SHAPE_SESSION_KEYS = Object.freeze(['session', 'high', 'low', 'close', 'order', 'complete']);
const CHART_TICKER = /^(?:(?:CME_MINI|COMEX|NYMEX|CME):)?(M?(?:CL|NQ|ES|GC))(?:[12]!|[FGHJKMNQUVXZ]\d{1,4})$/u;
const CHART_CUTOFF = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/u;
const chartNyClock = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
export class ChartInputError extends Error {
  constructor(code, message, status = 400) {super(message); this.code = code; this.status = status;}
}
function chartKeys(value, required, optional = []) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
const read16be = (bytes, i) => bytes[i] * 256 + bytes[i + 1];
const read16le = (bytes, i) => bytes[i] + bytes[i + 1] * 256;
const read24le = (bytes, i) => bytes[i] + bytes[i + 1] * 256 + bytes[i + 2] * 65536;
const read32be = (bytes, i) => bytes[i] * 16777216 + bytes[i + 1] * 65536 + bytes[i + 2] * 256 + bytes[i + 3];
const read32le = (bytes, i) => bytes[i] + bytes[i + 1] * 256 + bytes[i + 2] * 65536 + bytes[i + 3] * 16777216;
const rasterTag = (bytes, i, count = 4) => String.fromCharCode(...bytes.slice(i, i + count));
function imageDimensions(bytes, mime, raw) {
  const totalLength = raw.length;
  if (mime === 'image/png') {
    if (bytes.length < 45 || ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
      || read32be(bytes, 8) !== 13 || rasterTag(bytes, 12) !== 'IHDR'
      || raw.slice(-8, -4) !== 'IEND') return null;
    let offset = 8, foundData = false, complete = false;
    for (let count = 0; count < 1024 && offset + 12 <= totalLength; count++) {
      const length = raw.charCodeAt(offset) * 16777216 + raw.charCodeAt(offset + 1) * 65536 + raw.charCodeAt(offset + 2) * 256 + raw.charCodeAt(offset + 3), tag = raw.slice(offset + 4, offset + 8);
      if (offset + length + 12 > totalLength || tag === 'acTL') return null;
      if (tag === 'IDAT') foundData = true;
      if (tag === 'IEND') {complete = length === 0 && offset + 12 === totalLength; break;}
      offset += length + 12;
    }
    if (!complete || !foundData) return null;
    return {width: read32be(bytes, 16), height: read32be(bytes, 20)};
  }
  if (mime === 'image/jpeg') {
    if (bytes.length < 12 || bytes[0] !== 255 || bytes[1] !== 216 || raw.charCodeAt(totalLength - 2) !== 255 || raw.charCodeAt(totalLength - 1) !== 217) return null;
    let offset = 2;
    for (let count = 0; count < 256 && offset + 4 < bytes.length; count++) {
      if (bytes[offset++] !== 255) return null;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218 || marker === undefined) return null;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const length = read16be(bytes, offset);
      if (length < 2 || offset + length > bytes.length) return null;
      if ([192, 193, 194].includes(marker)) {
        if (length < 8) return null;
        return {height: read16be(bytes, offset + 3), width: read16be(bytes, offset + 5)};
      }
      offset += length;
    }
    return null;
  }
  if (mime === 'image/webp') {
    if (bytes.length < 30 || rasterTag(bytes, 0) !== 'RIFF' || rasterTag(bytes, 8) !== 'WEBP' || read32le(bytes, 4) !== totalLength - 8) return null;
    const tag = rasterTag(bytes, 12), chunkLength = read32le(bytes, 16);
    if (20 + chunkLength > totalLength) return null;
    if (tag === 'VP8X' && chunkLength >= 10 && !(bytes[20] & 2)) return {width: read24le(bytes, 24) + 1, height: read24le(bytes, 27) + 1};
    if (tag === 'VP8 ' && chunkLength >= 10 && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) return {width: read16le(bytes, 26) & 16383, height: read16le(bytes, 28) & 16383};
    if (tag === 'VP8L' && chunkLength >= 5 && bytes[20] === 47 && !(bytes[24] & 224)) return {width: 1 + bytes[21] + ((bytes[22] & 63) << 8), height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10)};
  }
  return null;
}

export function validateChartImage(dataUrl) {
  const invalid = () => {throw new ChartInputError('INVALID_CHART_IMAGE', 'Upload a valid static JPEG, PNG or WebP screenshot.');};
  if (typeof dataUrl !== 'string') return invalid();
  if (dataUrl.length > CHART_MAX_DATA_URL_LENGTH) throw new ChartInputError('CHART_IMAGE_TOO_LARGE', 'Resize the screenshot before sending it.', 413);
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/u.exec(dataUrl);
  if (!match || !match[2] || match[2].length % 4 !== 0) return invalid();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if ((match[2].endsWith('==') && (alphabet.indexOf(match[2].at(-3)) & 15)) || (match[2].endsWith('=') && !match[2].endsWith('==') && (alphabet.indexOf(match[2].at(-2)) & 3))) return invalid();
  let raw;
  try {raw = atob(match[2]);} catch {return invalid();}
  // Only inspect bounded headers and chunk boundaries. The Worker never
  // decompresses pixels or allocates a second full decoded image buffer.
  const bytes = new Uint8Array(Math.min(raw.length, 65_536));
  for (let i = 0; i < bytes.length; i++) bytes[i] = raw.charCodeAt(i);
  const dimensions = imageDimensions(bytes, match[1], raw);
  if (!dimensions) return invalid();
  const {width, height} = dimensions;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 12_000_000) {
    throw new ChartInputError('CHART_IMAGE_DIMENSIONS', 'Use a screenshot no larger than 4096 pixels per side and 12 megapixels.');
  }
  return {dataUrl, mime: match[1], width, height};
}

function validHistoricalObservation(value, now) {
  const parts = Object.fromEntries(chartNyClock.formatToParts(now).map(({type, value}) => [type, value]));
  const nyNow = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  return chartKeys(value, ['mode', 'date', 'cutoff']) && value.mode === 'historical' && validDate(value.date, {now})
    && (value.cutoff === null || (typeof value.cutoff === 'string' && CHART_CUTOFF.test(value.cutoff)
      && value.cutoff.slice(0,10) === value.date && value.cutoff <= nyNow && chartCutoffMinute(value.date, value.cutoff) !== null));
}

export function validateChartRequest(value, {now = Date.now()} = {}) {
  if (!chartKeys(value, ['context', 'image'], ['message', 'referenceVersion', 'observation']) || !chartKeys(value.context, ['market', 'window', 'date'])
    || !MARKETS.includes(value.context.market) || !WINDOWS.includes(value.context.window)
    || !(value.context.date === null || validDate(value.context.date, {now})) || !chartKeys(value.image, ['dataUrl'])
    || (value.referenceVersion !== undefined && ![CHART_REFERENCE_VERSION, 'sessionpath-chart-v6', 'sessionpath-chart-v5', 'sessionpath-chart-v4', 'sessionpath-chart-v3', 'sessionpath-chart-v2', CHART_LEGACY_REFERENCE_VERSION].includes(value.referenceVersion))
    || (value.observation !== undefined && !validHistoricalObservation(value.observation, now))
    || (value.message !== undefined && (typeof value.message !== 'string' || value.message.length > 600 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value.message)))) {
    throw new ChartInputError('INVALID_CHART_REQUEST', 'Choose a supported market, window and valid date, then attach one screenshot.');
  }
  return {message: value.message?.trim() || 'Describe the visible price movement so far.', context: {...value.context}, image: validateChartImage(value.image.dataUrl), referenceVersion: value.referenceVersion ?? CHART_LEGACY_REFERENCE_VERSION, ...(value.observation ? {observation: {...value.observation}} : {})};
}

const chartString = maxLength => ({type: 'string', minLength: 1, maxLength});
const chartNullableEnum = (type, choices) => ({type: [type, 'null'], enum: [...choices, null]});
const chartNullablePrice = {type: ['number', 'null']};
const CHART_VISUAL_MODEL_KEYS = Object.freeze(['session', 'tag', 'confidence', 'evidence', 'uncertainty', 'complete']);
const CHART_VISUAL_SCHEMA = {
  type: 'array', minItems: 4, maxItems: 4, items: {
    type: 'object', required: CHART_VISUAL_MODEL_KEYS, additionalProperties: false,
    properties: {
      session: {type: 'string', enum: CHART_VISUAL_SESSIONS},
      tag: chartNullableEnum('string', CHART_VISUAL_TAG_CODES),
      confidence: {type: 'string', enum: CHART_VISUAL_CONFIDENCES},
      evidence: {type: 'string', maxLength: CHART_VISUAL_TEXT_LIMITS.evidence},
      uncertainty: {type: 'string', maxLength: CHART_VISUAL_TEXT_LIMITS.uncertainty}, complete: {type: 'boolean'},
    },
  },
};
const CHART_SHAPE_SCHEMA = {
  type: 'object', required: [...CHART_SHAPE_KEYS,'captureNy'], additionalProperties: false,
  properties: {
    market: chartNullableEnum('string', MARKETS), ticker: {type: ['string', 'null'], maxLength: 32},
    date: {type: ['string', 'null'], maxLength: 10}, cutoff: {type: ['string', 'null'], maxLength: 16},
    captureNy: {type: ['string','null'], maxLength: 16},
    timezone: chartNullableEnum('string', ['America/New_York']), intervalMinutes: chartNullableEnum('integer', [5]),
    priorNyHigh: chartNullablePrice, priorNyLow: chartNullablePrice, open1930: chartNullablePrice,
    sessions: {type: 'array', maxItems: 4, items: {
      type: 'object', required: CHART_SHAPE_SESSION_KEYS, additionalProperties: false,
      properties: {
        session: {type: 'string', enum: CHART_SHAPE_SESSIONS}, high: chartNullablePrice, low: chartNullablePrice, close: chartNullablePrice,
        order: chartNullableEnum('string', CHART_SHAPE_ORDER), complete: {type: 'boolean'},
      },
    }},
  },
};
export const CHART_ANALYSIS_SCHEMA = Object.freeze({
  type: 'object', properties: {
    shapeEvidence: CHART_SHAPE_SCHEMA,
    visualTags: CHART_VISUAL_SCHEMA,
    summary: chartString(CHART_TEXT_LIMITS.summary),
    sequence: {type: 'array', minItems: 1, maxItems: CHART_TEXT_LIMITS.items, items: chartString(CHART_TEXT_LIMITS.sequence)},
    bbox: chartString(CHART_TEXT_LIMITS.bbox), sessionpath: chartString(CHART_TEXT_LIMITS.sessionpath),
    uncertainties: {type: 'array', minItems: 1, maxItems: CHART_TEXT_LIMITS.items, items: chartString(CHART_TEXT_LIMITS.uncertainties)},
  }, required: ['shapeEvidence', 'visualTags', 'summary', 'sequence', 'bbox', 'sessionpath', 'uncertainties'], additionalProperties: false,
});
function chartPlainText(value, limit) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) return false;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]|```|<[^>]*>|https?:\/\/|javascript:|data:|sk-or-|\bSP[1-9]\|/iu.test(value)) return false;
  // Visible percentage labels (for example AVR usage) are chart evidence.
  // Reject explicit numerical probability claims, not the percent character.
  if (/\b\d+(?:\.\d+)?\s*(?:%|percent|per\s+cent)\s*(?:chance|probability|odds|likely|certainty)\b|\b(?:probability|chance|odds|win[- ]?rate)\s*(?:(?:is|of|at|:|=|about|around)\s*){0,2}\d+(?:\.\d+)?\s*(?:%|percent|per\s+cent)|(?:概率|機率|几率|勝率|胜率)[^\d]{0,10}\d+(?:\.\d+)?\s*[%％]/iu.test(value)) return false;
  if (/\b(?:buy|sell|stop[- ]?loss|take[- ]?profit|entry\s+price|price\s+target)\b|\b(?:enter|exit)\s+(?:a|the|your|this|long|short|trade|position)\b|\b(?:go|stay|open|add)\s+(?:long|short)\b|買入|买入|賣出|卖出|做多|做空|止損|止损|止盈|進場|进场|出場|出场/iu.test(value)) return false;
  return true;
}
export function validateChartAnalysis(value) {
  if (!chartKeys(value, ['summary', 'sequence', 'bbox', 'sessionpath', 'uncertainties'], ['shapeEvidence', 'visualTags'])) return null;
  if (!chartPlainText(value.summary, CHART_TEXT_LIMITS.summary) || !chartPlainText(value.bbox, CHART_TEXT_LIMITS.bbox) || !chartPlainText(value.sessionpath, CHART_TEXT_LIMITS.sessionpath)) return null;
  for (const key of ['sequence', 'uncertainties']) {
    if (!Array.isArray(value[key]) || value[key].length < 1 || value[key].length > CHART_TEXT_LIMITS.items || !value[key].every(item => chartPlainText(item, CHART_TEXT_LIMITS[key]))) return null;
  }
  const strings = [value.summary, value.bbox, value.sessionpath, ...value.sequence, ...value.uncertainties];
  if (strings.reduce((count, text) => count + text.length, 0) > CHART_TEXT_LIMITS.total) return null;
  return {summary: value.summary.trim(), sequence: value.sequence.map(text => text.trim()), bbox: value.bbox.trim(), sessionpath: value.sessionpath.trim(), uncertainties: value.uncertainties.map(text => text.trim())};
}

function chartCutoffMinute(date, cutoff) {
  const match = typeof cutoff === 'string' && CHART_CUTOFF.exec(cutoff);
  if (!date || !match || !validDate(match[1], {allowFuture: true}) || Number(match[3]) % 5 !== 0) return null;
  const days = (Date.parse(`${match[1]}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 86_400_000;
  return days === -1 || days === 0 ? days * 1440 + Number(match[2]) * 60 + Number(match[3]) : null;
}

const chartPriceOrNull = value => value === null || Number.isFinite(value);
export function validateChartShapeEvidence(value, {now = Date.now(), observation} = {}) {
  if (!chartKeys(value, CHART_SHAPE_KEYS, ['captureNy'])
    || !(value.market === null || MARKETS.includes(value.market))
    || !(value.ticker === null || (typeof value.ticker === 'string' && value.ticker.length <= 32 && CHART_TICKER.test(value.ticker)))
    || !(value.date === null || validDate(value.date, {allowFuture: true}))
    || !(value.cutoff === null || (typeof value.cutoff === 'string' && CHART_CUTOFF.test(value.cutoff)))
    || !(value.captureNy == null || (typeof value.captureNy === 'string' && CHART_CUTOFF.test(value.captureNy) && validDate(value.captureNy.slice(0,10), {allowFuture:true})))
    || !(value.timezone === null || value.timezone === 'America/New_York')
    || !(value.intervalMinutes === null || value.intervalMinutes === 5)
    || ![value.priorNyHigh, value.priorNyLow, value.open1930].every(chartPriceOrNull)
    || !Array.isArray(value.sessions) || value.sessions.length > 4) return null;
  const seen = new Set();
  for (const row of value.sessions) {
    if (!chartKeys(row, CHART_SHAPE_SESSION_KEYS) || !CHART_SHAPE_SESSIONS.includes(row.session) || seen.has(row.session)
      || ![row.high, row.low, row.close].every(chartPriceOrNull) || !(row.order === null || CHART_SHAPE_ORDER.includes(row.order))
      || typeof row.complete !== 'boolean') return null;
    seen.add(row.session);
  }
  const nowParts = Object.fromEntries(chartNyClock.formatToParts(now).map(({type, value}) => [type, value]));
  const nyNow = `${nowParts.year}-${nowParts.month}-${nowParts.day}T${nowParts.hour}:${nowParts.minute}`;
  const matchesObservation = !observation || (validHistoricalObservation(observation, now) && value.date === observation.date);
  const cutoff = matchesObservation && value.timezone === 'America/New_York' && value.cutoff !== null && value.cutoff <= nyNow && (value.captureNy == null || value.cutoff <= value.captureNy) && chartCutoffMinute(value.date, value.cutoff) !== null && (!observation?.cutoff || value.cutoff <= observation.cutoff) ? value.cutoff : null;
  const date = matchesObservation && (cutoff !== null || value.date <= nyNow.slice(0, 10)) ? value.date : null;
  const tickerMarket = value.ticker?.match(CHART_TICKER)?.[1].replace(/^M/u, '');
  return {...value, market: tickerMarket ?? value.market, date, cutoff};
}

// Keep the exact narrow-first precedence, order and close thresholds used in
// the archived CL and NQ shape exporters. Missing order is not same-bar order.
export function classifySessionShape({high, low, close, order, bboxWidth}) {
  if (![high, low, close].every(Number.isFinite) || low > high || close < low || close > high) return null;
  const range = high - low;
  if (!Number.isFinite(range)) return null;
  if (Number.isFinite(bboxWidth) && bboxWidth > 0 && range < .18 * bboxWidth) return 'NARROW';
  if (range === 0 || order === 'same_bar') return 'ORDER_UNRESOLVED';
  if (order !== 'high_first' && order !== 'low_first') return null;
  const position = (close - low) / range;
  return order === 'high_first'
    ? position <= .25 ? 'DOWN_FINISH' : position >= .70 ? 'DROP_RECOVERY' : 'DOWN_THEN_BOUNCE'
    : position <= .30 ? 'RALLY_FADE' : position >= .75 ? 'UP_FINISH' : 'UP_THEN_PULLBACK';
}

export function classifyChartShapeEvidence(value, options) {
  const evidence = validateChartShapeEvidence(value, options);
  if (!evidence) return null;
  const {market, ticker, date, cutoff, timezone, intervalMinutes, priorNyHigh, priorNyLow, sessions} = evidence;
  const cutoffMinute = chartCutoffMinute(date, cutoff);
  const bboxWidth = priorNyHigh !== null && priorNyLow !== null ? priorNyHigh - priorNyLow : null;
  const chartObservation = {market, ticker, date, cutoff, timezone, intervalMinutes};
  const shapeTags = CHART_SHAPE_SESSIONS.map(session => {
    const unverified = reason => ({session, tag: null, status: 'unverified', reason});
    if (cutoffMinute !== null && cutoffMinute < CHART_SHAPE_END[session]) {
      return {session, tag: null, status: 'in_progress', reason: 'The session had not ended at the last completed candle.'};
    }
    if (!market || !date || cutoffMinute === null || intervalMinutes !== 5) {
      return unverified('The market, five-minute timeframe or New York cutoff could not be established.');
    }
    const row = sessions.find(candidate => candidate.session === session);
    if (!row?.complete) return unverified('The entire completed session is not established in the image.');
    if (!Number.isFinite(bboxWidth) || bboxWidth <= 0) return unverified('The prior NY BBOX width is not established for the Narrow range check.');
    const tag = classifySessionShape({...row, bboxWidth});
    if (tag === null) return unverified('The exact session extremes, final close or order are missing or inconsistent.');
    return {session, tag, status: 'provisional', reason: 'Rule-based result from values read from the screenshot; verify against completed candles.'};
  });
  return {chartObservation, shapeTags};
}

// A model proposes only visual evidence. Status and source are assigned here;
// this path never reads the archive or changes the formal classifier's result.
export function validateChartVisualProposal(row) {
  return chartKeys(row, CHART_VISUAL_MODEL_KEYS) && CHART_VISUAL_SESSIONS.includes(row.session)
    && (row.tag === null || CHART_VISUAL_TAG_CODES.includes(row.tag))
    && CHART_VISUAL_CONFIDENCES.includes(row.confidence) && typeof row.complete === 'boolean'
    && chartVisualPlainText(row.evidence, CHART_VISUAL_TEXT_LIMITS.evidence)
    && chartVisualPlainText(row.uncertainty, CHART_VISUAL_TEXT_LIMITS.uncertainty);
}

export function normalizeChartVisualTags(rows, {shapeEvidence, observation, now = Date.now()} = {}) {
  const evidence = validateChartShapeEvidence(shapeEvidence, {now, observation});
  const supplied = observation && validHistoricalObservation(observation, now) ? observation : null;
  const suppliedMinute = supplied?.cutoff ? chartCutoffMinute(supplied.date, supplied.cutoff) : null;
  const chartMinute = evidence ? chartCutoffMinute(evidence.date, evidence.cutoff) : null;
  // Use the earlier established endpoint when both clocks are available. In
  // particular, a later model cutoff cannot evade the user's earlier deadline.
  const cutoffMinute = suppliedMinute === null ? chartMinute : chartMinute === null ? suppliedMinute : Math.min(suppliedMinute, chartMinute);
  const dateConflict = Boolean(supplied && typeof shapeEvidence?.date === 'string'
    && validDate(shapeEvidence.date, {allowFuture: true}) && shapeEvidence.date !== supplied.date);
  const cutoffConflict = Boolean(supplied?.cutoff && typeof shapeEvidence?.cutoff === 'string'
    && CHART_CUTOFF.test(shapeEvidence.cutoff) && shapeEvidence.cutoff > supplied.cutoff);
  const proposals = Array.isArray(rows) && rows.length <= 4 ? rows : [];
  const uncertainty = (...parts) => parts.filter(Boolean).join(' ').slice(0, CHART_VISUAL_TEXT_LIMITS.uncertainty);
  return CHART_VISUAL_SESSIONS.map(session => {
    const matches = proposals.filter(row => row?.session === session);
    const proposal = matches.length === 1 && validateChartVisualProposal(matches[0]) ? matches[0] : null;
    const base = {session, tag: null, confidence: 'unclassified', evidence: proposal?.evidence.trim() || '', uncertainty: proposal?.uncertainty.trim() || '', complete: proposal?.complete ?? false, source: 'visual', status: 'unclassified'};
    if (cutoffMinute !== null && cutoffMinute < CHART_SHAPE_END[session]) {
      return {...base, complete: false, status: 'in_progress', uncertainty: uncertainty('The session had not ended at the established completed-close cutoff.', base.uncertainty)};
    }
    if (dateConflict) return {...base, complete: false, uncertainty: uncertainty('The chart date conflicts with the supplied historical date; session timing is unclassified.', base.uncertainty)};
    if (!proposal) return {...base, uncertainty: 'No valid visual proposal was supplied for this session.'};
    if (!proposal.complete) return {...base, uncertainty: uncertainty('The complete session is not established visually.', base.uncertainty)};
    if (proposal.tag === null || proposal.confidence === 'unclassified' || !proposal.evidence.trim()) {
      return {...base, uncertainty: uncertainty(base.uncertainty, 'The visible evidence does not support a visual tag proposal.')};
    }
    const timingUnknown = cutoffMinute === null;
    const clockUnverified = evidence?.intervalMinutes !== 5 || evidence?.timezone !== 'America/New_York';
    return {...base, tag: proposal.tag, confidence: timingUnknown || clockUnverified || cutoffConflict ? 'tentative' : proposal.confidence, status: 'candidate',
      uncertainty: uncertainty(
        timingUnknown ? 'Timing uncertainty: the New York completed-close cutoff is not established; full-session coverage is a visual proposal.' : '',
        clockUnverified ? 'The five-minute New York candle clock is not independently established.' : '',
        cutoffConflict ? 'The supplied cutoff takes precedence over the later model-reported cutoff.' : '',
        base.uncertainty,
      ),
    };
  });
}

export async function handleChartAnalysis(input, env, {fetcher, timeoutMs = CHART_TIMEOUT_MS, origin, reply, errorReply, boundedText, classifyRejectedUpstream, model, endpoint, signal, now = Date.now()}) {
  if (!env.OPENROUTER_API_KEY) return errorReply(503, 'AI_NOT_CONFIGURED', 'The chart interpreter is not available yet.', origin);
  // Visual reads share the existing key spending cap, without an additional
  // SessionPath daily, client or short-window request-count quota.
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortParent = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abortParent, {once: true});
  try {
    if (controller.signal.aborted) throw new DOMException('The chart request was cancelled.', 'AbortError');
    const upstream = await fetcher(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'HTTP-Referer': 'https://wanhotrading.github.io/sessionpath/', 'X-OpenRouter-Title': 'SessionPath Chart Reader'}, signal: controller.signal,
      body: JSON.stringify({model, messages: [
        {role: 'system', content: `${CHART_READING_SYSTEM}\nReturn only the requested JSON: five descriptive outputs, structured shapeEvidence and four visualTags rows. Keep prose concise and plain text without markup or URLs. For an unreadable or blank image, state that the evidence cannot be established; use null shape evidence and an empty shapeEvidence.sessions list, and four null, unclassified visualTags with complete false instead of inventing events.`},
        {role: 'user', content: [{type: 'text', text: JSON.stringify({request: input.message, ...(input.observation ? {observation: input.observation} : {})})}, {type: 'image_url', image_url: {url: input.image.dataUrl}}]},
      ], max_tokens: CHART_MAX_OUTPUT_TOKENS, temperature: 0.7, top_p: 0.95, stream: false, reasoning: {effort: 'low', exclude: true}, provider: CHART_PROVIDER, response_format: {type: 'json_schema', json_schema: {name: 'sessionpath_chart_analysis', strict: true, schema: CHART_ANALYSIS_SCHEMA}}}),
    });
    if (!upstream.ok) {
      if (upstream.status === 400 || upstream.status === 422) {
        // The shared classifier is also used by the free intent parser. Keep
        // its safe codes, but do not return free-model claims for paid images.
        let diagnosis = classifyRejectedUpstream(''); try {diagnosis = classifyRejectedUpstream(await boundedText(upstream.body, 8192));} catch {}
        const chartMessages = {
          AI_CREDIT_RESTRICTED: 'OpenRouter rejected the chart request because of an account or key-budget restriction.',
          FREE_MODEL_REASONING_UNSUPPORTED: 'The chart provider rejected the reasoning settings. No automatic retry was made.',
          FREE_MODEL_SCHEMA_UNSUPPORTED: 'The chart provider rejected the structured-output settings. No automatic retry was made.',
          FREE_MODEL_REQUEST_REJECTED: 'The chart provider rejected this request configuration. No automatic retry was made.',
        };
        return errorReply(503, diagnosis.code, chartMessages[diagnosis.code] || chartMessages.FREE_MODEL_REQUEST_REJECTED, origin);
      }
      await upstream.body?.cancel();
      if (upstream.status === 401) return errorReply(503, 'AI_KEY_REJECTED', 'OpenRouter rejected the server API key.', origin);
      if (upstream.status === 402) return errorReply(503, 'AI_CREDIT_RESTRICTED', 'OpenRouter blocked this chart request because of an account or key credit restriction.', origin);
      if (upstream.status === 403) return errorReply(503, 'AI_ACCESS_RESTRICTED', 'OpenRouter denied access for this server key or account.', origin);
      if (upstream.status === 429) return errorReply(429, 'FREE_MODEL_BUSY', 'Chart-reading capacity is busy. Try again later.', origin, {'Retry-After': '60'});
      return errorReply(503, 'FREE_MODEL_UNAVAILABLE', 'The chart interpreter is temporarily unavailable. No automatic retry was made.', origin);
    }
    if (Number(upstream.headers.get('Content-Length')) > CHART_RESPONSE_MAX_BYTES) {await upstream.body?.cancel(); throw new Error('Response too large');}
    const data = JSON.parse(await boundedText(upstream.body, CHART_RESPONSE_MAX_BYTES));
    if (data.model !== model) throw new Error('Unexpected chart model');
    if (data.choices?.length === 1 && data.choices[0]?.finish_reason === 'length') return errorReply(503, 'FREE_MODEL_OUTPUT_LIMIT', 'The chart interpreter reached its output limit. Try a simpler screenshot.', origin);
    if (!Array.isArray(data.choices) || data.choices.length !== 1 || data.choices[0]?.finish_reason !== 'stop' || typeof data.choices[0]?.message?.content !== 'string') throw new Error('Invalid result');
    const modelAnalysis = JSON.parse(data.choices[0].message.content);
    const analysis = validateChartAnalysis(modelAnalysis);
    if (!analysis) throw new Error('Invalid analysis');
    const shapeOptions = {now, observation: input.observation};
    const shape = resolveChartShapeArchive(validateChartShapeEvidence(modelAnalysis.shapeEvidence, shapeOptions), classifyChartShapeEvidence(modelAnalysis.shapeEvidence, shapeOptions));
    const visualTags = normalizeChartVisualTags(modelAnalysis.visualTags, {...shapeOptions, shapeEvidence: modelAnalysis.shapeEvidence});
    return reply({ok: true, schema: 'sessionpath.assistant.chart.v1', action: 'describe_chart', ...input.context, model, referenceVersion: input.referenceVersion, analysis, ...shape, visualTags, ...(input.observation ? {observationContext: input.observation} : {})}, 200, origin);
  } catch {
    return errorReply(503, controller.signal.aborted ? 'FREE_MODEL_TIMEOUT' : 'INVALID_CHART_RESPONSE', controller.signal.aborted ? 'The chart interpreter timed out. No automatic retry was made.' : 'The chart interpreter did not return a valid descriptive result. No forecast was created.', origin);
  } finally {clearTimeout(timer); signal?.removeEventListener('abort', abortParent);}
}
