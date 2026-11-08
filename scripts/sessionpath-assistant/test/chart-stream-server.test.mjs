import test from 'node:test';
import assert from 'node:assert/strict';
import {chartEventResponse,wantsChartEvents,CHART_HEARTBEAT_MS} from '../chart-stream.mjs';
import {createAssistantHandler} from '../router.mjs';
import {CHART_MODEL} from '../chart-vision.mjs';
import {RASTER_FIXTURES} from './chart-fixtures.mjs';
const decode=bytes=>new TextDecoder().decode(bytes);
const boundedText=async(body,limit)=>{const text=await new Response(body).text();if(Buffer.byteLength(text)>limit)throw Error('Too large');return text;};
const context={market:'CL',window:'03:00-05:00',date:null};
const analysis={summary:'Visible price initially rises and later retraces.',sequence:['The initial candles rise.','The later candles retrace.'],bbox:'The prior BBOX labels are not legible.',sessionpath:'A red and green box is visible.',uncertainties:['The exact boundaries cannot be read.']};
function post(accept,signal){return new Request('https://assistant.test/api/chart',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://wanhotrading.github.io','CF-Connecting-IP':'192.0.2.1',...(accept?{Accept:accept}:{})},body:JSON.stringify({context,image:{dataUrl:RASTER_FIXTURES.png}}),signal});}
const env={OPENROUTER_API_KEY:'test-not-real'};
const validUpstream=()=>Response.json({model:CHART_MODEL,choices:[{finish_reason:'stop',message:{content:JSON.stringify(analysis)}}]});

test('SSE is opt-in, including an explicit zero-quality exclusion',()=>{
 assert.equal(CHART_HEARTBEAT_MS,10000);
 for(const accept of['','application/json','text/event-stream;q=0','text/event-stream;q=0.00'])assert.equal(wantsChartEvents(post(accept)),false);
 for(const accept of['text/event-stream','text/event-stream;q=0.8','application/json, TEXT/EVENT-STREAM'])assert.equal(wantsChartEvents(post(accept)),true);
});
test('headers and heartbeat bytes arrive before a slow result, then exactly one final JSON event closes',async()=>{
 let release,calls=0;const response=chartEventResponse(()=>{calls++;return new Promise(resolve=>release=resolve);},{headers:{'Access-Control-Allow-Origin':'https://wanhotrading.github.io'},boundedText,heartbeatMs:5});
 assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/^text\/event-stream/);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://wanhotrading.github.io');
 const reader=response.body.getReader();assert.equal(decode((await reader.read()).value),': connected\n\n');assert.equal(decode((await reader.read()).value),': heartbeat\n\n');
 const expected={ok:true,analysis};release(Response.json(expected));
 const event=decode((await reader.read()).value);assert.equal(event,'event: result\ndata: '+JSON.stringify(expected)+'\n\n');assert.equal((await reader.read()).done,true);assert.equal(calls,1);reader.releaseLock();
});
test('final provider errors preserve their body while unexpected stream failures stay fixed',async()=>{
 const denial={ok:false,error:{code:'AI_CREDIT_RESTRICTED',message:'OpenRouter blocked this chart request because of an account or key credit restriction.'}};
 const response=chartEventResponse(async()=>Response.json(denial,{status:503}),{headers:{},boundedText});const text=await response.text();assert.ok(text.includes('data: '+JSON.stringify(denial)));assert.equal((text.match(/event: result/g)||[]).length,1);
 const failed=chartEventResponse(async()=>{throw Error('private-provider-secret');},{headers:{},boundedText});const body=await failed.text();assert.match(body,/CHART_STREAM_FAILED/);assert.doesNotMatch(body,/private-provider-secret/);
});
test('the actual chart route negotiates early SSE with one upstream call and no quota reservation',async()=>{
 let release,calls=0,reserves=0;const handler=createAssistantHandler({fetcher:async()=>{calls++;return new Promise(resolve=>release=resolve);}});
 const quotaEnv={...env,ASSISTANT_QUOTA:{getByName:()=>({reserve:async()=>{reserves++;return{allowed:true};}})}};
 const response=await handler(post('text/event-stream'),quotaEnv);assert.match(response.headers.get('Content-Type'),/^text\/event-stream/);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://wanhotrading.github.io');
 const reader=response.body.getReader();assert.equal(decode((await reader.read()).value),': connected\n\n');for(let i=0;i<4;i++)await Promise.resolve();assert.equal(calls,1);release(validUpstream());
 const event=decode((await reader.read()).value);const result=JSON.parse(event.split('data: ')[1]);assert.equal(result.ok,true);assert.deepEqual(result.analysis,analysis);assert.equal(result.model,CHART_MODEL);assert.equal((await reader.read()).done,true);assert.equal(calls,1);assert.equal(reserves,0);reader.releaseLock();
 const json=await createAssistantHandler({fetcher:async()=>validUpstream()})(post('application/json'),env);assert.match(json.headers.get('Content-Type'),/^application\/json/);assert.deepEqual((await json.json()).analysis,analysis);
});
test('cancelling the stream or the incoming request aborts the single upstream call',async()=>{
 for(const mode of['reader','request']){
  let calls=0,upstreamSignal;const abort=new AbortController();
  const handler=createAssistantHandler({fetcher:async(_url,options)=>{calls++;upstreamSignal=options.signal;return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}});
  const response=await handler(post('text/event-stream',abort.signal),env);const reader=response.body.getReader();await reader.read();for(let i=0;i<4;i++)await Promise.resolve();assert.ok(upstreamSignal);
  if(mode==='reader')await reader.cancel();else{abort.abort();await assert.rejects(reader.read(),{name:'AbortError'});}
  assert.equal(upstreamSignal.aborted,true);assert.equal(calls,1);reader.releaseLock();
 }
});
