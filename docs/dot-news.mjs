// The feed branch is writable only to authorized GitHub editors. Treat every
// field as data and render it as text. Corroboration is by source, not by URL count.
const officialDomains = new Map([
  ['eia.gov','EIA'], ['opec.org','OPEC'], ['ukmto.org','UKMTO'], ['centcom.mil','CENTCOM'],
  ['federalreserve.gov','Federal Reserve'], ['bls.gov','BLS'], ['bea.gov','BEA'], ['census.gov','Census'],
  ['treasury.gov','US Treasury'], ['ofac.treasury.gov','US Treasury'], ['ustr.gov','USTR'],
  ['whitehouse.gov','White House'], ['commerce.gov','US Commerce'], ['energy.gov','US Energy'],
]);
const newsDomains = new Map([
  ['reuters.com','Reuters'], ['apnews.com','AP'], ['afp.com','AFP'], ['bloomberg.com','Bloomberg'],
  ['cnbc.com','CNBC'], ['ft.com','Financial Times'], ['wsj.com','Wall Street Journal'],
]);
const officialAccounts = new Set(['eiagov','opecsecretariat','uk_mto','centcom','federalreserve','bls_gov','bea_news','censusbureau','ustreasury','ustraderep','whitehouse','potus','realdonaldtrump']);
const newsAccounts = new Map([['reuters','Reuters'],['reutersbiz','Reuters'],['ap','AP'],['afp','AFP'],['business','Bloomberg'],['cnbc','CNBC']]);
const marketNames = ['CL','NQ','ES','GC'];
const topics = ['oil','shipping','geopolitics','fed','macro','sanctions','policy'];
const hostnames = [...officialDomains.keys(), ...newsDomains.keys()];
const DAY=86400000;
export const dotSource = Object.freeze({
  id:'dot', name:'Dot · Breaking news', kind:'dot', pollMs:45000,
  hosts:['x.com', ...hostnames, ...hostnames.map(host=>'www.'+host)],
  url:'https://raw.githubusercontent.com/wanhotrading/sessionpath/dot-news/news/dot-feed.json',
});
function source(value) {
  if(typeof value!=='string'||value.length>600)return null;
  try{
    const url=new URL(value), host=url.hostname.replace(/^www\./,'');
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname==='/')return null;
    if(host==='x.com'){
      const handle=/^\/(\w{1,15})\/status\/\d{17,20}\/?$/u.exec(url.pathname)?.[1]?.toLowerCase();
      if(!handle)return null;
      const official=officialAccounts.has(handle), name=newsAccounts.get(handle);
      if(!official&&!name)return null;
      return {name:name||'@'+handle, official, url:'https://x.com'+url.pathname};
    }
    const authority=officialDomains.get(host), publisher=newsDomains.get(host);
    if(!authority&&!publisher)return null;
    url.hash='';
    return {name:authority||publisher,official:Boolean(authority),url:url.href};
  }catch{return null;}
}
const dated = value => typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)?Date.parse(value):NaN;
const clean = (value,max) => typeof value==='string'&&value.length<=max&&value.trim()&&!/[<>\u0000-\u001f]/u.test(value)?value.trim():null;

export function dotItems(payload, now, analyze) {
  if(payload?.version!==1||!Array.isArray(payload.items)||payload.items.length>30)throw Error('Unreadable Dot feed');
  if(payload.checkedAt===null&&payload.items.length===0)throw Error('Waiting for first Dot scan');
  const checked=dated(payload.checkedAt);
  if(!Number.isFinite(checked)||checked>now+5*60000)throw Error('Dot scan date is invalid');
  if(now-checked>2*3600000)throw Error('Dot scan overdue');
  return payload.items.flatMap(event=>{
    if(typeof event?.eventKey!=='string'||!/^[a-z0-9][a-z0-9-]{5,119}$/u.test(event.eventKey)||
       !topics.includes(event.topic)||!['new','update','correction'].includes(event.kind)||
       !Array.isArray(event.markets)||event.markets.length<1||event.markets.length>4||
       event.markets.some(m=>!marketNames.includes(m))||!Array.isArray(event.evidence)||event.evidence.length>4)return [];
    const title=clean(event.headline,180),why=clean(event.why,350),stamp=dated(event.publishedAt);
    if(!title||!why||!Number.isFinite(stamp)||stamp>Math.min(now,checked)+60000||stamp<now-DAY)return [];
    const proof=[...new Map(event.evidence.map(source).filter(Boolean).map(e=>[e.url,e])).values()];
    if(!proof.some(e=>e.official)&&new Set(proof.map(e=>e.name)).size<2)return [];
    const markets=[...new Set(event.markets)];
    const categories=new Set();
    if(markets.includes('CL')&&['oil','shipping','sanctions'].includes(event.topic))categories.add('oil');
    if(['shipping','sanctions','geopolitics'].includes(event.topic))categories.add('geopolitics');
    if(['fed','macro'].includes(event.topic))categories.add('rates');
    if(event.topic==='policy')categories.add('trump');
    if(markets.some(m=>['NQ','ES'].includes(m)))categories.add('indices');
    if(markets.includes('GC'))categories.add('gold');
    if(!categories.size)return [];
    const prefix=event.kind==='new'?'':event.kind==='update'?'Update · ':'Correction · ';
    const item={id:'dot:'+event.eventKey, source:'dot', title:prefix+title, raw_text:title, url:proof.find(e=>e.official)?.url||proof[0].url,
      publishedAt:new Date(stamp).toISOString(), receivedAt:new Date(checked).toISOString(),
      categories:[...categories],markets,sources:proof,eventKey:event.eventKey,kind:event.kind};
    item.analysis={...analyze(item,{now}),priority:'P1',event_type:markets.join(' · '),rationale:why,
      source_authenticity:proof.map(e=>e.name).join(', '), is_correction:event.kind==='correction'};
    return [item];
  });
}
