const official = {
  EIAgov:['oil'], OPECSecretariat:['oil'], UK_MTO:['shipping'], CENTCOM:['shipping','geopolitics'],
  federalreserve:['fed'], BLS_gov:['macro'], BEA_News:['macro'], CensusBureau:['macro'],
  USTreasury:['sanctions','policy'], USTradeRep:['policy'], WhiteHouse:['policy','sanctions'],
  POTUS:['policy','sanctions'], realDonaldTrump:['policy','sanctions'],
};
const press = {Reuters:'Reuters', ReutersBiz:'Reuters', AP:'AP', AFP:'AFP', business:'Bloomberg'};
export const handles = [...Object.keys(official), ...Object.keys(press)];
const topics = new Set(['oil','shipping','geopolitics','fed','macro','sanctions','policy']);
const smallText = (v,n) => typeof v === 'string' && v.trim().length <= n ? v.trim() : '';
const slug = v => /^[a-z0-9][a-z0-9-]{3,95}$/.test(v || '');
const norm = v => v.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const iso = ms => new Date(ms).toISOString();
export function postId(value) {
  try {
    const u = new URL(value);
    if (!['https://x.com','https://twitter.com','https://www.x.com','https://www.twitter.com'].includes(u.origin) || u.username || u.password) return null;
    return u.pathname.match(/^\/(?:[\w]{1,15}|i\/web)\/status\/(\d{17,20})\/?$/)?.[1] || null;
  } catch {return null;}
}
export function postTime(id) {return Number(BigInt(id) >> 22n) + 1288834974657;}
function sourceText(html) {
  return (html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#39;|&#x27;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ');
}
export async function readPost(id) {
  const u = 'https://publish.twitter.com/oembed?omit_script=true&url='+encodeURIComponent('https://twitter.com/i/status/'+id);
  const res = await fetch(u,{signal:AbortSignal.timeout(8000)});
  if (res.status===404 || res.status===410) return null;
  if (!res.ok) throw Error('post_verification_unavailable');
  const post=await res.json();
  let author;
  try {
    const u = new URL(post.author_url);
    if (!['https://twitter.com','https://x.com'].includes(u.origin)) return null;
    author = handles.find(h=>u.pathname.toLowerCase().replace(/\/$/,'')==='/'+h.toLowerCase());
  } catch {return null;}
  return author ? {author,text:sourceText(String(post.html||'')),url:'https://x.com/'+author+'/status/'+id,id,time:postTime(id)} : null;
}
export async function verifyEvents({events,cited},history,since,now,lookup=readPost) {
  const accepted=[],cache=new Map();
  for (const e of events.slice(0,5)) {
    if (!e || !slug(e.eventKey) || !topics.has(e.topic) || !['new','update','correction'].includes(e.kind)) continue;
    const prior=[...accepted,...history], existing=prior.find(x=>x.eventKey===e.eventKey);
    const headline=smallText(e.headline,190),why=smallText(e.why,280);
    const markets=[...new Set((Array.isArray(e.markets)?e.markets:[]).filter(s=>['CL','NQ','ES','GC'].includes(s)))];
    if (!headline || !why || !markets.length || (e.kind==='new')===Boolean(existing) || prior.some(x=>norm(x.headline)===norm(headline))) continue;
    const evidence=[];
    for (const ref of (Array.isArray(e.evidence)?e.evidence:[]).slice(0,3)) {
      const id=postId(ref?.url),quote=smallText(ref?.quote,250);
      if (!id || !cited.has(id) || ref.firstHand!==true || norm(quote).split(' ').length<5 || evidence.some(x=>x.id===id)) continue;
      const time=postTime(id);
      if (time>now || time<since) continue;
      if (!cache.has(id)) cache.set(id,await lookup(id));
      const post=cache.get(id);
      if (post && norm(post.text).includes(norm(quote))) evidence.push(post);
    }
    const own=evidence.filter(p=>official[p.author]?.includes(e.topic));
    const wires=evidence.filter(p=>press[p.author]);
    if (!own.length && new Set(wires.map(p=>press[p.author])).size<2) continue;
    const sources=[...own,...wires].sort((a,b)=>a.time-b.time);
    const previouslyUsed=new Set(prior.flatMap(x=>x.sources.map(s=>s.id)));
    const primary=sources[0];
    if (previouslyUsed.has(primary.id) || existing && Date.parse(existing.publishedAt)>=primary.time) continue;
    accepted.push({id:'grok:'+primary.id,eventKey:e.eventKey,kind:e.kind,topic:e.topic,headline,why,markets,
      publishedAt:iso(primary.time),verifiedAt:iso(now),url:primary.url,sources:sources.map(({id,url,author})=>({id,url,author}))});
  }
  return accepted;
}
