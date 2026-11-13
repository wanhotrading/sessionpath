import test from 'node:test';
import assert from 'node:assert/strict';
import {checkpointPollDelay,checkpointWaitState,validatePersonalRead} from '../../../docs/tradingview-live-core.mjs';
import {fixture} from '../backend/test/fixtures.mjs';
const body=(time='2026-11-04T08:00:00Z')=>({status:'waiting',receivedAt:time,packet:{market:'CL',session_date:'2026-11-04',observed_at:time,snapshots:[]}});
test('fresh CL heartbeat before 03:00 is connected and gives the new decision-open timing',()=>{
 const v=checkpointWaitState(body('2026-11-04T07:55:00Z'),{market:'CL',cutoff:'03:00',now:Date.parse('2026-11-04T07:59:50Z')});
 assert.equal(v.code,'CHECKPOINT_PENDING');assert.equal(v.state,'Connected');assert.match(v.message,/03:00 NY/);assert.match(v.message,/first trade/);assert.doesNotMatch(v.message,/Check.*alert|incomplete/);
});
test('05:00 and 08:30 selected checkpoints use their own decision times',()=>{
 for(const cutoff of ['05:00','08:30']){const v=checkpointWaitState(body(),{market:'CL',cutoff,now:Date.parse('2026-11-04T08:02:00Z')});assert.equal(v.state,'Connected');assert.ok(v.message.includes(cutoff+' NY'));}
});
test('a missing market is identified explicitly rather than promising an incoming checkpoint',()=>{
 const v=checkpointWaitState({status:'waiting',receivedAt:null,packet:null},{market:'NQ',now:Date.parse('2026-11-04T08:02:00Z')});assert.equal(v.code,'NO_MARKET_DATA');assert.match(v.message,/No NQ1! data/);assert.doesNotMatch(v.message,/03:05/);
});
test('the boundary heartbeat can precede the decision-open delivery, while a later empty update is incomplete',()=>{
 let v=checkpointWaitState(body(),{market:'CL',cutoff:'03:00',now:Date.parse('2026-11-04T08:00:01Z')});assert.equal(v.code,'AWAITING_CHECKPOINT_DELIVERY');assert.equal(v.state,'Connected');
 v=checkpointWaitState(body(),{market:'CL',cutoff:'03:00',now:Date.parse('2026-11-04T08:05:01Z')});assert.equal(v.code,'AWAITING_CHECKPOINT_DELIVERY');assert.equal(v.state,'Connected');
 v=checkpointWaitState(body('2026-11-04T08:05:00Z'),{market:'CL',cutoff:'03:00',now:Date.parse('2026-11-04T08:05:10Z')});assert.equal(v.code,'CHECKPOINT_INCOMPLETE');assert.match(v.message,/coverage/);
});

test('browser accepts the three marked decision opens and preserves old timestamp checks',()=>{
 const cutoffs=['03:00','05:00','08:30'];
 for (const [index,cutoff] of cutoffs.entries()) {
  const {packet,now}=fixture({market:'NQ',clock:cutoff,cutoffs:cutoffs.slice(0,index+1)});
  packet.checkpoint_timing='decision_open_v1';
  packet.snapshots.at(-1).reference_price=100.25;
  const response={schema:'sessionpath.tradingview.read.v1',status:'ready',packet,receivedAt:new Date(now).toISOString()};
  const options={market:'NQ',now};
  assert.equal(validatePersonalRead(response,options).snapshots.at(-1).reference_price,100.25);
  delete packet.checkpoint_timing;
  assert.throws(()=>validatePersonalRead(response,options),/timing or coverage/);
  packet.checkpoint_timing='decision_open_v1';
  assert.throws(()=>validatePersonalRead(response,{market:'NQ',now:now-8000}),/timing or coverage/);
  const wrongObservation=new Date(Date.parse(packet.observed_at)-300000).toISOString();
  assert.throws(()=>validatePersonalRead({...response,packet:{...packet,observed_at:wrongObservation}},options),/timing or coverage/);
  const late=fixture({market:'NQ',clock:['03:05','05:05','08:35'][index],cutoffs:cutoffs.slice(0,index+1)});
  assert.equal(validatePersonalRead({...response,packet:late.packet,receivedAt:new Date(late.now).toISOString()},{market:'NQ',now:late.now}).snapshots.at(-1).cutoff,cutoff);
 }
});

test('bounded retries start just after the boundary and stop once the checkpoint arrives',()=>{
 const ms=clock=>Date.parse('2026-11-04T'+clock+'Z');
 for(const [cutoff,boundary] of [['03:00','08:00'],['05:00','10:00'],['08:30','13:30']]){
  const stamp=ms(boundary+':00');
  assert.equal(checkpointPollDelay(stamp-12000,[cutoff],[]),13000);
  assert.equal(checkpointPollDelay(stamp+1000,[cutoff],[]),4000);
  assert.equal(checkpointPollDelay(stamp+1000,[cutoff],[{cutoff}]),30000);
  assert.equal(checkpointPollDelay(stamp+30001,[cutoff],[]),30000);
 }
 assert.equal(checkpointPollDelay(Date.parse('2026-11-07T08:00:00Z'),['03:00'],[]),30000);
});
test('old-day or stale observations are never described as a healthy pending connection',()=>{
 let v=checkpointWaitState(body(),{market:'CL',now:Date.parse('2026-11-04T08:12:00Z')});assert.equal(v.state,'Unavailable');assert.equal(v.code,'STALE_MARKET_DATA');
 v=checkpointWaitState(body(),{market:'CL',now:Date.parse('2026-11-05T08:01:00Z')});assert.equal(v.state,'Unavailable');
});
