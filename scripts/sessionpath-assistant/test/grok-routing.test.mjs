import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createAssistantHandler,FREE_MODEL} from '../router.mjs';
import {CHART_MODEL} from '../chart-vision.mjs';
import {RASTER_FIXTURES} from './chart-fixtures.mjs';
const context={market:'CL',window:'03:00-05:00',date:null};
const descriptive={summary:'Visible price first rises, then retraces.',sequence:['The earliest candles rise.','Later candles retrace.'],bbox:'The prior BBOX labels are unreadable.',sessionpath:'A red and green box is visible.',uncertainties:['Exact numerical edges are not legible.']};
function request(path,body){return new Request('https://assistant.test'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://wanhotrading.github.io','CF-Connecting-IP':'192.0.2.9'},body:JSON.stringify(body)});}
test('non-exact text requests retain the free intent parser and its small nonreasoning payload',async()=>{
 let payload;const handler=createAssistantHandler({fetcher:async(_url,init)=>{payload=JSON.parse(init.body);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'clarify',market:'CL',window:'03:00-05:00',concept:null,date:null})}}]});}});
 const response=await handler(request('/api/chat',{message:'Could you help me make sense of this?',context}),{OPENROUTER_API_KEY:'test-only-key'});
 assert.equal(response.status,200);assert.equal(payload.model,FREE_MODEL);assert.equal(payload.max_tokens,512);assert.deepEqual(payload.reasoning,{enabled:false});assert.equal(payload.temperature,0);assert.equal(payload.top_p,undefined);
});
test('a missing or substituted upstream chart model is rejected, without returning its prose or retrying',async()=>{
 for(const returned of [undefined,FREE_MODEL,'paid/other-model']){
  let calls=0;const handler=createAssistantHandler({fetcher:async()=>{calls++;return Response.json({...(returned?{model:returned}:{}),choices:[{finish_reason:'stop',message:{content:JSON.stringify({...descriptive,summary:'substituted-model-prose'})}}]});}});
  const result=await handler(request('/api/chart',{context,image:{dataUrl:RASTER_FIXTURES.png}}),{OPENROUTER_API_KEY:'test-only-key'});
  assert.equal(result.status,503);assert.equal((await result.json()).error.code,'INVALID_CHART_RESPONSE');assert.equal(calls,1);
 }
});
test('provider/account denials stay fixed and paid-compatible while preserving direct command availability',async()=>{
 for(const [status,message]of[[400,'Credit limit exceeded secret-provider-detail'],[402,'Secret balance detail'],[403,'Secret location detail'],[429,'Secret queue detail'],[503,'Secret internal detail']]){
  const handler=createAssistantHandler({fetcher:async()=>Response.json({error:{message}},{status})});
  const response=await handler(request('/api/chart',{context,image:{dataUrl:RASTER_FIXTURES.png}}),{OPENROUTER_API_KEY:'test-only-key'});const body=await response.json();
  assert.equal(body.ok,false);assert.doesNotMatch(body.error.message,/free chart|No paid model was used|Secret|secret-provider-detail/);assert.doesNotMatch(body.error.message,/test-only-key/);
  const direct=await handler(request('/api/chat',{message:'CL 03-05',context}),{});assert.equal(direct.status,200);assert.equal((await direct.json()).interpreter,'rules');
 }
});
test('root, ES and GC cache entries all load the upgraded shared screenshot UI',async()=>{
 for(const market of['','es/','gc/']){
  const entry=await readFile(new URL('../../../docs/'+market+'assistant-chat-entry.mjs',import.meta.url),'utf8');const html=await readFile(new URL('../../../docs/'+market+'index.html',import.meta.url),'utf8');
  assert.match(entry,/assistant-chat\.mjs\?v=visual-tags-20261108b/);assert.match(html,/assistant-chat-entry\.mjs\?v=visual-tags-20261108b/);
 }
});
