// Public delayed-data API only. The separately coordinated personal TradingView
// service owns private transport; this Worker has no keys or Durable Objects.
import {createContextHandler} from '../full-context/lib/context-handler.mjs';
import {gcAutofillConvention} from '../full-context/worker/gc-convention.mjs';

const ORIGINS=new Set(['https://wanhotrading.github.io','https://session-path-research.jjj-jason2345.chatgpt.site']);
export function createPublicWorker({context=createContextHandler({gcConvention:gcAutofillConvention,extendedHistory:true}),now=Date.now}={}){
 return {async fetch(request){
  const url=new URL(request.url);
  if(url.pathname==='/api/context')return context(request);
  const origin=request.headers.get('Origin'),headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0','CDN-Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'});
  if(origin&&ORIGINS.has(origin))headers.set('Access-Control-Allow-Origin',origin);
  const reply=(value,status=200)=>new Response(value===null?null:JSON.stringify(value),{status,headers});
  if(origin&&!ORIGINS.has(origin))return reply({status:'unavailable',code:'ORIGIN_NOT_ALLOWED',error:'This website is not allowed to use this endpoint.'},403);
  if(!['/','/api/health'].includes(url.pathname))return reply({status:'unavailable',code:'NOT_FOUND',error:'This API route was not found.'},404);
  if(request.method==='OPTIONS'){
   if(!origin)return reply({status:'unavailable',code:'ORIGIN_NOT_ALLOWED',error:'A browser origin is required.'},403);
   headers.set('Access-Control-Allow-Methods','GET, HEAD, OPTIONS');headers.set('Access-Control-Max-Age','0');return reply(null,204);
  }
  if(!['GET','HEAD'].includes(request.method)){headers.set('Allow','GET, HEAD, OPTIONS');return reply({status:'unavailable',code:'METHOD_NOT_ALLOWED',error:'Use GET to check the data service.'},405);}
  return reply(request.method==='HEAD'?null:{schema:'sessionpath.api-health.v1',status:'ok',service:'SessionPath public delayed-data API',source:'Yahoo Finance',mode:'on-demand-delayed',markets:['CL','NQ','ES','GC'],time:new Date(now()).toISOString()});
 }};
}
export default createPublicWorker();
