const MINUTE = 60_000;
const HOLD = 24 * 60 * MINUTE;
const LIVE = 'https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=100';
const RSS = 'https://feed.wallstreetcn.com/wallstreetcn/news/global';
const linkHosts = new Set(['wallstreetcn.com','www.wallstreetcn.com','wallstcn.com','www.wallstcn.com']);
const htmlEscapes = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};

function text(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu,'$1').replace(/<[^>]*>/gu,' ')
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gu, (_,name)=>htmlEscapes[name])
    .replace(/[\u0000-\u001f\u007f]/gu,' ').replace(/\s+/gu,' ').trim();
}
function tag(item,name) {
  return new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','iu').exec(item)?.[1] || '';
}

function record({id,title,uri,display_time}, now) {
  const timestamp = typeof display_time === 'number' || /^\d{10,13}$/u.test(display_time || '')
    ? Number(display_time)*(Number(display_time)<1e12?1000:1) : Date.parse(display_time);
  if (!title || !Number.isFinite(timestamp) || timestamp < now-HOLD || timestamp > now+MINUTE) return null;
  try {
    const url = new URL(uri);
    if (url.protocol==='http:' && linkHosts.has(url.hostname)) url.protocol='https:';
    if (url.protocol!=='https:' || !linkHosts.has(url.hostname) || url.username || url.password || url.port ||
        !/^\/(?:livenews|articles)\/\d+\/?$/u.test(url.pathname)) return null;
    url.search = '';
    url.hash = '';
    return {id,title:title.slice(0,260),uri:url.href,display_time:Math.trunc(timestamp/1000)};
  } catch { return null; }
}

export function parseLive(body, now) {
  const parsed = JSON.parse(body);
  if (parsed?.code!==20000 || !Array.isArray(parsed.data?.items)) throw Error('Invalid live feed');
  return parsed.data.items.slice(0,140).flatMap(item => {
    if (!item || [true,1,'1'].includes(item.is_priced)) return [];
    const title = text(item.title) || text(item.content_text).split(/(?<=[。！？!?])\s*/u)[0];
    const uri = item.uri || (/^\d+$/u.test(item.id) ? 'https://wallstreetcn.com/livenews/'+item.id : '');
    return record({id:item.id,title,uri,display_time:item.display_time}, now) ?? [];
  });
}

export function parseRSS(body,now) {
  if (!/<rss(?:\s|>)/iu.test(body)) throw Error('Invalid RSS feed');
  return [...body.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/giu)].slice(0,140).flatMap(([,item]) => {
    const uri=text(tag(item,'link'));
    return record({id:'rss:'+uri,title:text(tag(item,'title')),uri,display_time:text(tag(item,'pubDate'))},now) ?? [];
  });
}

function retryAfter(value, now) {
  if (!value) return 0;
  const delay = /^\d+$/u.test(value) ? +value*1000 : Date.parse(value)-now;
  return Number.isFinite(delay) && delay > 0 ? delay : 0;
}

async function collect({url,accept,parse}, previous, now, fetcher, readBody) {
  const headers = {Accept:accept};
  if (previous?.etag) headers['If-None-Match'] = previous.etag;
  if (previous?.modified) headers['If-Modified-Since'] = previous.modified;
  let error, wait = 0;
  try {
    const response = await fetcher(url,{headers,signal:AbortSignal.timeout(3500)});
    if (response.status === 304 && previous?.checkedAt) return {...previous,nextAt:now+MINUTE,checkedAt:now,failures:0,error:null};
    if (!response.ok) {
      error = 'HTTP '+response.status;
      wait = Math.max(retryAfter(response.headers.get('Retry-After'),now),[401,403,429].includes(response.status) ? 15*MINUTE : 0);
      await response.body?.cancel();
    } else {
      return {items:parse(await readBody(response),now),nextAt:now+MINUTE,checkedAt:now,failures:0,error:null,
        etag:response.headers.get('ETag'),modified:response.headers.get('Last-Modified')};
    }
  } catch (failure) {
    error = failure.name==='TimeoutError' || failure.name==='AbortError' ? 'Request timed out' :
      failure instanceof SyntaxError || /^Invalid /u.test(failure.message) ? 'Unreadable publisher response' : 'Connection failed';
  }
  const failures = (previous?.failures || 0)+1;
  const delay = Math.max(wait,Math.min(10*MINUTE,MINUTE*2**Math.min(4,failures-1)));
  return {...previous,failures,error,nextAt:now+delay};
}

const liveSource = {url:LIVE,accept:'application/json',parse:parseLive};
const rssSource = {url:RSS,accept:'application/rss+xml, application/xml, text/xml',parse:parseRSS};

export async function collectWallstreet(previous, {now,fetcher=fetch,readBody}) {
  let {live,rss} = previous;
  const previousLive=live, previousRSS=rss;
  if (!live || live.nextAt<=now+5000) live = await collect(liveSource,live,now,fetcher,readBody);
  if (live.error && (!rss || rss.nextAt<=now+5000)) rss = await collect(rssSource,rss,now,fetcher,readBody);
  if (live===previousLive && rss===previousRSS) return previous;
  const items = new Map();
  for (const item of [...(previous.items || []),...(rss?.items || []),...(live.items || [])]) {
    if (item.display_time*1000>=now-HOLD) items.set(item.uri,item);
  }
  return {live,rss,items:[...items.values()].sort((a,b)=>b.display_time-a.display_time).slice(0,140)};
}

export function wallstreetRead(state, now) {
  const current = source => Boolean(source?.checkedAt && !source.error && now-source.checkedAt<5*MINUTE);
  const mode = current(state.live) ? 'live' : current(state.rss) ? 'rss' : 'offline';
  const checked = Math.max(state.live?.checkedAt || 0,state.rss?.checkedAt || 0);
  return {code:20000,mode,checkedAt:checked ? new Date(checked).toISOString() : null,
    upstream:{live:state.live?.error ?? null,rss:state.rss?.error ?? null},
    data:{items:(state.items || []).filter(item=>item.display_time*1000>=now-HOLD)}};
}
