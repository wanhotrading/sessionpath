import {DurableObject} from 'cloudflare:workers';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const macroMarkets = ['NQ', 'ES', 'GC'];
const sources = [
  {id:'fed', url:'https://www.federalreserve.gov/feeds/press_monetary.xml', minutes:1, topic:'fed', markets:macroMarkets,
    match:/\b(?:FOMC|federal funds|monetary policy|discount rate)\b/iu,
    why:'The release can change expectations for US interest rates.'},
  {id:'bea', url:'https://apps.bea.gov/rss/rss.xml', minutes:1, topic:'macro', markets:macroMarkets,
    domains:['bea.gov', 'www.bea.gov', 'apps.bea.gov'],
    match:/gross domestic product|personal income and outlays|personal consumption expenditures/iu,
    why:'The release updates the US growth or inflation outlook.'},
  {id:'eia', url:'https://www.eia.gov/rss/press_rss.xml', minutes:2, topic:'oil', markets:['CL'],
    match:/\b(?:crude|oil|petroleum|opec|hormuz|refiner\w*)\b/iu,
    why:'The EIA release updates the outlook for oil supply, demand or inventories.'},
];

const entities = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' '};
function plain(text) {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu, (original, entity) => {
      const key = entity.toLowerCase();
      if (key[0] !== '#') return entities[key] ?? original;
      const n = key[1] === 'x' ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ';
    }).replace(/[<>\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function tag(xml, name) {
  return new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '\\s*>', 'iu').exec(xml)?.[1] || '';
}

export function parseReleases(xml, source, now) {
  if (!/<(?:rss|feed)(?:\s|>)/iu.test(xml)) throw Error('Invalid RSS or Atom feed');
  const records = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/giu)].slice(0, 80);
  return records.flatMap(([, , entry]) => {
    const headline = plain(tag(entry, 'title'));
    if (!source.match.test(headline)) return [];
    const stamp = plain(tag(entry, 'pubDate') || tag(entry, 'published') || tag(entry, 'dc:date'));
    if (!/(?:Z|GMT|UTC|EST|EDT|[+-]\d{2}:?\d{2})$/iu.test(stamp)) return [];
    const time = Date.parse(stamp);
    if (!Number.isFinite(time) || time < now - DAY || time > now + MINUTE) return [];
    const alternate = /<link\s+(?=[^>]*rel=["']alternate["'])[^>]*href=["']([^"']+)["']/iu.exec(entry)?.[1];
    let link;
    try { link = new URL(plain(tag(entry, 'link') || alternate || ''), source.url); }
    catch { return []; }
    const allowed = source.domains || [new URL(source.url).hostname];
    if (link.protocol === 'http:' && allowed.includes(link.hostname)) link.protocol = 'https:';
    if (link.protocol !== 'https:' || link.port || link.username || link.password || !allowed.includes(link.hostname) ||
        link.pathname === '/' || link.href === source.url) return [];
    link.hash = '';
    link.search = '';
    const key = link.pathname.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 85);
    if (!key) return [];
    const publishedAt = new Date(time).toISOString();
    return [{
      eventKey: source.id + '-' + publishedAt.slice(0, 10) + '-' + key, kind:'new', topic:source.topic,
      headline:headline.length <= 180 ? headline : headline.slice(0, 179).trimEnd() + '…',
      why:source.why, markets:source.markets, publishedAt, evidence:[link.href],
    }];
  });
}

async function boundedText(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > 1024 * 1024) throw Error('Oversized source feed');
      text += decoder.decode(value, {stream:true});
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function readSource(source, previous, now) {
  const fallback = {checkedAt:previous?.checkedAt || null, items:(previous?.items || []).filter(item => Date.parse(item.publishedAt) >= now - DAY)};
  const headers = {Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml'};
  if (previous?.etag) headers['If-None-Match'] = previous.etag;
  if (previous?.modified) headers['If-Modified-Since'] = previous.modified;
  try {
    const response = await fetch(source.url, {headers, signal:AbortSignal.timeout(8_000)});
    if (response.status === 304) return {...previous, ...fallback, checkedAt:now, nextAt:now + source.minutes*MINUTE, error:null};
    if (!response.ok) {
      const retry = response.headers.get('Retry-After');
      const wait = retry && /^\d+$/u.test(retry) ? Number(retry)*1000 : Date.parse(retry)-now;
      return {...previous, ...fallback, nextAt:now + Math.max(10*MINUTE, Number.isFinite(wait) ? wait : 0), error:'HTTP ' + response.status};
    }
    const merged = new Map(fallback.items.map(item => [item.eventKey, item]));
    for (const item of parseReleases(await boundedText(response), source, now)) {
      const previousItem = merged.get(item.eventKey);
      if (previousItem) item.kind = previousItem.headline === item.headline ? previousItem.kind : 'update';
      merged.set(item.eventKey, item);
    }
    return {checkedAt:now, items:[...merged.values()].sort((a,b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 30),
      nextAt:now + source.minutes*MINUTE, error:null, etag:response.headers.get('ETag'), modified:response.headers.get('Last-Modified')};
  } catch (error) {
    return {...previous, ...fallback, nextAt:now + 5*MINUTE, error:error.name === 'TimeoutError' ? 'Timed out' : 'Could not read feed'};
  }
}

export class OfficialNews extends DurableObject {
  scanInProgress;

  async scan() {
    this.scanInProgress ??= this.collect().finally(() => { this.scanInProgress = undefined; });
    await this.scanInProgress;
  }

  async collect() {
    const state = await this.ctx.storage.get('official-news') || {};
    const now = Date.now();
    const due = sources.filter(source => !state[source.id]?.nextAt || state[source.id].nextAt <= now + 5_000);
    const results = await Promise.all(due.map(source => readSource(source, state[source.id], now)));
    if (!results.length) return;
    for (const [i, source] of due.entries()) state[source.id] = results[i];
    await this.ctx.storage.put('official-news', state);
    console.log(JSON.stringify({message:'Official news scan', sources:due.map(source => ({id:source.id,error:state[source.id].error,items:state[source.id].items.length}))}));
  }

  async feed() {
    let state = await this.ctx.storage.get('official-news');
    if (!state) {
      await this.scan();
      state = await this.ctx.storage.get('official-news') || {};
    }
    const now = Date.now();
    const reports = sources.map(({id}) => ({id, checkedAt:state[id]?.checkedAt ? new Date(state[id].checkedAt).toISOString() : null, error:state[id]?.error ?? null}));
    const latest = Math.max(0, ...reports.map(({checkedAt}) => Date.parse(checkedAt) || 0));
    const items = sources.flatMap(({id}) => state[id]?.items || [])
      .filter(item => Date.parse(item.publishedAt) >= now - DAY).sort((a,b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 30);
    return {version:1, checkedAt:latest ? new Date(latest).toISOString() : null, items, sources:reports};
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const headers = {'Access-Control-Allow-Origin':'*', 'X-Content-Type-Options':'nosniff'};
    if (url.pathname !== '/api/news' || request.method !== 'GET') return new Response('Not found', {status:404, headers});
    url.search = '';
    const key = new Request(url.href);
    const cached = await caches.default.match(key);
    if (cached) return cached;
    const data = await env.NEWS.getByName('official-v1').feed();
    if (!data.checkedAt) return Response.json(data, {headers:{...headers,'Cache-Control':'no-store'},status:503});
    const response = Response.json(data, {headers:{...headers,'Cache-Control':'public, max-age=10'}});
    ctx.waitUntil(caches.default.put(key, response.clone()));
    return response;
  },
  async scheduled(_, env) {
    await env.NEWS.getByName('official-v1').scan();
  },
};


