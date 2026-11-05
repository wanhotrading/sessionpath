import test from 'node:test';
import assert from 'node:assert/strict';
import {PersonalFeedStore} from '../state.mjs';
import {normalizePacket} from '../validation.mjs';
import {sha256} from '../router.mjs';
import {fixture,FakeStorage,testCrypto} from './fixtures.mjs';
import {validatePersonalRead} from '../../../../docs/tradingview-live-core.mjs';

class ReconciliationStorage extends FakeStorage{async delete(key){return this.values.delete(key);}}
async function envelope(raw){
  const now=Date.parse(raw.sent_at)+1000,packet=normalizePacket(raw,{now});
  return {packet,receivedAt:new Date(now).toISOString(),observedMs:Date.parse(packet.observed_at),packetHash:await sha256(JSON.stringify(packet),testCrypto),snapshotHashes:Object.fromEntries(await Promise.all(packet.snapshots.map(async s=>[s.cutoff,await sha256(JSON.stringify(s),testCrypto)])))};
}
function at(raw,time,{snapshots=raw.snapshots,lastPrice=raw.last_price}={}){
  const next=structuredClone(raw);next.observed_at=time;next.sent_at=new Date(Date.parse(time)+1000).toISOString();next.snapshots=structuredClone(snapshots);next.last_price=lastPrice;return next;
}

test('CL and ES one-tick Asia-close revisions preserve frozen snapshots but accept fresh quote and timestamp',async()=>{
  for(const [market,tick]of [['CL',.01],['ES',.25]]){
    const storage=new ReconciliationStorage(),store=new PersonalFeedStore(storage),raw=fixture({market}).packet;
    const initial=await envelope(raw);await store.accept(initial);const before=await store.getLatest();
    const revised=at(raw,'2026-11-03T13:40:00Z',{lastPrice:102});
    for(const s of revised.snapshots)s.asia_close-=tick;
    const next=await envelope(revised);assert.equal((await store.accept(next)).status,'accepted');
    const saved=await store.getLatest();
    assert.deepEqual(saved.packet.snapshots,before.packet.snapshots);assert.deepEqual(saved.snapshotHashes,before.snapshotHashes);
    assert.equal(saved.packet.last_price,102);assert.equal(saved.observedMs,next.observedMs);assert.equal(saved.receivedAt,next.receivedAt);
    assert.equal(saved.packetHash,await sha256(JSON.stringify(saved.packet),testCrypto));assert.notEqual(saved.packetHash,next.packetHash);
    assert.equal(saved.reconciliation.sourcePacketHash,next.packetHash);assert.equal(saved.reconciliation.policy,'first-accepted-per-checkpoint');
    assert.equal(saved.reconciliation.status,'preserved_frozen');assert.deepEqual(saved.reconciliation.revisedCutoffs,['03:00','05:00','08:30']);
    assert.deepEqual(saved.reconciliation.changedFields['03:00'],['asia_close']);
    assert.deepEqual(saved.checkpointProvenance,before.checkpointProvenance);
    assert.equal(validatePersonalRead({schema:'sessionpath.tradingview.read.v1',status:'ready',receivedAt:saved.receivedAt,packet:saved.packet},{market,now:Date.parse(saved.receivedAt)}).last_price,102);
  }
});

test('a fresh empty or partial sender heartbeat cannot erase earlier frozen cutoffs or their source timestamps',async()=>{
  const store=new PersonalFeedStore(new ReconciliationStorage()),raw=fixture().packet;
  await store.accept(await envelope(raw));const original=await store.getLatest();
  for(const [time,snapshots]of [['2026-11-03T13:40:00Z',[]],['2026-11-03T13:45:00Z',raw.snapshots.slice(0,1)]]){
    const next=await envelope(at(raw,time,{snapshots,lastPrice:103}));await store.accept(next);const saved=await store.getLatest();
    assert.deepEqual(saved.packet.snapshots,original.packet.snapshots);assert.deepEqual(saved.checkpointProvenance,original.checkpointProvenance);
    assert.equal(saved.packet.last_price,103);assert.equal(saved.observedMs,next.observedMs);
    assert.ok(saved.reconciliation.missingCutoffs.includes('08:30'));assert.equal(saved.checkpointProvenance['03:00'].sourceObservedAt,original.packet.observed_at);
  }
});

test('NQ corrected prior low and AVR do not rewrite old decisions or prevent a genuinely new 08:30 checkpoint',async()=>{
  const storage=new ReconciliationStorage(),store=new PersonalFeedStore(storage),raw=fixture({market:'NQ'}).packet;
  const earlier=await envelope(at(raw,'2026-11-03T10:05:00Z',{snapshots:raw.snapshots.slice(0,2)}));await store.accept(earlier);const original=await store.getLatest();
  const revised=at(raw,'2026-11-03T13:35:00Z');
  for(const snapshot of revised.snapshots){snapshot.prior_low-=6.75;snapshot.avr+=.675;}
  const incoming=await envelope(revised);assert.equal((await store.accept(incoming)).status,'accepted');
  const saved=await store.getLatest();
  assert.deepEqual(saved.packet.snapshots.slice(0,2),original.packet.snapshots);
  assert.deepEqual(saved.packet.snapshots[2],incoming.packet.snapshots[2]);
  assert.notEqual(saved.packet.snapshots[2].avr,saved.packet.snapshots[0].avr);assert.equal(saved.packet.snapshots[2].prior_low,incoming.packet.snapshots[2].prior_low);
  assert.deepEqual(saved.reconciliation.addedCutoffs,['08:30']);assert.deepEqual(saved.reconciliation.revisedCutoffs,['03:00','05:00']);
  assert.ok(saved.reconciliation.changedFields['03:00'].includes('avr'));assert.ok(saved.reconciliation.changedFields['03:00'].includes('prior_low'));
  assert.equal(saved.checkpointProvenance['03:00'].sourceObservedAt,earlier.packet.observed_at);assert.equal(saved.checkpointProvenance['08:30'].sourceObservedAt,incoming.packet.observed_at);
  assert.equal(saved.packetHash,await sha256(JSON.stringify(saved.packet),testCrypto));
  assert.equal(validatePersonalRead({schema:'sessionpath.tradingview.read.v1',status:'ready',receivedAt:saved.receivedAt,packet:saved.packet},{market:'NQ',now:Date.parse(saved.receivedAt)}).snapshots.length,3);
  // Every source packet remains internally coherent. The explicitly labelled
  // first-accepted composite need not pretend to be one unrevised source packet.
  assert.throws(()=>normalizePacket({...saved.packet,token:'unused'},{now:Date.parse(saved.receivedAt)}),error=>error.code==='INCONSISTENT_SNAPSHOT_SEQUENCE');
});

test('repeated revised-source delivery is a duplicate and never manufactures heartbeat freshness',async()=>{
  const store=new PersonalFeedStore(new ReconciliationStorage()),raw=fixture().packet;await store.accept(await envelope(raw));
  const corrected=at(raw,'2026-11-03T13:40:00Z');for(const snapshot of corrected.snapshots)snapshot.asia_close-=.01;
  const incoming=await envelope(corrected);await store.accept(incoming);const accepted=await store.getLatest();
  assert.equal((await store.accept({...incoming,receivedAt:new Date(Date.parse(incoming.receivedAt)+200000).toISOString()})).status,'duplicate');
  assert.equal((await store.getLatest()).receivedAt,accepted.receivedAt);
  assert.equal((await store.accept(await envelope(raw))).status,'ignored');
});

test('new-day heartbeat archives the first-accepted composite and resets live cutoffs and provenance',async()=>{
  const storage=new ReconciliationStorage(),store=new PersonalFeedStore(storage),raw=fixture().packet;await store.accept(await envelope(raw));
  const corrected=at(raw,'2026-11-03T13:40:00Z');for(const snapshot of corrected.snapshots)snapshot.asia_close-=.01;await store.accept(await envelope(corrected));
  const previous=await store.getLatest();
  const next=at(raw,'2026-11-04T08:05:00Z',{snapshots:[]});next.session_date='2026-11-04';await store.accept(await envelope(next));
  const saved=await new PersonalFeedStore(storage).getLatest(),history=await new PersonalFeedStore(storage).getHistory('2026-11-03');
  assert.equal(saved.packet.session_date,'2026-11-04');assert.deepEqual(saved.packet.snapshots,[]);assert.deepEqual(saved.checkpointProvenance,{});
  assert.deepEqual(history.packet.snapshots,previous.packet.snapshots);assert.equal(history.packet.session_date,'2026-11-03');
});

test('legacy stored cutoffs retain truthful best-known provenance without inventing first-receipt timestamps',async()=>{
  const raw=fixture().packet,initial=await envelope(raw),storage=new ReconciliationStorage();await storage.put('latest',initial);
  const store=new PersonalFeedStore(storage);await store.accept(await envelope(at(raw,'2026-11-03T13:40:00Z',{snapshots:[]})));
  const saved=await store.getLatest();
  assert.deepEqual(saved.packet.snapshots,initial.packet.snapshots);
  for(const provenance of Object.values(saved.checkpointProvenance)){assert.equal(provenance.basis,'legacy-receipt');assert.equal(provenance.sourceObservedAt,initial.packet.observed_at);assert.equal(provenance.receivedAt,initial.receivedAt);}
});

test('untrusted or internally inconsistent source inputs are still rejected before reconciliation',()=>{
  const {packet,now}=fixture();packet.snapshots[2].avr+=.1;
  assert.throws(()=>normalizePacket(packet,{now}),error=>error.code==='INCONSISTENT_SNAPSHOT_SEQUENCE');
});

