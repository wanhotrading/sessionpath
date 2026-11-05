export const MARKETS = Object.freeze(['CL', 'NQ', 'ES', 'GC']);
export const WINDOWS = Object.freeze(['03:00-05:00', '05:00-08:30', '08:30-16:00']);
export const CONCEPTS = Object.freeze(['mean_box', 'containment', 'avr_expansion', 'extension']);
export const ACTIONS = Object.freeze(['forecast', 'explain', 'clarify']);

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

export function nyToday(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date(now));
  const part = type => parts.find(item => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function validDate(value, {now = Date.now(), allowFuture = false} = {}) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const stamp = Date.parse(`${value}T12:00:00Z`);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) return false;
  return allowFuture || value <= nyToday(now);
}

export function validateRequest(value, {now = Date.now()} = {}) {
  if (!exactKeys(value, ['message', 'context'])) return null;
  if (typeof value.message !== 'string' || !value.message.trim() || value.message.length > 600
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value.message)) return null;
  if (!(exactKeys(value.context, ['market', 'window']) || exactKeys(value.context, ['market', 'window', 'date'])) || !MARKETS.includes(value.context.market)
    || !WINDOWS.includes(value.context.window)) return null;
  const date = value.context.date ?? null;
  if (date !== null && !validDate(date, {now})) return null;
  // Presence (including null) is the new client's date-handling capability.
  // Older cached clients discard response.date, so they cannot safely receive
  // a historical forecast intent. This internal flag is never sent to the AI.
  return {message: value.message.trim(), context: {...value.context, date}, supportsHistorical: Object.hasOwn(value.context, 'date')};
}

export function validateIntent(value, {now = Date.now(), defaultDate = null} = {}) {
  if (!(exactKeys(value, ['action', 'market', 'window', 'concept']) || exactKeys(value, ['action', 'market', 'window', 'concept', 'date']))) return null;
  if (!ACTIONS.includes(value.action) || !MARKETS.includes(value.market) || !WINDOWS.includes(value.window)
    || !(value.concept === null || CONCEPTS.includes(value.concept))) return null;
  if (value.action === 'explain' && value.concept === null) return null;
  if (value.action !== 'explain' && value.concept !== null) return null;
  const date = Object.hasOwn(value, 'date') ? value.date : defaultDate;
  if (date !== null && !validDate(date, {now})) return null;
  return {...value, date};
}

const MONTH_NAMES = Object.freeze({jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12});
const MONTH_WORD = '(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)';
const YEAR_SUFFIX = '(?:\\s*,?\\s*(\\d{4})(?![\\d:-])|\\s*,\\s*(\\d{2,3})(?![\\d:-]))?';
function chineseNumber(value) {
  if (/^\d+$/u.test(value)) return Number(value);
  const digit = {零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9};
  if (value.includes('廿')) return 20 + (digit[value.replace('廿', '')] ?? 0);
  if (value.includes('十')) {const [ten, unit] = value.split('十'); return (ten ? digit[ten] : 1) * 10 + (unit ? digit[unit] : 0);}
  if ([...value].every(char => Object.hasOwn(digit, char))) return Number([...value].map(char => digit[char]).join(''));
  return NaN;
}
function calendarDate(year, month, day) { return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
function resolvedMonthDay(month, day, year, now) {
  const today = nyToday(now);
  if (year) {
    const date = calendarDate(Number(year), month, day);
    if (!validDate(date, {now, allowFuture: true})) return {status: 'invalid', date: null};
    return date > today ? {status: 'future', date: null} : {status: 'valid', date};
  }
  for (let candidateYear = Number(today.slice(0, 4)); candidateYear >= Number(today.slice(0, 4)) - 8; candidateYear--) {
    const date = calendarDate(candidateYear, month, day);
    if (validDate(date, {now})) return {status: 'valid', date};
  }
  return {status: 'invalid', date: null};
}

// Date interpretation is deterministic and separate from the model. Omitted
// years resolve to the most recent real calendar date on/before NY today.
// null explicitly means the live/current trading date, including today/now.
export function resolveMessageDate(message, {now = Date.now(), date = null} = {}) {
  let remaining = message.normalize('NFKC').trim();
  const hits = [];
  remaining = remaining.replace(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/gu, (_match, year, month, day) => {hits.push(resolvedMonthDay(Number(month), Number(day), Number(year), now)); return ' ';});
  remaining = remaining.replace(/(?:(\d{4}|[〇零一二三四五六七八九]{4})年)?(\d{1,2}|[一二三四五六七八九十廿]{1,3})月(\d{1,2}|[一二三四五六七八九十廿]{1,3})[日號号]/gu, (_match, year, month, day) => {hits.push(resolvedMonthDay(chineseNumber(month), chineseNumber(day), year ? chineseNumber(year) : undefined, now)); return ' ';});
  remaining = remaining.replace(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_WORD})\\.?${YEAR_SUFFIX}\\b`, 'giu'), (_match, day, month, year, shortYear) => {hits.push(shortYear ? {status: 'ambiguous', date: null} : resolvedMonthDay(MONTH_NAMES[month.toLowerCase()], Number(day), year, now)); return ' ';});
  remaining = remaining.replace(new RegExp(`\\b(${MONTH_WORD})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?${YEAR_SUFFIX}\\b`, 'giu'), (_match, month, day, year, shortYear) => {hits.push(shortYear ? {status: 'ambiguous', date: null} : resolvedMonthDay(MONTH_NAMES[month.toLowerCase()], Number(day), year, now)); return ' ';});
  remaining = remaining.replace(/\b(day before yesterday|yesterday|today|tonight|now|tomorrow)\b|前天|昨天|昨日|今天|今日|現在|现在|明天|後天|后天/giu, match => {
    const token = match.toLowerCase();
    if (/^(?:today|tonight|now|今天|今日|現在|现在)$/u.test(token)) hits.push({status: 'valid', date: null});
    else if (/^(?:tomorrow|明天|後天|后天)$/u.test(token)) hits.push({status: 'future', date: null});
    else {const offset = /^(?:day before yesterday|前天)$/u.test(token) ? 2 : 1; hits.push({status: 'valid', date: new Date(Date.parse(`${nyToday(now)}T12:00:00Z`) - offset * 86_400_000).toISOString().slice(0, 10)});}
    return ' ';
  });
  if (hits.length > 1 || /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/u.test(remaining)) return {status: 'ambiguous', date: null, remaining};
  if (hits.length) return {...hits[0], remaining};
  return {status: 'none', date, remaining};
}

// Only a bounded vocabulary of direct forecast commands is interpreted here.
// Other natural language and explanation requests still use the real AI.
export function parseExactForecast(message, {now = Date.now(), date = null} = {}) {
  const dated = resolveMessageDate(message, {now, date});
  if (!['none', 'valid'].includes(dated.status)) return null;
  let text = dated.remaining.toUpperCase().replace(/[–—→]/gu, '-');
  const markets = new Set();
  for (const [market, pattern] of [
    ['CL', /\b(?:CL|MCL|WTI|CRUDE(?:\s+OIL)?)\b|美原油|原油/gu],
    ['NQ', /\b(?:NQ|MNQ|NASDAQ(?:\s*100)?)\b|納斯達克|纳斯达克|納指|纳指/gu],
    ['ES', /\b(?:ES|MES|S&P(?:\s*500)?)\b|標普(?:\s*500)?|标普(?:\s*500)?/gu],
    ['GC', /\b(?:GC|MGC|GOLD)\b|黃金|黄金/gu],
  ]) text = text.replace(pattern, () => {markets.add(market); return ' ';});
  if (markets.size !== 1) return null;
  const windows = [];
  text = text.replace(/(?<!\d)(0?3(?::?00)?\s*-\s*0?5(?::?00)?|0?5(?::?00)?\s*-\s*0?8:?30|0?8:?30\s*-\s*16(?::?00)?)(?!\d)/gu, match => {
    const compact = match.replace(/[\s:]/gu, '');
    windows.push(/^0?3(?:00)?-0?5(?:00)?$/u.test(compact) ? WINDOWS[0] : /^0?5(?:00)?-0?830$/u.test(compact) ? WINDOWS[1] : WINDOWS[2]);
    return ' ';
  });
  if (windows.length !== 1) return null;
  text = text.replace(/\b(?:CAN|COULD|WOULD|YOU|PLEASE|HELP|ME|FETCH|GET|SHOW|GIVE|DISPLAY|THE|A|AN|FOR|OF|ON|RANGE|FORECAST|BOX|BOXES|CODE|PROBABILITY|PROBABILITIES|AND|WITH|TO|MY|I|WANT|NEED|HAVE|S|SESSIONPATH|SESSION|WINDOW)\b/gu, ' ')
    .replace(/請|请|幫我|帮我|給我|给我|顯示|显示|取得|獲取|获取|預測|预测|範圍|范围|區間|区间|代碼|代码|概率|機率|几率|的|和|以及|可以|嗎|吗/gu, ' ')
    .replace(/[\s,.:;!?"'’‘()，。！？：；、]/gu, '');
  if (text) return null;
  return {action: 'forecast', market: [...markets][0], window: windows[0], concept: null, date: dated.date};
}

export const INTENT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    action: {type: 'string', enum: ACTIONS},
    market: {type: 'string', enum: MARKETS},
    window: {type: 'string', enum: WINDOWS},
    concept: {type: ['string', 'null'], enum: [null, ...CONCEPTS]},
    date: {type: ['string', 'null'], description: 'Requested New York trading date YYYY-MM-DD, or null for live/current date. Preserve the resolved date supplied by the server.'},
  },
  required: ['action', 'market', 'window', 'concept', 'date'],
  additionalProperties: false,
});

// Model prose is never trusted or displayed. Only this bounded, local text is
// returned; prices, probabilities and export codes come from SessionPath itself.
export function renderIntent(intent, interpreter, {dateStatus} = {}) {
  const explanations = {
    mean_box: 'The mean box summarizes historical upside and downside excursions for the selected conditions. Its edges are historical average distances, not guaranteed boundaries.',
    containment: 'Containment measures how often an entire historical path stayed inside the forecast box. It is different from a final close inside or a return after a breach.',
    avr_expansion: 'AVR expansion measures additional movement beyond the running high and low since the overnight start, normalized by the frozen AVR. Zero-expansion observations are included.',
    extension: 'Extension levels use the full SessionPath box width, measured from the opposite extreme. Historical hit rates depend on the selected breakout definition and observation window.',
  };
  const dateMessages = {invalid: 'Please enter one valid calendar date, preferably YYYY-MM-DD.', future: 'Future sessions do not have forecast snapshots yet. Choose today or an earlier date.', ambiguous: 'Please choose one date and include its year as YYYY-MM-DD if the date could be ambiguous.', reload: 'Reload SessionPath to request historical dates, then send your request again.'};
  const message = intent.action === 'explain' ? explanations[intent.concept]
    : intent.action === 'clarify' ? dateMessages[dateStatus] ?? 'Please specify one market, one SessionPath window, and whether you want a forecast or an explanation.'
      : `I will read the forecast, historical probabilities and available export code from SessionPath for this market and window${intent.date ? ` on ${intent.date}` : ''}.`;
  return {ok: true, ...intent, date: intent.date ?? null, message, interpreter};
}
