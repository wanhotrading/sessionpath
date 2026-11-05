import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalHandler,sha256} from '../router.mjs';
import {PersonalFeedStore} from '../state.mjs';
import {fixture,FakeStorage,testCrypto,WRITE_TOKEN,READ_TOKEN} from './fixtures.mjs';

class HistoryStorage extends FakeStorage{async delete(key){return this.values.delete(key);}}
async function setup(){
 const clock=fixture(),storage=new HistoryStorage(),stores=new Map();
 const env={PUBLIC_AUTOFILL_ENABLED:'true',READ_TOKEN_HASH:await sha256(READ_TOKEN,testCrypto),WRITE_TOKEN_HASH:await sha256(WRITE_TOKEN,testCrypto),PERSONAL_FEEDS:{getByName(market){if(!stores.has(market))stores.set(market,new PersonalFeedStore(market==='CL'?storage:new HistoryStorage()));return stores.get(market);}}};
 return {clock,storage,env,stores,handler:createPersonalHandler({now:()=>clock.now,cryptoImpl:testCrypto})};
}
const post=packet=>new Request('https://bridge.example/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(packet)});
const history=(date='2026-11-03',market='CL',origin='https://wanhotrading.github.io')=>new Request(`https://bridge.example/api/history?market=${market}&date=${date}`,{headers:origin?{Origin:origin}:{}});

test('dated public history survives next-session heartbeat and process reconstruction without weakening live freshness',async()=>{
 const s=await setup();await s.handler(post(s.clock.packet),s.env);
 const original=await (await s.handler(history(),s.env)).json();
 const next={...s.clock.packet,session_date:'2026-11-04',observed_at:'2026-11-04T08:05:00Z',sent_at:'2026-11-04T08:05:01Z',snapshots:[]};
 s.clock.now=Date.parse(next.sent_at)+1000;await s.handler(post(next),s.env);
 s.stores.set('CL',new PersonalFeedStore(s.storage));
 const body=await (await s.handler(history(),s.env)).json();
 assert.deepEqual(body,original);assert.equal(body.status,'ready');assert.equal(body.schema,'sessionpath.tradingview.history.v1');
 assert.equal(body.packet.session_date,'2026-11-03');assert.equal(body.packet.snapshots.length,3);
 assert.equal((await (await s.handler(new Request('https://bridge.example/api/autofill?market=CL'),s.env)).json()).status,'waiting');
});
test('unchanged heartbeats and preserved source revisions cannot change the original archived receipt',async()=>{
 const s=await setup();await s.handler(post(s.clock.packet),s.env);const initial=await (await s.handler(history(),s.env)).json();
 const newer=structuredClone(s.clock.packet);newer.observed_at='2026-11-03T13:40:00Z';newer.sent_at='2026-11-03T13:40:01Z';s.clock.now=Date.parse(newer.sent_at)+1000;
 assert.equal((await s.handler(post(newer),s.env)).status,200);assert.deepEqual(await (await s.handler(history(),s.env)).json(),initial);
 newer.observed_at='2026-11-03T13:45:00Z';newer.sent_at='2026-11-03T13:45:01Z';s.clock.now+=300000;newer.snapshots[0].reference_price=101;
 assert.equal((await s.handler(post(newer),s.env)).status,200);assert.deepEqual(await (await s.handler(history(),s.env)).json(),initial);
 assert.equal((await s.stores.get('CL').getLatest()).observedMs,Date.parse(newer.observed_at));
});
test('legacy latest record is available and archived before rollover without a migration',async()=>{
 const s=await setup();await s.handler(post(s.clock.packet),s.env);const current=await s.storage.get('latest');
 const old=new HistoryStorage();await old.put('latest',current);const store=new PersonalFeedStore(old);
 assert.deepEqual(await store.getHistory('2026-11-03'),current);
 await store.accept({...current,observedMs:current.observedMs+86400000,packetHash:'next',snapshotHashes:{},packet:{...current.packet,session_date:'2026-11-04',snapshots:[]}});
 assert.deepEqual(await store.getHistory('2026-11-03'),current);
});
test('history adds completed cutoffs but never stores an empty heartbeat',async()=>{
 const s=await setup();const first=structuredClone(s.clock.packet);first.snapshots=first.snapshots.slice(0,1);
 await s.handler(post(first),s.env);assert.equal((await (await s.handler(history(),s.env)).json()).packet.snapshots.length,1);
 s.clock.packet.observed_at='2026-11-03T13:40:00Z';s.clock.packet.sent_at='2026-11-03T13:40:01Z';s.clock.now=Date.parse(s.clock.packet.sent_at)+1000;
 await s.handler(post(s.clock.packet),s.env);assert.equal((await (await s.handler(history(),s.env)).json()).packet.snapshots.length,3);
 const next={...s.clock.packet,session_date:'2026-11-04',observed_at:'2026-11-04T08:05:00Z',sent_at:'2026-11-04T08:05:01Z',snapshots:[]};s.clock.now=Date.parse(next.sent_at)+1000;await s.handler(post(next),s.env);
 assert.equal((await (await s.handler(history('2026-11-04'),s.env)).json()).status,'unavailable');
});
test('history is opt-in, market-isolated, read-only and does not expose credentials',async()=>{
 const s=await setup();await s.handler(post(s.clock.packet),s.env);
 assert.equal((await s.handler(history(),{...s.env,PUBLIC_AUTOFILL_ENABLED:undefined})).status,404);
 assert.equal((await s.handler(history('2026-11-03','CL','https://evil.example'),s.env)).status,403);
 assert.equal((await (await s.handler(history('2026-11-03','NQ'),s.env)).json()).status,'unavailable');
 const response=await s.handler(history(),s.env),body=JSON.stringify(await response.json());
 for(const secret of [WRITE_TOKEN,READ_TOKEN,s.env.WRITE_TOKEN_HASH,s.env.READ_TOKEN_HASH])assert.ok(!body.includes(secret));
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://wanhotrading.github.io');assert.equal(response.headers.get('Access-Control-Allow-Credentials'),null);
 assert.equal((await s.handler(new Request('https://bridge.example/api/history?market=CL&date=2026-11-03',{method:'POST'}),s.env)).status,404);
 assert.equal((await s.handler(new Request('https://bridge.example/api/snapshots?market=CL'),s.env)).status,401);
});
test('history rejects invalid, future, duplicate and credential query fields',async()=>{
 const s=await setup();for(const query of ['market=CL','market=CL&date=2026-02-30','market=CL&date=2027-01-01','market=CL&date=2026-11-03&date=2026-11-02','market=YM&date=2026-11-03','market=CL&date=2026-11-03&token=secret']){
  const response=await s.handler(new Request('https://bridge.example/api/history?'+query),s.env);assert.equal(response.status,400,query);assert.deepEqual(await response.json(),{error:'INVALID_QUERY'});
 }
 assert.equal(s.stores.size,0);
});
test('history retains a bounded chronological set and deletes only its own oldest record',async()=>{
 const storage=new HistoryStorage(),store=new PersonalFeedStore(storage,{historyLimit:2});
 await storage.put('unrelated','keep');
 for(const [i,date]of ['2026-11-02','2026-11-03','2026-11-04'].entries())await store.accept({packet:{session_date:date,snapshots:[{cutoff:'03:00'}]},snapshotHashes:{'03:00':date},observedMs:i,packetHash:date,receivedAt:date});
 assert.equal(await store.getHistory('2026-11-02'),null);assert.ok(await store.getHistory('2026-11-03'));assert.ok(await store.getHistory('2026-11-04'));assert.equal(await storage.get('unrelated'),'keep');
});

