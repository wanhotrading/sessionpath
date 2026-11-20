export const grokSource=Object.freeze({id:'grok',name:'Grok · X watch',kind:'grok',
  pollMs:60000,hosts:['x.com'],url:'https://sessionpath-grok-news.jjj-jason2345.workers.dev/feed'});

const sourceState={needs_key:'Waiting for xAI key',awaiting_first_scan:'Waiting for first hourly scan',
  scan_error:'Last Grok scan failed',stale:'Grok scan overdue'};

export function grokItems(payload,now,analyze) {
  if (payload?.status!=='ok') throw Error(sourceState[payload?.status]||'Grok feed unavailable');
  if (!Array.isArray(payload.items)) throw Error('Unreadable Grok feed');
  return payload.items.flatMap(event=>{
    const sources=(event?.sources||[]).filter(s=>/^https:\/\/x\.com\/\w{1,15}\/status\/\d{17,20}$/.test(s?.url));
    if (!sources.length || !sources.some(s=>s.url===event.url) || !Array.isArray(event.markets) ||
        !Number.isFinite(Date.parse(event.publishedAt)) || !['new','update','correction'].includes(event.kind)) return [];
    const categories=new Set();
    if (event.topic==='oil' || event.markets.includes('CL') && event.topic==='shipping') categories.add('oil');
    if (['shipping','sanctions','geopolitics'].includes(event.topic)) categories.add('geopolitics');
    if (event.topic==='policy') categories.add('trump');
    if (['fed','macro'].includes(event.topic)) categories.add('rates');
    if (event.markets.some(m=>['ES','NQ'].includes(m))) categories.add('indices');
    if (event.markets.includes('GC')) categories.add('gold');
    const prefix=event.kind==='new'?'':event.kind==='update'?'Update · ':'Correction · ';
    const item={id:event.id,source:'grok',title:prefix+event.headline,raw_text:event.headline,
      url:event.url,publishedAt:event.publishedAt,receivedAt:event.verifiedAt,categories:[...categories],
      markets:event.markets,sources,eventKey:event.eventKey,kind:event.kind};
    const analysis=analyze(item,{now});
    item.analysis={...analysis,priority:'P1',event_type:event.markets.join(' · '),rationale:event.why,
      source_authenticity:sources.map(s=>'@'+s.author).join(', '),is_correction:event.kind==='correction'};
    return [item];
  });
}
