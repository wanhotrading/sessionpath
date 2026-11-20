import {DurableObject} from 'cloudflare:workers';
import {postId,verifyEvents} from './watch.mjs';

const HOUR=3600000;
const unbase64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
async function submit(request,env) {
  if (request.method!=='POST') return new Response(null,{status:405,headers:{Allow:'POST'}});
  const signature=request.headers.get('X-SessionPath-Signature')||'';
  if (!env.BOT_PUBLIC_KEY || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) return new Response(null,{status:401});
  const reader=request.body?.getReader();
  if (!reader) return new Response(null,{status:400});
  const buf=new Uint8Array(24000);let size=0;
  for (;;) {
    const {done,value}=await reader.read();if(done) break;
    if(size+value.length>buf.length){await reader.cancel();return new Response(null,{status:413});}
    buf.set(value,size);size+=value.length;
  }
  const bytes=buf.subarray(0,size), key=await crypto.subtle.importKey('spki',unbase64(env.BOT_PUBLIC_KEY),'Ed25519',false,['verify']);
  if (!await crypto.subtle.verify('Ed25519',key,unbase64(signature),bytes)) return new Response(null,{status:401});
  let scan;
  try {scan=JSON.parse(new TextDecoder().decode(bytes));} catch {return new Response(null,{status:400});}
  if (!Number.isSafeInteger(scan?.sentAt) || Math.abs(Date.now()-scan.sentAt)>5*60000 || !Array.isArray(scan.events) ||
     scan.events.length>5 || !Array.isArray(scan.citations) || scan.citations.length>20) return new Response(null,{status:422});
  const result=await env.NEWS.getByName('ticker').receive(scan);
  return Response.json(result,{status:result.error?503:200,headers:{'Cache-Control':'no-store'}});
}

export class NewsLedger extends DurableObject {
  async receive(scan) {
    const next=(this.pending||Promise.resolve()).then(()=>this.record(scan));
    this.pending=next.catch(()=>{});
    return next;
  }
  async record(scan) {
    const receipt=await this.ctx.storage.get('receipt');
    if (receipt && receipt.sentAt>=scan.sentAt) return receipt;
    const now=Date.now(), last=await this.ctx.storage.get('lastGood');
    const ledger=(await this.ctx.storage.get('ledger')||[]).filter(x=>Date.parse(x.publishedAt)>now-72*HOUR);
    const since=Math.max(now-6*HOUR, (last||now-HOUR)-10*60000);
    try {
      const cited=new Set(scan.citations.map(postId).filter(Boolean));
      const latest=await verifyEvents({events:scan.events,cited},ledger,since,now);
      const items=[...latest,...ledger].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,64);
      const receipt={sentAt:scan.sentAt,accepted:latest.length,heldOrDuplicate:scan.events.length-latest.length};
      await this.ctx.storage.put({ledger:items,latest,lastGood:now,lastAttempt:now,error:'',receipt});
      return receipt;
    } catch(e) {
      await this.ctx.storage.put({lastAttempt:now,error:'post_verification_unavailable'});
      return {error:'post_verification_unavailable'};
    }
  }
  async read(path) {
    const data=await this.ctx.storage.get(['lastGood','lastAttempt','error','ledger','latest']);
    const good=data.get('lastGood')||0;
    const status=!this.env.BOT_PUBLIC_KEY?'awaiting_bot':data.get('error')?'scan_error':!good?'awaiting_first_scan':
      Date.now()-good>2*HOUR?'stale':'ok';
    const health={status,lastSuccessfulScan:good?new Date(good).toISOString():null,intervalMinutes:60};
    if (path==='/health') return {body:{...health,reason:data.get('error')||null},code:200};
    if (path==='/latest') return {body:status==='ok'?(data.get('latest')||[]):health,code:status==='ok'?200:503};
    return {body:{...health,items:(data.get('ledger')||[]).filter(x=>Date.parse(x.publishedAt)>Date.now()-24*HOUR)},code:200};
  }
}
export default {
  async fetch(request,env) {
    const path=new URL(request.url).pathname;
    if(path==='/submit') return submit(request,env);
    if (!['/feed','/health','/latest'].includes(path)) return new Response(null,{status:404});
    if (request.method!=='GET') return new Response(null,{status:405,headers:{Allow:'GET'}});
    const {body,code}=await env.NEWS.getByName('ticker').read(path);
    return Response.json(body,{status:code,headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=20'}});
  }
};
