export const MARKETS = Object.freeze(['CL', 'NQ', 'ES', 'GC']);
export const WINDOWS = Object.freeze(['03:00-05:00', '05:00-08:30', '08:30-16:00']);
export const CONCEPTS = Object.freeze(['mean_box', 'containment', 'avr_expansion', 'extension']);
export const ACTIONS = Object.freeze(['forecast', 'explain', 'clarify']);

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

export function validateRequest(value) {
  if (!exactKeys(value, ['message', 'context'])) return null;
  if (typeof value.message !== 'string' || !value.message.trim() || value.message.length > 600
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value.message)) return null;
  if (!exactKeys(value.context, ['market', 'window']) || !MARKETS.includes(value.context.market)
    || !WINDOWS.includes(value.context.window)) return null;
  return {message: value.message.trim(), context: {...value.context}};
}

export function validateIntent(value) {
  if (!exactKeys(value, ['action', 'market', 'window', 'concept'])) return null;
  if (!ACTIONS.includes(value.action) || !MARKETS.includes(value.market) || !WINDOWS.includes(value.window)
    || !(value.concept === null || CONCEPTS.includes(value.concept))) return null;
  if (value.action === 'explain' && value.concept === null) return null;
  if (value.action !== 'explain' && value.concept !== null) return null;
  return {...value};
}

// This intentionally recognizes only a small, exact command grammar. Natural
// language, explanations and ambiguous requests go to the real AI interpreter.
export function parseExactForecast(message) {
  const text = message.normalize('NFKC').trim().toUpperCase().replace(/[–—→]/gu, '-');
  const match = /^(CL|NQ|ES|GC)[\s,:，：]+(03(?::?00)?\s*-\s*05(?::?00)?|05(?::?00)?\s*-\s*0?8:?30|0?8:?30\s*-\s*16(?::?00)?)(?:\s+(?:RANGE|FORECAST|CODE))?[.!。！]?$/u.exec(text);
  if (!match) return null;
  const compact = match[2].replace(/[\s:]/gu, '');
  let window;
  if (/^03(?:00)?-05(?:00)?$/u.test(compact)) window = WINDOWS[0];
  else if (/^05(?:00)?-0?830$/u.test(compact)) window = WINDOWS[1];
  else if (/^0?830-16(?:00)?$/u.test(compact)) window = WINDOWS[2];
  else return null;
  return {action: 'forecast', market: match[1], window, concept: null};
}

export const INTENT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    action: {type: 'string', enum: ACTIONS},
    market: {type: 'string', enum: MARKETS},
    window: {type: 'string', enum: WINDOWS},
    concept: {type: ['string', 'null'], enum: [null, ...CONCEPTS]},
  },
  required: ['action', 'market', 'window', 'concept'],
  additionalProperties: false,
});

// Model prose is never trusted or displayed. Only this bounded, local text is
// returned; prices, probabilities and export codes come from SessionPath itself.
export function renderIntent(intent, interpreter) {
  const explanations = {
    mean_box: 'The mean box summarizes historical upside and downside excursions for the selected conditions. Its edges are historical average distances, not guaranteed boundaries.',
    containment: 'Containment measures how often an entire historical path stayed inside the forecast box. It is different from a final close inside or a return after a breach.',
    avr_expansion: 'AVR expansion measures additional movement beyond the running high and low since the overnight start, normalized by the frozen AVR. Zero-expansion observations are included.',
    extension: 'Extension levels use the full SessionPath box width, measured from the opposite extreme. Historical hit rates depend on the selected breakout definition and observation window.',
  };
  const message = intent.action === 'explain' ? explanations[intent.concept]
    : intent.action === 'clarify' ? 'Please specify one market, one SessionPath window, and whether you want a forecast or an explanation.'
      : 'I will read the forecast, historical probabilities and available export code from SessionPath for this market and window.';
  return {ok: true, ...intent, message, interpreter};
}
