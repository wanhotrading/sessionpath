import test from 'node:test';
import assert from 'node:assert/strict';
import {checkpointWaitState, validatePersonalRead, READ_SCHEMA} from '../../../docs/tradingview-live-core.mjs';

function heartbeat(market, date, stamp, status='waiting') {
  return {schema:READ_SCHEMA,status,receivedAt:stamp,
    packet:{market,session_date:date,observed_at:stamp,snapshots:[]}};
}
test('the evening feed is connected before the next NY checkpoint in standard and daylight time',()=>{
  for (const market of ['CL','ES','NQ','GC']) {
    for (const [date,stamp] of [['2026-11-20','2026-11-20T03:15:00Z'],['2026-07-02','2026-07-02T02:15:00Z']]) {
      const body=heartbeat(market,date,stamp),options={market,now:Date.parse(stamp)+10000};
      assert.equal(checkpointWaitState(body,options).code,'CHECKPOINT_PENDING');
      assert.equal(validatePersonalRead(body,options),null);
      assert.equal(checkpointWaitState(body,{...options,now:options.now+480000}).state,'Unavailable');
      assert.equal(checkpointWaitState({...body,packet:{...body.packet,session_date:'2026-01-01'}},options).state,'Unavailable');
    }
  }
});
test('a fresh last bar at the 19:30 handoff confirms the connection without applying yesterday’s forecast',()=>{
  const body=heartbeat('CL','2026-11-19','2026-11-20T00:30:00Z','stale');
  const options={market:'CL',now:Date.parse('2026-11-20T00:30:05Z')};
  assert.equal(validatePersonalRead(body,options),null);
  assert.equal(checkpointWaitState(body,options).state,'Connected');
  assert.throws(()=>validatePersonalRead(body,{...options,now:options.now+600000}),/stale/);
  assert.throws(()=>validatePersonalRead(body,{...options,market:'ES'}),/stale/);
});
