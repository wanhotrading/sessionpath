import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalHandler, sha256} from '../router.mjs';
import {PersonalFeedStore} from '../state.mjs';
import {normalizePacket} from '../validation.mjs';
import {FakeStorage, fixture, testCrypto, WRITE_TOKEN} from './fixtures.mjs';

const histories=[
  {v:1,phases:[1,0,null,null],first03:null,latest_minutes:60,attempts_up:2,attempts_down:0,
    earlier_close:1,inherited:0,past_high:106,past_low:98,last_hour_rv:1.5},
  {v:1,phases:[1,0,1,null],first03:1,latest_minutes:15,attempts_up:3,attempts_down:0,
    earlier_close:1,inherited:0,past_high:108,past_low:97,last_hour_rv:1.25},
  {v:1,phases:[1,0,1,2],first03:1,latest_minutes:10,attempts_up:3,attempts_down:1,
    earlier_close:3,inherited:0,past_high:108,past_low:94,last_hour_rv:2.5}
];

function withHistory({market='CL',include=true}={}){
  const {packet,now}=fixture({market});
  for(const [i,snapshot] of packet.snapshots.entries()){
    Object.assign(snapshot,{range_high:histories[i].past_high,range_low:histories[i].past_low,asia_high:106});
    if(i===2)Object.assign(snapshot,{london_high:108,london_low:94});
    if(include)snapshot.bbox_history=structuredClone(histories[i]);
  }
  return {packet,now};
}

test('normalizes only completed phases for each CL, NQ and ES decision and strips auth',()=>{
  for(const market of ['CL','NQ','ES']){
    const {packet,now}=withHistory({market});
    const result=normalizePacket(packet,{now});
    assert.deepEqual(result.snapshots.map(s=>s.bbox_history),histories);
    assert.equal(result.token,undefined);
    const old=withHistory({market,include:false});
    for(const snapshot of normalizePacket(old.packet,{now}).snapshots)assert.equal(snapshot.bbox_history,undefined);
  }
});

test('GC and unverifiable optional history keep the ordinary forecast usable',()=>{
  const unsupported=withHistory({market:'GC'});
  assert(normalizePacket(unsupported.packet,{now:unsupported.now}).snapshots.every(s=>s.bbox_history===undefined));
  for(const modification of [
    h=>h.phases[3]=0,h=>h.phases[0]=2,h=>h.first03=0,h=>h.latest_minutes=55,
    h=>h.attempts_down=1,h=>h.earlier_close=3,h=>h.inherited=1,h=>h.past_high=105,
    h=>h.past_low=99,h=>h.last_hour_rv=-1,h=>h.v=2,h=>h.ignoredExtra='not-retained',
  ]){
    const {packet,now}=withHistory();
    modification(packet.snapshots[0].bbox_history);
    const result=normalizePacket(packet,{now});
    assert.equal(result.snapshots[0].bbox_history,undefined);
    assert.deepEqual(result.snapshots[1].bbox_history,histories[1]);
    assert.equal(result.snapshots[0].range_high,106);
  }
});

test('outside decision open does not create a prior breach',()=>{
  const {packet,now}=fixture({clock:'03:05',cutoffs:['03:00']});
  Object.assign(packet.snapshots[0],{
    reference_price:105.5,range_high:105.5,
    bbox_history:{v:1,phases:[0,0,null,null],first03:null,latest_minutes:null,attempts_up:0,
      attempts_down:0,earlier_close:0,inherited:0,past_high:102,past_low:98,last_hour_rv:.5}
  });
  const result=normalizePacket(packet,{now});
  assert.deepEqual(result.snapshots[0].bbox_history,packet.snapshots[0].bbox_history);
});

test('inconsistent later history cannot remove an earlier phase or undo an observed attempt',()=>{
  const {packet,now}=withHistory();
  packet.snapshots[1].bbox_history.attempts_up=1;
  const result=normalizePacket(packet,{now});
  assert.deepEqual(result.snapshots.map(s=>s.bbox_history),[histories[0],undefined,histories[2]]);
});

async function service(initialNow){
  let time=initialNow;
  const store=new PersonalFeedStore(new FakeStorage());
  const handler=createPersonalHandler({now:()=>time,cryptoImpl:testCrypto});
  const env={PUBLIC_AUTOFILL_ENABLED:'true',WRITE_TOKEN_HASH:await sha256(WRITE_TOKEN,testCrypto),PERSONAL_FEEDS:{getByName:()=>store}};
  const fetch=(path,init)=>handler(new Request('https://bbox.example'+path,init),env).then(async r=>({status:r.status,...await r.json()}));
  return {store,setTime(now){time=now;},
    post:packet=>fetch('/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(packet)}),
    live:()=>fetch('/api/autofill?market=CL'),
    history:()=>fetch('/api/history?market=CL&date=2026-11-03')};
}

test('authenticates additions, preserves frozen prices and history, and exposes the snapshot on live and dated reads',async()=>{
  const {packet,now}=withHistory();
  const original=withHistory({include:false}).packet;
  const worker=await service(now);
  assert.equal((await worker.post(original)).status,'accepted');
  const before=await worker.live();
  const addition=structuredClone(packet);
  addition.token='invalid';
  assert.equal((await worker.post(addition)).status,401);
  addition.token=WRITE_TOKEN;
  addition.last_price=101;
  worker.setTime(now+2500);
  const receivedAt=new Date(now+2500).toISOString();
  assert.equal((await worker.post(addition)).status,'accepted');
  const live=await worker.live();
  assert.equal(live.receivedAt,before.receivedAt);
  assert.equal(live.packet.last_price,before.packet.last_price);
  assert.equal(live.packet.token,undefined);
  assert.deepEqual(live.packet.snapshots.map(s=>s.bbox_history),histories);
  const {bboxHistory,...oldProvenance}=live.checkpointProvenance['03:00'];
  assert.equal(bboxHistory.receivedAt,receivedAt);
  assert.deepEqual(oldProvenance,before.checkpointProvenance['03:00']);
  const history=await worker.history();
  assert.deepEqual(history.packet.snapshots,live.packet.snapshots);
  assert.deepEqual(history.checkpointProvenance,live.checkpointProvenance);
  assert.equal((await worker.post(addition)).status,'duplicate');

  const revising=structuredClone(packet);
  revising.observed_at=new Date(Date.parse(packet.observed_at)+300000).toISOString();
  revising.sent_at=new Date(Date.parse(revising.observed_at)+1000).toISOString();
  revising.last_price=102;
  revising.snapshots[0].bbox_history.attempts_up=1;
  worker.setTime(now+300000);
  assert.equal((await worker.post(revising)).status,'accepted');
  const updated=await worker.live();
  assert.equal(updated.packet.last_price,102);
  assert.deepEqual(updated.packet.snapshots,live.packet.snapshots);
  assert.deepEqual(updated.checkpointProvenance,live.checkpointProvenance);
  assert.deepEqual((await worker.history()).packet.snapshots,live.packet.snapshots);
});

test('a revised snapshot cannot enrich frozen inputs that no longer match',async()=>{
  const {packet,now}=withHistory();
  const original=withHistory({include:false}).packet;
  const worker=await service(now);
  assert.equal((await worker.post(original)).status,'accepted');
  const next=structuredClone(packet);
  next.observed_at=new Date(Date.parse(packet.observed_at)+300000).toISOString();
  next.sent_at=new Date(Date.parse(next.observed_at)+1000).toISOString();
  next.snapshots[1].reference_price=102;
  worker.setTime(now+300000);
  assert.equal((await worker.post(next)).status,'accepted');
  const saved=await worker.live();
  assert.equal(saved.packet.snapshots[1].reference_price,100);
  assert.equal(saved.packet.snapshots[1].bbox_history,undefined);
  assert.deepEqual(saved.packet.snapshots[0].bbox_history,histories[0]);
  assert.deepEqual(saved.packet.snapshots[2].bbox_history,histories[2]);
});
