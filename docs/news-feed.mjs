import {extraNewsCategories, analyzeNews} from './news-analysis.mjs?v=fast-news-20261022';
// Public publisher feeds only. No account, proxy, article body, or stored credentials.
export const NEWS_SOURCES = Object.freeze([
  Object.freeze({id: 'financialjuice', name: 'FinancialJuice', paused:true, pauseReason:'Automatic requests paused while access is checked', pollMs: 60000, kind:'rss', hosts:['financialjuice.com','www.financialjuice.com'], url: 'https://www.financialjuice.com/feed.ashx?xy=rss'}),
  Object.freeze({id: 'wallstreetcn', name: 'WallstreetCN · 华尔街见闻', pollMs: 10000, kind:'json', hosts:['wallstreetcn.com','www.wallstreetcn.com','wallstcn.com','www.wallstcn.com'], url: 'https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=100'}),
  Object.freeze({id:'cnbc',name:'CNBC · Top news',pollMs:30000,kind:'rss',hosts:['cnbc.com','www.cnbc.com'],url:'https://www.cnbc.com/id/100003114/device/rss/rss.html'}),
  Object.freeze({id:'abcnews',name:'ABC News · World',pollMs:60000,kind:'rss',retentionMs:7*86400000,hosts:['abcnews.go.com','abcnews.com','www.abcnews.com'],url:'https://abcnews.com/abcnews/internationalheadlines'})
]);

const OIL = /\b(?:crude(?:\s+oil)?|wti|brent|opec\+?|petroleum|cushing|oilfield|oilfields)\b|(?:原油|石油|油價|油价|油田|油輪|油轮|油儲|油储|油庫|油库|庫欣|库欣|布倫特|布伦特|布蘭特|美油|布油)/iu;
const OIL_CONTEXT = /\boil\b.{0,45}\b(?:prices?|market|futures?|inventor\w*|supply|output|production|exports?|imports?|refiner\w*|barrels?|tanker\w*|pipeline\w*|demand|reserve\w*|drill\w*|wells?)\b|\boil\s+(?:rises?|rose|rall\w*|gains?|climbs?|falls?|fell|drops?|declin\w*|slips?|surges?|slumps?|settles?)\b|\b(?:prices?|futures?|barrels?|inventor\w*|supply|exports?|imports?|tanker\w*|pipeline\w*|demand|reserve\w*)\b.{0,30}\boil\b|\b(?:eia|api)\b.{0,35}\b(?:inventor\w*|barrels?|draw|build)\b/iu;
const NON_PETROLEUM_OIL = /\b(?:olive|cooking|edible|vegetable|palm|soybean|canola|essential)\s+oil\b|\boil\s+paint\w*\b/iu;
const GEO_DIRECT = /\b(?:geopolitic\w*|cold\s+war|(?:regional|military|border)\s+tensions?|ceasefire|airstrikes?|invasion|ballistic\s+missiles?|nuclear\s+(?:talks|deal|threat)|armed\s+conflict)\b|(?:地緣政治|地缘政治|冷戰|冷战|緊張局勢|紧张局势|停火|空襲|空袭|入侵|導彈|导弹|飛彈|飞弹|核談判|核谈判|武裝衝突|武装冲突)/iu;
const GEO_PLACE = /\b(?:iran|israel|russia|ukraine|lebanon|gaza|yemen|syria|taiwan|china|beijing|moscow|kremlin|tehran|houthi\w*|hamas|hezbollah|hormuz|red\s+sea|middle\s+east|north\s+korea|south\s+china\s+sea|pakistan|india|nato)\b|(?:伊朗|以色列|俄羅斯|俄罗斯|烏克蘭|乌克兰|黎巴嫩|加沙|葉門|也门|敘利亞|叙利亚|台灣|台湾|中國|中国|北京|莫斯科|德黑蘭|德黑兰|胡塞|哈馬斯|哈马斯|真主黨|真主党|霍爾木茲|霍尔木兹|紅海|红海|中東|中东|朝鮮|朝鲜|南海|巴基斯坦|印度|北約|北约)/iu;
const GEO_ACTION = /\b(?:war|wartime|prewar|pre-war|attack\w*|missiles?|bomb\w*|strikes?|military|troops?|naval|navy|nuclear|tension\w*|sanction\w*|conflict\w*|blockad\w*|escalat\w*|de-escalat\w*|hostil\w*|peace|disrupt\w*|drones?|weapons?|defen[cs]e|border)\b|(?:戰爭|战争|戰前|战前|戰後|战后|襲擊|袭击|遇襲|遇袭|攻擊|攻击|轟炸|轰炸|軍事|军事|軍隊|军队|駐軍|驻军|海軍|海军|核武|緊張|紧张|制裁|衝突|冲突|封鎖|封锁|升級|升级|和平|中斷|中断|無人機|无人机|武器|國防|国防|邊境|边境)/iu;

export function classifyNews(text) {
  const value = String(text || '').normalize('NFKC');
  const categories = [];
  if (OIL.test(value) || !NON_PETROLEUM_OIL.test(value) && OIL_CONTEXT.test(value)) categories.push('oil');
  if (GEO_DIRECT.test(value) || GEO_PLACE.test(value) && GEO_ACTION.test(value)) categories.push('geopolitics');
  return [...new Set([...categories, ...extraNewsCategories(value)])];
}

function decodeEntities(text) {
  return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/giu, entity => {
    const named = {'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' '};
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const code = /^&#x/i.test(entity) ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  });
}

// The result is text, never markup. The UI must also render it using textContent.
export function cleanNewsText(text) {
  return decodeEntities(String(text || '')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, '')
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<\s*br\s*\/?\s*>|<\/\s*(?:p|div|li)\s*>/giu, '\n')
    .replace(/<[^>]*>/gu, ' '))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/[\t \u00a0]+/gu, ' ').replace(/\s*\n\s*/gu, '\n').trim();
}

export function safeNewsURL(value, source) {
  try {
    const url = new URL(String(value || ''));
    const hosts = NEWS_SOURCES.find(item => item.id === source)?.hosts || [];
    const discord = source === 'financialjuice' && url.hostname === 'discord.com' && /^\/channels\/\d{17,20}\/\d{17,20}\/\d{17,20}$/.test(url.pathname) && !url.search && (!url.hash || /^#headline-\d{1,2}$/.test(url.hash));
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.includes(url.hostname.toLowerCase()) && !discord) return null;
    return url.href;
  } catch { return null; }
}

export function newsURLKey(value,source) {
  const safe=safeNewsURL(value,source);if(!safe)return null;
  const url=new URL(safe);url.search='';
  // A FinancialJuice Discord post may contain several different headlines.
  if(!(source==='financialjuice' && url.hostname==='discord.com'))url.hash='';
  return url.href.replace('://www.','://');
}

export function normalizeNewsDate(value, now = Date.now()) {
  let stamp;
  if (typeof value === 'number' || /^\d{10,13}$/.test(String(value || ''))) {
    stamp = Number(value); if (stamp < 1e12) stamp *= 1000;
  } else stamp = Date.parse(String(value || ''));
  if (!Number.isFinite(stamp) || stamp < Date.UTC(2000, 0, 1) || stamp > now + 5 * 60000) return null;
  return new Date(stamp).toISOString();
}

function firstHeadline(text) {
  const first = cleanNewsText(text).split(/\n|(?<=[。！？!?])\s*|(?<=\.)\s+(?=[A-Z])/u).find(Boolean) || '';
  return first.length > 180 ? `${first.slice(0, 179).trimEnd()}…` : first;
}

export function normalizeRSSRecords(records, {now = Date.now(), source = 'financialjuice'} = {}) {
  if (!NEWS_SOURCES.some(entry => entry.id === source && entry.kind === 'rss')) throw Error('Unknown RSS source.');
  return records.flatMap(record => {
    const title = cleanNewsText(record.title).replace(/^FinancialJuice\s*:\s*/iu, '').replace(/\s+/gu, ' ').trim() || firstHeadline(record.description);
    const url = safeNewsURL(record.link, source);
    const publishedAt = normalizeNewsDate(record.pubDate, now);
    const categories = classifyNews(title);
    if (!title || !url || !publishedAt || !categories.length || source === 'abcnews' && (!cleanNewsText(record.title) || Date.parse(publishedAt) < now - 7*86400000)) return [];
    return [{id: `${source}:${record.guid || url}`, source, title, url, publishedAt, categories, raw_text:title, receivedAt:new Date(now).toISOString(), analysis:analyzeNews({title,categories,publishedAt,url,source},{now})}];
  });
}
export const normalizeFinancialJuiceRecords = (records, options={}) => normalizeRSSRecords(records, {...options,source:'financialjuice'});
export function parseNewsRSS(xml, {now = Date.now(), parseXML, source = 'financialjuice'} = {}) {
  if (typeof xml !== 'string' || !xml.trim()) throw Error('The publisher returned an empty feed.');
  const parser = parseXML || (typeof DOMParser !== 'undefined' ? value => new DOMParser().parseFromString(value, 'application/xml') : null);
  if (!parser) throw Error('This browser cannot read the publisher’s RSS feed.');
  const doc = parser(xml);
  if (!doc || doc.querySelector('parsererror') || !doc.querySelector('rss, feed')) throw Error('The publisher returned an unreadable RSS feed.');
  const records = Array.from(doc.querySelectorAll('item')).map(item => Object.fromEntries(['title', 'link', 'pubDate', 'guid', 'description'].map(key => [key, item.querySelector(key)?.textContent || ''])));
  return normalizeRSSRecords(records, {now,source});
}
export const parseFinancialJuiceXML = (xml, options={}) => parseNewsRSS(xml,{...options,source:'financialjuice'});

export function normalizeWallstreetCN(payload, {now = Date.now()} = {}) {
  if (payload?.code !== 20000 || !Array.isArray(payload?.data?.items)) throw Error('The publisher returned an unreadable headline feed.');
  return payload.data.items.flatMap(record => {
    if (!record || record.is_priced === true || record.is_priced === 1) return [];
    const content = cleanNewsText(record.content_text || '');
    const title = cleanNewsText(record.title).replace(/\s+/gu, ' ').trim() || firstHeadline(content);
    const fallbackURL = /^\d+$/.test(String(record.id || '')) ? `https://wallstreetcn.com/livenews/${record.id}` : '';
    const url = safeNewsURL(record.uri || fallbackURL, 'wallstreetcn');
    const publishedAt = normalizeNewsDate(record.display_time, now);
    const categories = classifyNews(title);
    if (!title || !url || !publishedAt || !categories.length) return [];
    return [{id: `wallstreetcn:${record.id || url}`, source: 'wallstreetcn', title, url, publishedAt, categories, raw_text: title, receivedAt: new Date(now).toISOString(), analysis: analyzeNews({title, categories, publishedAt, url, source: 'wallstreetcn'}, {now})}];
  });
}

export function dedupeNews(items) {
  const ids = new Set(), urls = new Set(), titles = new Set();
  return [...items].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).filter(item => {
    const urlKey = newsURLKey(item.url,item.source);
    const titleKey = item.title.toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
    if (ids.has(item.id) || urls.has(urlKey) || titles.has(titleKey)) return false;
    ids.add(item.id); urls.add(urlKey); titles.add(titleKey); return true;
  });
}

export function filterNews(items, {topic = 'all', source = 'all', search = ''} = {}) {
  const query = String(search).trim().toLocaleLowerCase();
  return items.filter(item => item.categories?.length && (topic === 'all' || item.categories.includes(topic)) && (source === 'all' || item.source === source) && (!query || item.title.toLocaleLowerCase().includes(query)));
}

export function formatNewsTime(date) {
  const stamp = Date.parse(date);
  if (!Number.isFinite(stamp)) return 'Time unavailable';
  return `${new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false}).format(stamp)} ET`;
}

function abortError(message = 'Request cancelled.') { const error = new Error(message); error.name = 'AbortError'; return error; }

export async function loadNewsSource(source, {signal, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000, parseXML} = {}) {
  if (!NEWS_SOURCES.some(entry => entry.id === source?.id && entry.url === source?.url)) throw Error('Unknown news source.');
  let retryAfterMs = null;
  const controller = new AbortController();
  let timer, rejectStopped;
  const stopped = new Promise((_, reject) => { rejectStopped = reject; });
  const cancel = () => { controller.abort(); rejectStopped(abortError()); };
  const startedAt = new Date(now()).toISOString();
  if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, {once: true});
  timer = setTimeout(() => { controller.abort(); rejectStopped(abortError('The publisher did not respond in time.')); }, timeoutMs);
  try {
    const read = async () => {
      const response = await fetchImpl(source.url, {signal: controller.signal, credentials: 'omit', mode: 'cors', cache: 'no-store', referrerPolicy: 'no-referrer', headers: {Accept: source.kind === 'rss' ? 'application/rss+xml, application/xml, text/xml' : 'application/json'}});
      if (!response.ok) {
        if ([429,503].includes(response.status)) { const retry = response.headers?.get?.('retry-after'); if (retry) { const milliseconds = /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry)*1000 : Date.parse(retry)-now(); if (Number.isFinite(milliseconds) && milliseconds>0) retryAfterMs=Math.min(milliseconds,3600000); } }
        throw Error(`The publisher returned HTTP ${response.status}.`);
      }
      const text = await response.text();
      if (text.length > 2 * 1024 * 1024) throw Error('The publisher’s feed is unexpectedly large.');
      if (controller.signal.aborted) throw abortError();
      if (source.kind === 'rss') return parseNewsRSS(text, {now: now(), parseXML, source:source.id});
      let json; try { json = JSON.parse(text); } catch { throw Error('The publisher returned invalid JSON.'); }
      return normalizeWallstreetCN(json, {now: now()});
    };
    const items = await Promise.race([stopped, read()]);
    const latestAt = items.reduce((latest, item) => !latest || item.publishedAt > latest ? item.publishedAt : latest, null);
    return {items, source: {id: source.id, name: source.name, status: 'ok', fetchedAt: new Date(now()).toISOString(), latestAt}};
  } catch (error) {
    return {items: [], source: {id: source.id, name: source.name, status: 'error', fetchedAt: startedAt, latestAt: null, retryAfterMs, error: signal?.aborted ? 'Request cancelled.' : error?.name === 'AbortError' ? (error.message === 'The publisher did not respond in time.' ? error.message : 'The publisher did not respond in time.') : error?.message || 'This publisher could not be reached.'}};
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}

export async function loadNews({signal, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000, parseXML, sources = NEWS_SOURCES} = {}) {
  const results = await Promise.all(sources.map(source => loadNewsSource(source, {signal, fetchImpl, now, timeoutMs, parseXML})));
  return {items: dedupeNews(results.flatMap(result => result.items)), sources: results.map(result => result.source), fetchedAt: new Date(now()).toISOString()};
}

