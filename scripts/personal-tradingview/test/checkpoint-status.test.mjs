import test from 'node:test';
import assert from 'node:assert/strict';
import {checkpointWaitState} from '../../../docs/tradingview-live-core.mjs';
const body=(time='2026-11-04T08:00:00Z')=>({status:'waiting',receivedAt:time,packet:{market:'CL',session_date:'2026-11-04',observed_at:time,snapshots:[]}});
test('fresh CL heartbeat before03:05 is connected and gives the actual03:00 delivery time',()=>{
 const v=checkpointWaitState(body(),{market:'CL',cutoff:'03:00',now:Date.parse('2026-11-04T08:02:00Z')});
 assert.equal(v.code,'CHECKPOINT_PENDING');assert.equal(v.state,'Connected');assert.match(v.message,/03:05 NY/);assert.match(v.message,/automatically/);assert.doesNotMatch(v.message,/Check.*alert|incomplete/);
});
test('05:00 and08:30 selected checkpoints use their own delivery times',()=>{
 for(const [cutoff,due] of [['05:00','05:05'],['08:30','08:35']]){const v=checkpointWaitState(body(),{market:'CL',cutoff,now:Date.parse('2026-11-04T08:02:00Z')});assert.equal(v.state,'Connected');assert.ok(v.message.includes(due+' NY'));}
});
test('a missing market is identified explicitly rather than promising an incoming checkpoint',()=>{
 const v=checkpointWaitState({status:'waiting',receivedAt:null,packet:null},{market:'NQ',now:Date.parse('2026-11-04T08:02:00Z')});assert.equal(v.code,'NO_MARKET_DATA');assert.match(v.message,/No NQ1! data/);assert.doesNotMatch(v.message,/03:05/);
});
test('after03:05, the preceding heartbeat is awaiting delivery while a new empty update is incomplete',()=>{
 let v=checkpointWaitState(body(),{market:'CL',cutoff:'03:00',now:Date.parse('2026-11-04T08:05:01Z')});assert.equal(v.code,'AWAITING_CHECKPOINT_DELIVERY');assert.equal(v.state,'Connected');
 v=checkpointWaitState(body('2026-11-04T08:05:00Z'),{market:'CL',cutoff:'03:00',now:Date.parse('2026-11-04T08:05:10Z')});assert.equal(v.code,'CHECKPOINT_INCOMPLETE');assert.match(v.message,/coverage/);
});
test('old-day or stale observations are never described as a healthy pending connection',()=>{
 let v=checkpointWaitState(body(),{market:'CL',now:Date.parse('2026-11-04T08:12:00Z')});assert.equal(v.state,'Unavailable');assert.equal(v.code,'STALE_MARKET_DATA');
 v=checkpointWaitState(body(),{market:'CL',now:Date.parse('2026-11-05T08:01:00Z')});assert.equal(v.state,'Unavailable');
});
