import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{createPublicWorker} from './public-worker.mjs';
const origin='https://wanhotrading.github.io';
test('public health is available to mobile Pages without private transport bindings',async()=>{
 const response=await worker.fetch(new Request('https://api.example/api/health',{headers:{Origin:origin,'User-Agent':'Mozilla/5.0 Android Chrome Mobile'}}));
 assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
 const body=await response.json();assert.equal(body.schema,'sessionpath.api-health.v1');assert.equal(body.source,'Yahoo Finance');assert.deepEqual(body.markets,['CL','NQ','ES','GC']);
 assert.equal(body.privateChartConfigured,undefined);
});
test('public health HEAD and preflight have no body and correct CORS',async()=>{
 for(const [method,status] of [['HEAD',200],['OPTIONS',204]]){
  const r=await worker.fetch(new Request('https://api.example/api/health',{method,headers:{Origin:origin}}));
  assert.equal(r.status,status);assert.equal(await r.text(),'');assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);
 }
});
test('the context route delegates the extended handler unchanged rather than fetching a GPT-hosted backend',async()=>{
 let received;
 const handler=createPublicWorker({context:async request=>{received=request;return Response.json({source:'local-extended-handler'});}}),request=new Request('https://api.example/api/context?market=ES&cutoff=03:00');
 const r=await handler.fetch(request);assert.equal(received,request);assert.equal((await r.json()).source,'local-extended-handler');
});
test('public worker rejects private bridge routes and exposes no read or write credentials',async()=>{
 for(const path of ['/api/bridge/context','/api/bridge/ingest']){
  const r=await worker.fetch(new Request('https://api.example'+path));assert.equal(r.status,404);
  assert.doesNotMatch(await r.text(),/READ_KEY|WRITE_KEY|OWNER_CHANNEL|SNAPSHOTS/);
 }
});
test('context validation failures are readable JSON with Pages CORS and no source fetch',async()=>{
 const r=await worker.fetch(new Request('https://api.example/api/context?market=INVALID&cutoff=03:00',{headers:{Origin:origin}}));
 assert.equal(r.status,400);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);assert.equal((await r.json()).result.code,'UNSUPPORTED_MARKET');
});
test('untrusted origins and unsupported health methods fail without private routes',async()=>{
 assert.equal((await worker.fetch(new Request('https://api.example/api/health',{headers:{Origin:'https://untrusted.example'}}))).status,403);
 assert.equal((await worker.fetch(new Request('https://api.example/api/health',{method:'POST'}))).status,405);
});
