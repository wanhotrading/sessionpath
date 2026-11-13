import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalHandler, sha256} from '../router.mjs';
import {PersonalFeedStore} from '../state.mjs';
import {DECISION_OPEN_TIMING, normalizePacket, nyEpoch, datePlus} from '../validation.mjs';
import {fixture, FakeStorage, testCrypto, WRITE_TOKEN} from './fixtures.mjs';

const cutoffs = ['03:00', '05:00', '08:30'];

function decisionOpen(cutoff, date='2026-11-03') {
  const {packet, now} = fixture({date, clock:cutoff, cutoffs:cutoffs.slice(0, cutoffs.indexOf(cutoff) + 1)});
  if (date === '2026-10-30') {
    const avrDates = ['2026-10-16','2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-26','2026-10-27','2026-10-28','2026-10-29'];
    for (const snapshot of packet.snapshots) snapshot.avr_dates = avrDates;
  }
  packet.checkpoint_timing = DECISION_OPEN_TIMING;
  packet.snapshots.at(-1).reference_price = 100.25;
  return {packet, now};
}

test('accepts actual decision opens on all three NY boundaries with DST preserved', () => {
  for (const date of ['2026-10-30', '2026-11-03']) {
    for (const cutoff of cutoffs) {
      const {packet, now} = decisionOpen(cutoff,date);
      const result = normalizePacket(packet,{now});
      assert.equal(Date.parse(result.observed_at),nyEpoch(date,cutoff));
      assert.equal(result.checkpoint_timing,DECISION_OPEN_TIMING);
      assert.equal(result.snapshots.at(-1).reference_price,100.25);
      assert.equal(result.last_price,100);
      assert.equal(result.snapshots.at(-1).london_complete,cutoff==='08:30');
      assert.equal(Date.parse(result.snapshots.at(-1).avr_frozen_at),nyEpoch(datePlus(date,-1),'19:30'));
      assert.equal(result.token,undefined);
      delete packet.checkpoint_timing;
      assert.throws(() => normalizePacket(packet,{now}),{code:'INVALID_CUTOFF'});
    }
  }
});

test('rejects unrecognized timing markers, empty marked updates and markers away from the boundary', () => {
  const {packet, now} = decisionOpen('05:00');
  assert.throws(() => normalizePacket({...packet, checkpoint_timing:'unknown'},{now}),{code:'INVALID_CHECKPOINT_TIMING'});
  assert.throws(() => normalizePacket({...packet, snapshots:[]},{now}),{code:'INVALID_CHECKPOINT_TIMING'});
  assert.throws(() => normalizePacket({...packet, snapshots:packet.snapshots.slice(0,1)},{now}),{code:'INVALID_CUTOFF'});
  assert.throws(() => normalizePacket(packet,{now:Date.parse(packet.observed_at)-1000}),{code:'STALE_TRANSPORT'});
  const early = {...packet, observed_at:'2026-11-03T09:55:00.000Z', sent_at:'2026-11-03T09:55:01.000Z'};
  assert.throws(() => normalizePacket(early,{now:Date.parse(early.sent_at)+1000}),{code:'INVALID_CUTOFF'});
  const later = {...packet, observed_at:'2026-11-03T10:05:00.000Z', sent_at:'2026-11-03T10:05:01.000Z'};
  assert.throws(() => normalizePacket(later,{now:Date.parse(later.sent_at)+1000}),{code:'INVALID_CUTOFF'});
  delete later.checkpoint_timing;
  assert.equal(normalizePacket(later,{now:Date.parse(later.sent_at)+1000}).snapshots.length,2);
});

async function receiver(initialTime) {
  let time = initialTime;
  const store = new PersonalFeedStore(new FakeStorage());
  const handler = createPersonalHandler({now:() => time, cryptoImpl:testCrypto});
  const env = {PUBLIC_AUTOFILL_ENABLED:'true', WRITE_TOKEN_HASH:await sha256(WRITE_TOKEN,testCrypto), PERSONAL_FEEDS:{getByName:() => store}};
  const request = path => handler(new Request('https://bridge.example'+path),env).then(response => response.json());
  return {
    setTime(value){time=value;},
    post(packet){return handler(new Request('https://bridge.example/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(packet)}),env).then(response => response.json());},
    live:() => request('/api/autofill?market=CL'),
    history:() => request('/api/history?market=CL&date=2026-11-03')
  };
}

test('same-boundary authenticated open enriches a legacy heartbeat once and keeps earlier inputs frozen', async () => {
  const {packet:early, now} = decisionOpen('05:00');
  const service = await receiver(now);
  const legacy = {...early, snapshots:[structuredClone(early.snapshots[0])]};
  delete legacy.checkpoint_timing;
  assert.deepEqual(await service.post(legacy),{status:'accepted'});
  const first = await service.live();
  early.snapshots[0].reference_price = 101;
  early.sent_at = new Date(now + 1000).toISOString();
  service.setTime(now + 2000);
  assert.deepEqual(await service.post(early),{status:'accepted'});
  const live = await service.live();
  assert.equal(live.packet.checkpoint_timing,DECISION_OPEN_TIMING);
  assert.equal(live.packet.snapshots.length,2);
  assert.deepEqual(live.packet.snapshots[0],first.packet.snapshots[0]);
  assert.equal(live.packet.snapshots[1].reference_price,100.25);
  assert.equal(live.receivedAt,first.receivedAt);
  assert.equal(live.packet.sent_at,first.packet.sent_at);
  assert.equal(live.checkpointProvenance['05:00'].receivedAt,new Date(now+2000).toISOString());
  assert.equal((await service.history()).packet.checkpoint_timing,DECISION_OPEN_TIMING);
  assert.deepEqual(await service.post(early),{status:'duplicate'});
  const conflicting = structuredClone(early);
  conflicting.snapshots[1].reference_price = 100.5;
  assert.deepEqual(await service.post(conflicting),{status:'ignored'});
  assert.deepEqual(await service.live(),live);
});

test('an early open arriving first remains frozen through same-boundary and later legacy packets', async () => {
  const {packet:early, now} = decisionOpen('08:30');
  const service = await receiver(now);
  assert.deepEqual(await service.post(early),{status:'accepted'});
  const legacy = {...early, snapshots:early.snapshots.slice(0,2)};
  delete legacy.checkpoint_timing;
  assert.deepEqual(await service.post(legacy),{status:'ignored'});
  const first = await service.live();
  const {packet:later,now:laterNow} = fixture();
  service.setTime(laterNow);
  assert.deepEqual(await service.post(later),{status:'accepted'});
  const live = await service.live();
  assert.equal(live.packet.checkpoint_timing,undefined);
  assert.equal(live.packet.observed_at,later.observed_at);
  assert.equal(live.packet.snapshots[2].reference_price,100.25);
  assert.deepEqual(live.checkpointProvenance,first.checkpointProvenance);
  assert.deepEqual(await service.history(),{...first,schema:'sessionpath.tradingview.history.v1',date:'2026-11-03'});
});
