import {DurableObject} from 'cloudflare:workers';
import {searchGrok,verifyEvents} from './watch.mjs';

const HOUR=3600000;
const safeError=e=>/^(?:xai_http_\d{3}|search_unconfirmed|post_verification_unavailable|invalid_search_result)$/.test(e?.message)?e.message:'scan_failed';

export class NewsLedger extends DurableObject {
  async scan(scheduledTime) {
    if (!this.env.XAI_API_KEY) return;
    const slot=Math.floor(scheduledTime/HOUR);
    const claimed=await this.ctx.storage.transaction(async tx=>{
      const previous=await tx.get('slot');
      if (previous!==undefined && slot<=previous) return false;
      await tx.put('slot',slot);
      return true;
    });
    if (!claimed) return;
    const now=Date.now(), last=await this.ctx.storage.get('lastGood');
    const ledger=(await this.ctx.storage.get('ledger')||[]).filter(x=>Date.parse(x.publishedAt)>now-72*HOUR);
    const since=Math.max(now-6*HOUR, (last||now-HOUR)-10*60000);
    try {
      const search=await searchGrok(this.env.XAI_API_KEY,since,now,ledger);
      const latest=await verifyEvents(search,ledger,since,now);
      const items=[...latest,...ledger].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,64);
      await this.ctx.storage.put({ledger:items,latest,lastGood:now,lastAttempt:now,error:''});
    } catch(e) {
      await this.ctx.storage.put({lastAttempt:now,error:safeError(e)});
    }
  }
  async read(path) {
    const data=await this.ctx.storage.get(['lastGood','lastAttempt','error','ledger','latest']);
    const good=data.get('lastGood')||0;
    const status=!this.env.XAI_API_KEY?'needs_key':data.get('error')?'scan_error':!good?'awaiting_first_scan':
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
    if (!['/feed','/health','/latest'].includes(path)) return new Response(null,{status:404});
    if (request.method!=='GET') return new Response(null,{status:405,headers:{Allow:'GET'}});
    const {body,code}=await env.NEWS.getByName('ticker').read(path);
    return Response.json(body,{status:code,headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=20'}});
  },
  scheduled(event,env,ctx) { ctx.waitUntil(env.NEWS.getByName('ticker').scan(event.scheduledTime)); }
};
