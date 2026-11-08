// Visual proposals are a separate evidence channel. They never become formal
// shapeTags, archive results or inputs to a Session Path Code.
export const CHART_VISUAL_CONTRACT_VERSION = 'sessionpath.chart.visual.v1';
export const CHART_VISUAL_SESSIONS = Object.freeze(['NTA', 'ASIA', 'LONDON', 'NY']);
export const CHART_VISUAL_TAG_CODES = Object.freeze(['DOWN_FINISH', 'DOWN_THEN_BOUNCE', 'DROP_RECOVERY', 'UP_FINISH', 'UP_THEN_PULLBACK', 'RALLY_FADE', 'NARROW', 'ORDER_UNRESOLVED']);
export const CHART_VISUAL_CONFIDENCES = Object.freeze(['clear', 'tentative', 'unclassified']);
export const CHART_VISUAL_STATUSES = Object.freeze(['candidate', 'unclassified', 'in_progress']);
export const CHART_VISUAL_TEXT_LIMITS = Object.freeze({evidence: 400, uncertainty: 300});
const RESPONSE_KEYS = Object.freeze(['session', 'tag', 'confidence', 'evidence', 'uncertainty', 'complete', 'source', 'status']);

// Keep the browser validator self-contained and independent of server modules.
export function chartVisualPlainText(value, limit) {
  if (typeof value !== 'string' || value.length > limit) return false;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]|```|<[^>]*>|https?:\/\/|javascript:|data:|sk-or-|\bSP[1-9]\|/iu.test(value)) return false;
  if (/\b\d+(?:\.\d+)?\s*(?:%|percent|per\s+cent)\s*(?:chance|probability|odds|likely|certainty)\b|\b(?:probability|chance|odds|win[- ]?rate)\s*(?:(?:is|of|at|:|=|about|around)\s*){0,2}\d+(?:\.\d+)?\s*(?:%|percent|per\s+cent)|(?:概率|機率|几率|勝率|胜率)[^\d]{0,10}\d+(?:\.\d+)?\s*[%％]/iu.test(value)) return false;
  if (/\b(?:buy|sell|stop[- ]?loss|take[- ]?profit|entry\s+price|price\s+target)\b|\b(?:enter|exit)\s+(?:a|the|your|this|long|short|trade|position)\b|\b(?:go|stay|open|add)\s+(?:long|short)\b|買入|买入|賣出|卖出|做多|做空|止損|止损|止盈|進場|进场|出場|出场/iu.test(value)) return false;
  return true;
}

export function validateVisualTags(rows) {
  return Array.isArray(rows) && rows.length === CHART_VISUAL_SESSIONS.length && rows.every((row, index) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)
      || Object.keys(row).length !== RESPONSE_KEYS.length || !RESPONSE_KEYS.every(key => Object.hasOwn(row, key))
      || row.session !== CHART_VISUAL_SESSIONS[index] || !(row.tag === null || CHART_VISUAL_TAG_CODES.includes(row.tag))
      || !CHART_VISUAL_CONFIDENCES.includes(row.confidence) || !CHART_VISUAL_STATUSES.includes(row.status)
      || typeof row.complete !== 'boolean' || row.source !== 'visual'
      || !chartVisualPlainText(row.evidence, CHART_VISUAL_TEXT_LIMITS.evidence)
      || !chartVisualPlainText(row.uncertainty, CHART_VISUAL_TEXT_LIMITS.uncertainty)) return false;
    if (row.status === 'candidate') return row.complete && row.tag !== null && row.confidence !== 'unclassified' && Boolean(row.evidence.trim());
    return row.tag === null && row.confidence === 'unclassified' && (row.status !== 'in_progress' || row.complete === false);
  });
}
