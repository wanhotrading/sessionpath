import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalHandler,sha256,authenticateToken,MAX_BODY_BYTES} from '../router.mjs';
import {PersonalFeedStore} from '../state.mjs';
import {fixture,FakeStorage,testCrypto,WRITE_TOKEN,READ_TOKEN} from './fixtures.mjs';

async function setup(){const data=fixture(),stores=new Map();const env={READ_TOKEN_HASH:await sha256(READ_TOKEN,testCrypto),WRITE_TOKEN_HASH:await sha256(WRITE_TOKEN,testCrypto),PERSONAL_FEEDS:{getByName(market){if(!stores.has(market))stores.set(market,new PersonalFeedStore(new FakeStorage()));return stores.get(market);}}};return {...data,env,stores,handler:createPersonalHandler({now:()=>data.now,cryptoImpl:testCrypto}),clock:data};}
function post(packet,extras={}){return new Request('https://bridge.example/webhook',{method:'POST',headers:{'Content-Type':'application/json',...extras},body:JSON.stringify(packet)});}
function get(market='CL',token=READ_TOKEN,origin='https://wanhotrading.github.io'){return new Request('https://bridge.example/api/snapshots?market='+market,{headers:{Authorization:'Bearer '+token,...(origin?{Origin:origin}:{})}});}
function publicGet(market='CL',origin='https://wanhotrading.github.io'){return new Request('https://bridge.example/api/autofill?market='+market,{headers:origin?{Origin:origin}:{}});}

test('public health exposes no state; reads and writes require independent scoped tokens',async()=>{const s=await setup();assert.equal((await s.handler(new Request('https://bridge.example/health'),s.env)).status,200);assert.equal((await s.handler(get('CL',WRITE_TOKEN),s.env)).status,401);s.packet.token=READ_TOKEN;assert.equal((await s.handler(post(s.packet),s.env)).status,401);assert.equal(s.stores.size,0);});
test('ingest/read full flow persists no token and isolates four markets',async()=>{const s=await setup();assert.equal((await s.handler(post(s.packet),s.env)).status,200);const response=await s.handler(get(),s.env);const b=await response.json();assert.equal(b.schema,'sessionpath.tradingview.read.v1');assert.equal(b.status,'ready');assert.equal(b.packet.snapshots.length,3);assert.equal(b.packet.token,undefined);assert.equal(response.headers.get('cache-control'),'no-store, max-age=0');assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://wanhotrading.github.io');assert.equal((await (await s.handler(get('NQ'),s.env)).json()).status,'waiting');assert.ok(!JSON.stringify(await s.stores.get('CL').getLatest()).includes(WRITE_TOKEN));});
test('read returns stale after feed silence; duplicate must not refresh receipt timestamp',async()=>{const s=await setup();await s.handler(post(s.packet),s.env);const first=(await s.stores.get('CL').getLatest()).receivedAt;s.clock.now+=10000;assert.equal((await (await s.handler(post(s.packet),s.env)).json()).status,'duplicate');assert.equal((await s.stores.get('CL').getLatest()).receivedAt,first);s.clock.now+=480000;assert.equal((await (await s.handler(get(),s.env)).json()).status,'stale');});
test('newer packet cannot revise or remove a frozen cutoff',async()=>{const s=await setup();await s.handler(post(s.packet),s.env);s.packet.observed_at='2026-11-03T13:40:00.000Z';s.packet.sent_at='2026-11-03T13:40:01.000Z';s.clock.now=Date.parse(s.packet.sent_at)+1000;s.packet.snapshots[2].reference_price=101;const r=await s.handler(post(s.packet),s.env);assert.equal(r.status,409);assert.equal((await r.json()).error,'IMMUTABLE_SNAPSHOT');assert.equal((await s.stores.get('CL').getLatest()).packet.snapshots[2].reference_price,100);s.packet.snapshots=[];assert.equal((await s.handler(post(s.packet),s.env)).status,409);});
test('monotonic observations reject old packets; new session can clear snapshots',async()=>{const s=await setup();await s.handler(post(s.packet),s.env);const later=structuredClone(s.packet);later.observed_at='2026-11-03T13:40:00.000Z';later.sent_at='2026-11-03T13:40:01.000Z';s.clock.now=Date.parse(later.sent_at)+1000;assert.equal((await (await s.handler(post(later),s.env)).json()).status,'accepted');s.clock.now=Date.parse(s.packet.sent_at)+1000;assert.equal((await (await s.handler(post(s.packet),s.env)).json()).status,'ignored');s.clock.now=Date.parse('2026-11-04T00:35:02Z');later.observed_at='2026-11-04T00:35:00.000Z';later.sent_at='2026-11-04T00:35:01.000Z';later.session_date='2026-11-04';later.snapshots=[];assert.equal((await s.handler(post(later),s.env)).status,200);assert.equal((await (await s.handler(get(),s.env)).json()).status,'waiting');});
test('CORS allows GET Authorization preflight with market; denies other origins and headers',async()=>{const s=await setup();const options=headers=>new Request('https://bridge.example/api/snapshots?market=CL',{method:'OPTIONS',headers});assert.equal((await s.handler(options({Origin:'https://wanhotrading.github.io','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'}),s.env)).status,204);assert.equal((await s.handler(get('CL',READ_TOKEN,'https://evil.example'),s.env)).status,403);assert.equal((await s.handler(options({Origin:'https://wanhotrading.github.io','Access-Control-Request-Method':'POST'}),s.env)).status,403);});
test('query tokens, webhook Authorization, wrong route/method fail closed',async()=>{const s=await setup();for(const path of ['/api/snapshots?market=CL&token=secret','/api/snapshots?market=CL&market=NQ'])assert.equal((await s.handler(new Request('https://bridge.example'+path,{headers:{Authorization:'Bearer '+READ_TOKEN}}),s.env)).status,400);assert.equal((await s.handler(post(s.packet,{Authorization:'Bearer '+WRITE_TOKEN}),s.env)).status,400);assert.equal((await s.handler(new Request('https://bridge.example/webhook'),s.env)).status,404);});
test('bounded streaming rejects body with missing Content-Length once over16KiB',async()=>{const s=await setup();const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(' '.repeat(MAX_BODY_BYTES+1)));c.close();}});const r=await s.handler(new Request('https://bridge.example/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:stream,duplex:'half'}),s.env);assert.equal(r.status,413);assert.equal(s.stores.size,0);});
test('invalid JSON, missing config and storage error produce fixed messages without secrets',async()=>{const s=await setup();assert.equal((await s.handler(new Request('https://bridge.example/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"token":'}),s.env)).status,400);const env={...s.env,READ_TOKEN_HASH:undefined};assert.equal((await s.handler(get(),env)).status,503);s.env.PERSONAL_FEEDS.getByName=()=>{throw Error('secret database diagnostic '+WRITE_TOKEN);};const r=await s.handler(post(s.packet),s.env);assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'SERVICE_UNAVAILABLE'});});
test('native timing-safe SHA auth rejects absent or wrong tokens',async()=>{const hash=await sha256(READ_TOKEN,testCrypto);assert.equal(await authenticateToken(READ_TOKEN,hash,testCrypto),true);assert.equal(await authenticateToken(WRITE_TOKEN,hash,testCrypto),false);assert.equal(await authenticateToken(undefined,hash,testCrypto),false);});
test('transaction storage persists across store reconstruction and serializes concurrent updates',async()=>{const storage=new FakeStorage(),store=new PersonalFeedStore(storage),s=await setup();await s.handler(post(s.packet),s.env);const envelope=await s.stores.get('CL').getLatest(),later={...envelope,observedMs:envelope.observedMs+300000,packetHash:'later'};await Promise.all([store.accept(later),store.accept(envelope)]);assert.equal((await new PersonalFeedStore(storage).getLatest()).packetHash,'later');assert.equal(storage.puts,1);});

test('public autofill fails closed unless the flag is exactly the string true',async()=>{
  const s=await setup();
  for(const flag of [undefined,false,true,'false','TRUE','1','']){
    s.env.PUBLIC_AUTOFILL_ENABLED=flag;
    const r=await s.handler(publicGet(),s.env);
    assert.equal(r.status,404);assert.deepEqual(await r.json(),{error:'NOT_FOUND'});
  }
  assert.equal(s.stores.size,0);
  s.env.PUBLIC_AUTOFILL_ENABLED='true';
  assert.equal((await s.handler(publicGet(),s.env)).status,200);
});

test('enabled public autofill returns the same validated packet without any browser credential',async()=>{
  const s=await setup();s.env.PUBLIC_AUTOFILL_ENABLED='true';
  assert.equal((await s.handler(post(s.packet),s.env)).status,200);
  const privateBody=await (await s.handler(get(),s.env)).json();
  const response=await s.handler(publicGet(),s.env),body=await response.json();
  assert.deepEqual(body,privateBody);assert.equal(body.status,'ready');
  assert.equal(body.packet.token,undefined);
  assert.equal(response.headers.get('Cache-Control'),'no-store, max-age=0');
  assert.equal(response.headers.get('CDN-Cache-Control'),'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://wanhotrading.github.io');
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'),null);
  for(const secret of [READ_TOKEN,WRITE_TOKEN,s.env.READ_TOKEN_HASH,s.env.WRITE_TOKEN_HASH])assert.ok(!JSON.stringify(body).includes(secret));
  const noReadSecret={...s.env,READ_TOKEN_HASH:undefined};
  assert.equal((await s.handler(publicGet('CL',null),noReadSecret)).status,200);
  assert.equal((await s.handler(get(),noReadSecret)).status,503);
});

test('public autofill isolates markets and reports no feed or empty checkpoints as waiting',async()=>{
  const s=await setup();s.env.PUBLIC_AUTOFILL_ENABLED='true';
  for(const market of ['CL','NQ','ES','GC']){
    const body=await (await s.handler(publicGet(market),s.env)).json();
    assert.equal(body.status,'waiting');assert.equal(body.packet,null);assert.equal(body.receivedAt,null);
  }
  const empty={...s.packet,snapshots:[]};
  assert.equal((await s.handler(post(empty),s.env)).status,200);
  const body=await (await s.handler(publicGet(),s.env)).json();
  assert.equal(body.status,'waiting');assert.equal(body.packet.market,'CL');assert.deepEqual(body.packet.snapshots,[]);
  assert.equal((await (await s.handler(publicGet('NQ'),s.env)).json()).packet,null);
});

test('public and private reads apply identical eight-minute and target-session freshness checks',async()=>{
  const s=await setup();s.env.PUBLIC_AUTOFILL_ENABLED='true';
  await s.handler(post(s.packet),s.env);
  s.clock.now+=480001;
  assert.equal((await (await s.handler(publicGet(),s.env)).json()).status,'stale');
  assert.deepEqual(await (await s.handler(publicGet(),s.env)).json(),await (await s.handler(get(),s.env)).json());
  const latest=await s.stores.get('CL').getLatest();
  const fake={...s.env,PERSONAL_FEEDS:{getByName(){return {getLatest:async()=>({...latest,observedMs:s.clock.now,receivedAt:new Date(s.clock.now).toISOString(),packet:{...latest.packet,session_date:'2026-11-02'}})};}}};
  assert.equal((await (await s.handler(publicGet(),fake)).json()).status,'stale');
  const staleReceipt={...s.env,PERSONAL_FEEDS:{getByName(){return {getLatest:async()=>({...latest,observedMs:s.clock.now,receivedAt:new Date(s.clock.now-480001).toISOString()})};}}};
  assert.equal((await (await s.handler(publicGet(),staleReceipt)).json()).status,'stale');
});

test('public autofill accepts exactly one supported market and no credential or extra query fields',async()=>{
  const s=await setup();s.env.PUBLIC_AUTOFILL_ENABLED='true';
  for(const query of ['', '?market=', '?market=cl', '?market=YM', '?market=CL&market=NQ', '?market=CL&token=secret', '?market=CL&auth=secret', '?market=CL&cutoff=03:00']){
    const r=await s.handler(new Request('https://bridge.example/api/autofill'+query),s.env);
    assert.equal(r.status,400,query);assert.deepEqual(await r.json(),{error:'INVALID_QUERY'});
  }
  assert.equal(s.stores.size,0);
});

test('public autofill permits the GitHub origin and server-side requests but rejects foreign origins',async()=>{
  const s=await setup();s.env.PUBLIC_AUTOFILL_ENABLED='true';
  const noOrigin=await s.handler(publicGet('CL',null),s.env);
  assert.equal(noOrigin.status,200);assert.equal(noOrigin.headers.get('Access-Control-Allow-Origin'),null);
  const denied=await s.handler(publicGet('CL','https://evil.example'),s.env);
  assert.equal(denied.status,403);assert.equal(denied.headers.get('Access-Control-Allow-Origin'),null);
});

test('public preflight is opt-in GET only without privileged headers; private Authorization preflight remains unchanged',async()=>{
  const s=await setup();
  const preflight=(extra={})=>new Request('https://bridge.example/api/autofill?market=CL',{method:'OPTIONS',headers:{Origin:'https://wanhotrading.github.io','Access-Control-Request-Method':'GET',...extra}});
  assert.equal((await s.handler(preflight(),s.env)).status,403);
  s.env.PUBLIC_AUTOFILL_ENABLED='true';
  const r=await s.handler(preflight(),s.env);
  assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Methods'),'GET');assert.equal(r.headers.get('Access-Control-Allow-Headers'),null);
  assert.equal((await s.handler(preflight({'Access-Control-Request-Headers':'authorization'}),s.env)).status,403);
  assert.equal((await s.handler(preflight({'Access-Control-Request-Method':'POST'}),s.env)).status,403);
});

test('public opt-in never opens private reads, webhook writes, or other methods',async()=>{
  const s=await setup();
  for(const enabled of [undefined,'true']){
    s.env.PUBLIC_AUTOFILL_ENABLED=enabled;
    assert.equal((await s.handler(new Request('https://bridge.example/api/snapshots?market=CL'),s.env)).status,401);
    assert.equal((await s.handler(get('CL',WRITE_TOKEN),s.env)).status,401);
    for(const token of [undefined,READ_TOKEN])assert.equal((await s.handler(post({...s.packet,token}),s.env)).status,401);
    assert.equal((await s.handler(new Request('https://bridge.example/api/autofill?market=CL',{method:'POST'}),s.env)).status,404);
  }
  assert.equal(s.stores.size,0);
  assert.equal((await s.handler(post(s.packet),s.env)).status,200);
  assert.equal((await s.handler(get(),s.env)).status,200);
});

test('public read errors never echo secrets or storage diagnostics',async()=>{
  const s=await setup();s.env.PUBLIC_AUTOFILL_ENABLED='true';
  s.env.PERSONAL_FEEDS.getByName=()=>{throw Error('private diagnostic '+READ_TOKEN+' '+WRITE_TOKEN);};
  const r=await s.handler(publicGet(),s.env);
  assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'SERVICE_UNAVAILABLE'});
});
