import {safeNewsURL, NEWS_SOURCES} from './news-feed.mjs?v=juice-paused-20261022';

export const NEWS_ALERT_MAX_AGE_MS = 10 * 60_000;
export const NEWS_ALERT_MAX_SEEN = 600;

const VERSION = 1;
const SOURCE_IDS = NEWS_SOURCES.map(source => source.id);
const FUTURE_ALLOWANCE_MS = 5 * 60_000;

function dateValue(value, now) {
  if (typeof value !== 'string') return null;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) && stamp >= Date.UTC(2000, 0, 1) && stamp <= now + FUTURE_ALLOWANCE_MS ? new Date(stamp).toISOString() : null;
}

function laterDate(a, b) { return !a ? b : !b ? a : a > b ? a : b; }
function sourceID(value) { return SOURCE_IDS.includes(value) ? value : null; }
function titleKey(value) { return typeof value === 'string' ? value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim().slice(0, 400) : ''; }
function urlKey(value, source) {
  const safe = safeNewsURL(value, source);
  if (!safe || safe.length > 2000) return null;
  const url = new URL(safe); url.search = ''; url.hash = '';
  return url.href.replace('://www.', '://');
}

function validSeenEntry(value, now) {
  if (!value || typeof value !== 'object' || !sourceID(value.source) || typeof value.id !== 'string' || !value.id.trim() || value.id.length > 600) return null;
  const publishedAt = dateValue(value.publishedAt, now);
  const url = urlKey(value.url, value.source);
  const title = titleKey(value.titleKey);
  if (!publishedAt || !url || !title || value.source === 'abcnews' && Date.parse(publishedAt) < now - 7*86400000) return null;
  return {id: value.id.trim(), source: value.source, publishedAt, url, titleKey: title, priority: ['P1','P2','P3'].includes(value.priority) ? value.priority : null, version: Math.max(1, Math.min(999, Number(value.version) || 1)), history: (Array.isArray(value.history) ? value.history : []).filter(v => typeof v === 'string').slice(-5).map(v => v.slice(0,400))};
}

function seenForItem(item, now) {
  if (!item || !Array.isArray(item.categories) || !item.categories.some(category => ['oil', 'geopolitics', 'indices', 'trump'].includes(category))) return null;
  return validSeenEntry({...item, titleKey: item.title, priority: item.analysis?.priority}, now);
}

function readSaved(saved) {
  try {
    const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
    return parsed?.version === VERSION && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

/** Restore persisted deduplication data while starting a silent page-session baseline.
 * Use resume:true to preserve a known baseline across page loads. Explicitly re-enabling alerts may rebase.
 */
export function createNewsAlertState(saved = null, {now = Date.now(), resume = false} = {}) {
  const previous = readSaved(saved);
  const seen = (Array.isArray(previous.seen) ? previous.seen.slice(-NEWS_ALERT_MAX_SEEN) : []).map(entry => validSeenEntry(entry, now)).filter(Boolean);
  const sources = Object.fromEntries(SOURCE_IDS.map(id => [id, {
    initialized: resume && !!dateValue(previous.sources?.[id]?.lastObservedAt, now),
    watermark: dateValue(previous.sources?.[id]?.watermark, now),
    lastObservedAt: dateValue(previous.sources?.[id]?.lastObservedAt, now)
  }]));
  const watermark = Object.values(sources).reduce((value, source) => laterDate(value, source.watermark), dateValue(previous.watermark, now));
  return {version: VERSION, watermark, seen, sources};
}

/** Return a JSON-serializable, bounded snapshot; runtime baseline flags stay local. */
export function serializeNewsAlertState(state, {now = Date.now()} = {}) {
  const cleaned = createNewsAlertState(state, {now});
  return {
    version: VERSION,
    watermark: cleaned.watermark,
    seen: cleaned.seen,
    sources: Object.fromEntries(SOURCE_IDS.map(id => [id, {
      watermark: cleaned.sources[id].watermark,
      lastObservedAt: cleaned.sources[id].lastObservedAt
    }]))
  };
}

/** Process the raw loadNews() result before adding retained rows or UI filters.
 * All received relevant items are marked seen. Apply filterNews(newItems, filters)
 * only to the returned newItems, so changing filters never replays old alerts.
 * Same-second new IDs remain eligible; older-than-watermark and >10-minute-old
 * recovery headlines stay silent. No DOM, audio, storage, or input mutation.
 */
export function collectNewsAlerts(state, feed, {now = Date.now(), maxAgeMs = NEWS_ALERT_MAX_AGE_MS, includeContext = false} = {}) {
  const next = createNewsAlertState(state, {now});
  for (const id of SOURCE_IDS) next.sources[id].initialized = state?.version === VERSION && state?.sources?.[id]?.initialized === true;
  const age = Number.isFinite(maxAgeMs) && maxAgeMs > 0 ? maxAgeMs : NEWS_ALERT_MAX_AGE_MS;
  const entries = new Map(next.seen.map(entry => [`${entry.source}\n${entry.id}`, entry]));
  const ids = new Set(next.seen.map(entry => `${entry.source}\n${entry.id}`));
  const urls = new Set(next.seen.map(entry => entry.url));
  const titles = new Set(next.seen.map(entry => entry.titleKey));
  const newItems = [];
  const items = (Array.isArray(feed?.items) ? feed.items : []).map(raw => { const item = raw?.analysis ? {...raw, analysis: {...raw.analysis}} : raw; return {item, entry: seenForItem(item, now)}; }).filter(value => value.entry).sort((a, b) => a.entry.publishedAt.localeCompare(b.entry.publishedAt));

  for (const id of SOURCE_IDS) {
    const report = Array.isArray(feed?.sources) ? feed.sources.find(source => source?.id === id) : null;
    if (report?.status !== 'ok') continue;
    const source = next.sources[id];
    const checkedAt = dateValue(report.fetchedAt, now) || dateValue(feed?.fetchedAt, now) || new Date(now).toISOString();
    // A delayed response must not roll back a newer completed observation.
    if (source.lastObservedAt && checkedAt < source.lastObservedAt) continue;
    const baseline = !source.initialized;
    const previousWatermark = source.watermark;
    let watermark = laterDate(source.watermark, dateValue(report.latestAt, now));

    for (const {item, entry} of items) {
      if (entry.source !== id) continue;
      const key = `${entry.source}\n${entry.id}`;
      const previous = entries.get(key) || [...entries.values()].find(v => v.url === entry.url);
      const revised = previous && previous.titleKey !== entry.titleKey && !previous.history.includes(entry.titleKey);
      const known = !revised && (ids.has(key) || urls.has(entry.url) || titles.has(entry.titleKey));
      entry.version = revised ? previous.version + 1 : previous?.version || 1;
      entry.history = revised ? [...previous.history, previous.titleKey].slice(-5) : previous?.history || [];
      if (revised && item.analysis?.is_correction && previous.priority === 'P1') { item.analysis.priority = 'P1'; entry.priority = 'P1'; }
      if (item.analysis) { item.analysis.event_version = entry.version; item.analysis.previous_headlines = entry.history; item.analysis.novelty = revised ? 'Updated headline' : known ? 'Already seen' : 'New headline'; }
      const stamp = Date.parse(entry.publishedAt);
      if (!baseline && !known && (revised || !previousWatermark || entry.publishedAt >= previousWatermark) && (stamp >= now - age || revised && item.analysis?.is_correction) && (includeContext || !item.analysis || ['P1','P2'].includes(item.analysis.priority))) newItems.push(item);
      ids.add(key); urls.add(entry.url); titles.add(entry.titleKey);
      entries.delete(key); entries.set(key, entry);
      watermark = laterDate(watermark, entry.publishedAt);
    }

    source.initialized = true;
    source.watermark = watermark;
    source.lastObservedAt = checkedAt;
    next.watermark = laterDate(next.watermark, watermark);
  }
  next.seen = [...entries.values()].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt)).slice(-NEWS_ALERT_MAX_SEEN);
  newItems.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return {state: next, newItems, items: items.map(value => value.item)};
}
