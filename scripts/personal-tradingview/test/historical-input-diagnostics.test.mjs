import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../backend/test/fixtures.mjs';
import {normalizePacket} from '../backend/validation.mjs';
import {ASSISTANT_HISTORY_URL,loadHistoricalForecast,validateForecastRequest,historicalFeedRecord,createForecastRequester} from '../../../docs/assistant-forecast-adapter.mjs';

const request=validateForecastRequest({requestId:'nq-history-diagnostics',market:'NQ',window:'08:30-16:00',date:'2026-10-28'},'NQ',Date.parse('2026-11-08T12:00:00Z'));
const empty={schema:'sessionpath.assistant.historical-inputs.v1',records:[]};
const unavailable={schema:'sessionpath.tradingview.history.v1',status:'unavailable',date:request.date,receivedAt:null,packet:null,validationBasis:'authenticated_pine_attestation'};
const secret='PRIVATE_VALUE_NOT_FOR_DIAGNOSTICS';
const feedURL='https://feed.example/api/autofill';
const absentMessage='No saved NQ 08:30 checkpoint is available for 2026-10-28 in the historical inputs. Today’s prices were not substituted.';
const loaded=body=>async()=>Response.json(body);
const options={request,archive:null,loadSupplement:async()=>empty,feedURL,fetchImpl:loaded(unavailable)};
async function failureOf(overrides={}){
 try{await loadHistoricalForecast({...options,...overrides});assert.fail('Expected unavailable history');}catch(error){assert.equal(error.code,'HISTORICAL_UNAVAILABLE');assert.ok(error.message.endsWith('Today’s prices were not substituted.'));assert.ok(!error.message.includes(secret));return error;}
}
function feedFixture(cutoffs){
 const f=fixture({market:'NQ',...(cutoffs?{cutoffs}:{} )});
 const request=validateForecastRequest({requestId:'saved-feed',market:'NQ',window:'08:30-16:00',date:'2026-11-03'},'NQ',Date.parse('2026-11-08T12:00:00Z'));
 return {request,body:{schema:'sessionpath.tradingview.history.v1',status:'ready',date:request.date,receivedAt:new Date(f.now).toISOString(),packet:normalizePacket(f.packet,{now:f.now}),validationBasis:'authenticated_pine_attestation'}};
}

test('verified absent research/static/feed inputs identify the missing dated checkpoint',async()=>{
 const error=await failureOf();assert.equal(error.message,absentMessage);
 assert.ok(!error.message.includes('failed verification'));assert.ok(!error.message.includes('Try again'));
});

for(const [name,fetchImpl] of [
 ['network error',async()=>{throw Error(secret);}],
 ['network error with an unrelated diagnostic code',async()=>{throw Object.assign(Error(secret),{code:'HISTORICAL_UNAVAILABLE'});}],
 ['HTTP error',async()=>new Response(secret,{status:503})],
 ['invalid JSON',async()=>new Response(secret,{status:200})],
 ['unrecognized response',loaded({message:secret})],
 ['wrong requested date',loaded({...unavailable,date:'2026-10-27',message:secret})],
 ['inconsistent unavailable response',loaded({...unavailable,packet:{raw:secret}})],
 ['unverified provider response',loaded({...unavailable,validationBasis:secret})]
])test(`${name} does not claim the checkpoint is absent`,async()=>{
 const error=await failureOf({fetchImpl});assert.match(error.message,/could not all be loaded or verified/);assert.match(error.message,/availability could not be confirmed; try again/);assert.notEqual(error.message,absentMessage);
});

test('a failed or malformed static archive prevents a false confirmed-absence message',async()=>{
 for(const loadSupplement of [async()=>{throw Error(secret);},async()=>({schema:secret,records:[]}),async()=>null]){
  const error=await failureOf({loadSupplement});assert.match(error.message,/availability could not be confirmed/);
 }
});

test('a saved feed missing only the requested cutoff identifies a missing checkpoint',async()=>{
 const f=feedFixture(['03:00','05:00']);const error=await failureOf({request:f.request,fetchImpl:loaded(f.body)});
 assert.match(error.message,/No saved NQ 08:30 checkpoint is available for 2026-11-03/);assert.doesNotMatch(error.message,/failed verification|could not all be loaded/);
});

test('saved feed inputs that fail validation report rejection without raw details',async()=>{
 const f=feedFixture();f.body.packet.snapshots[2].avr_count=9;f.body.packet.snapshots[2].raw=secret;
 const error=await failureOf({request:f.request,fetchImpl:loaded(f.body)});assert.match(error.message,/Saved NQ 08:30 inputs for 2026-11-03 failed verification/);
});

test('saved archive input rejection remains fail-closed and keeps the compatible code',async()=>{
 const f=feedFixture(),record=historicalFeedRecord(f.body,f.request);record.snapshot.reference_price=100.01;
 for(const useArchive of [true,false]){
  let feedCalls=0;
  const error=await failureOf({request:f.request,archive:useArchive?record:null,loadSupplement:async()=>({schema:empty.schema,records:[record]}),fetchImpl:async()=>{feedCalls++;return Response.json(f.body);}});
  assert.match(error.message,/Saved NQ 08:30 inputs for 2026-11-03 failed verification/);assert.equal(feedCalls,0);
 }
});

test('successful source preference and exact returned inputs are unchanged',async()=>{
 assert.equal(new URL(ASSISTANT_HISTORY_URL).searchParams.get('v'),'history-backfill-20261108');
 const f=feedFixture(),record=historicalFeedRecord(f.body,f.request);let supplementCalls=0,feedCalls=0;
 const actual=await loadHistoricalForecast({...options,request:f.request,archive:record,loadSupplement:async()=>{supplementCalls++;return empty;},fetchImpl:async()=>{feedCalls++;return Response.json(f.body);}});
 assert.equal(actual,record);assert.equal(supplementCalls,0);assert.equal(feedCalls,0);
 const supplemented=await loadHistoricalForecast({...options,request:f.request,loadSupplement:async()=>({schema:empty.schema,records:[record]}),fetchImpl:async()=>{feedCalls++;return Response.json(f.body);}});
 assert.equal(supplemented,record);assert.equal(feedCalls,0);
 const fetched=await loadHistoricalForecast({...options,request:f.request,loadSupplement:async()=>{throw Error(secret);},fetchImpl:async url=>{feedCalls++;assert.equal(new URL(url).pathname,'/api/history');assert.equal(new URL(url).searchParams.get('date'),f.request.date);return Response.json(f.body);}});
 assert.deepEqual(fetched,record);assert.equal(feedCalls,1);
});

test('requester delivers the safe missing-history message without applying inputs',async()=>{
 let applies=0,liveCalls=0;
 const run=createForecastRequester({market:'NQ',feedURL,now:()=>Date.parse('2026-11-08T12:00:00Z'),readHistorical:({request})=>loadHistoricalForecast({...options,request}),applySnapshot:()=>{applies++;},fetchImpl:async()=>{liveCalls++;throw Error(secret);}});
 const result=await run({requestId:request.requestId,market:request.market,window:request.window,date:request.date});
 assert.equal(result.ok,false);assert.deepEqual(result.error,{code:'HISTORICAL_UNAVAILABLE',message:absentMessage});assert.equal(applies,0);assert.equal(liveCalls,0);
});
