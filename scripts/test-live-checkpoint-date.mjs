import assert from 'node:assert/strict';
import test from 'node:test';
import {createSavedCheckpointReader} from '../docs/saved-forecast-checkpoints.mjs';

const windows = [{cutoff:'03:00',minute:180},{cutoff:'05:00',minute:300},{cutoff:'08:30',minute:510}];
const today = '2026-11-27', yesterday = '2026-11-26';

function archive(records) {
  const requests = [];
  const reader = createSavedCheckpointReader({
    market: 'CL', endpoint: 'https://example.test/history', windows,
    parse: (body,{cutoff}) => body.includes(cutoff) ? {snapshot:{cutoff}} : null,
    fetchImpl: async url => {
      const date = url.searchParams.get('date');
      requests.push(date);
      return Response.json(records[date] ?? []);
    }
  });
  return {reader,requests};
}

test('06:00 NY with yesterday complete and today missing looks up today only', async () => {
  const {reader, requests} = archive({[yesterday]:windows.map(w=>w.cutoff)});
  assert.equal(await reader({date:today,minute:360}), null);
  assert.deepEqual(requests, [today]);
  const replay = await reader.forDate(yesterday);
  assert.equal(replay.records[2].snapshot.cutoff, '08:30');
});

test('cutoff boundaries and same-day saved recovery', async () => {
  const {reader, requests} = archive({[today]:windows.map(w=>w.cutoff)});
  assert.equal(await reader({date:today,minute:179}), null);
  assert.deepEqual(requests, []);
  for (const [minute, cutoff] of [[180,'03:00'],[299,'03:00'],[300,'05:00'],[509,'05:00'],[510,'08:30'],[960,'08:30']]) {
    const result = await reader({date:today,minute});
    assert.equal(result.date, today);
    assert.equal(result.record.snapshot.cutoff, cutoff);
  }
  assert.deepEqual(requests, [today]);
});

test('an earlier or future checkpoint cannot fill a missing active window', async () => {
  const {reader} = archive({[today]:['03:00','08:30']});
  assert.equal(await reader({date:today,minute:360}), null);
});

import {readFile} from 'node:fs/promises';
import {supplementForecastRecord} from '../docs/assistant-forecast-adapter.mjs';

const candleArchive = JSON.parse(await readFile(new URL('../docs/assistant-historical-inputs.json',import.meta.url)));
function receiptReader(market, fetchImpl, read = request => supplementForecastRecord(candleArchive,request)) {
  return createSavedCheckpointReader({market,endpoint:'https://example.test/history',windows,
    parse:(body,q)=>body.available?.includes(q.cutoff)?{snapshot:{cutoff:q.cutoff},contract:market+'1!'}:null,
    fetchImpl,lookback:read});
}
for (const [market,price] of [['CL',85.66],['NQ',26717.5],['ES',7320.5],['GC',3701.6]]) {
  test(market+' at 06:36 reconstructs the 05:00 forecast from genuine dated chart inputs', async () => {
    const reader=receiptReader(market,async()=>Response.json({status:'unavailable'}));
    const {record,records}=await reader({date:today,minute:396});
    assert.equal(record.snapshot.reference_price,price);
    assert.equal(record.snapshot.as_of,'2026-11-27T10:00:00.000Z');
    assert.ok(record.snapshot.range_low<=price&&record.snapshot.range_high>=price&&record.snapshot.avr>0);
    assert.equal(records[0].snapshot.cutoff,'03:00');
    assert.equal(records[2],null);
  });
}
test('an archive transport failure still allows an exact dated chart record',async()=>{
  const r=receiptReader('CL',async()=>{throw new Error('unavailable');});
  assert.equal((await r({date:today,minute:509})).record.snapshot.reference_price,85.66);
});
test('source precedence and time, date, instrument and contract isolation for all windows',async()=>{
  for(const [i,w] of windows.entries()){
    const requested=[];
    const alt=q=>{requested.push(q.cutoff);return {date:today,market:'NQ',contract:'NQ1!',snapshot:{cutoff:q.cutoff}};};
    const r=receiptReader('NQ',async()=>Response.json({available:['03:00']}),alt);
    const v=await r({date:today,minute:w.minute+5});
    assert.equal(v.record.snapshot.cutoff,w.cutoff);
    assert.deepEqual(requested,windows.slice(1,i+1).map(w=>w.cutoff));
    for(const patch of [{market:'ES'},{date:yesterday},{contract:'NQZ2026'},{snapshot:{cutoff:'00:00'}}]){
      const wrong=receiptReader('NQ',async()=>Response.json({}),q=>({...alt(q),...patch}));
      assert.equal(await wrong({date:today,minute:w.minute+5}),null);
    }
  }
});
