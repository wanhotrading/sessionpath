import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {fixture,WRITE_TOKEN,READ_TOKEN} from '../backend/test/fixtures.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
test('Workers runtime authenticates, persists SQLite DO state across restart and isolates markets',async()=>{
 const {packet,now}=fixture();
 const source=(await readFile(new URL('../backend/worker.bundle.mjs',import.meta.url),'utf8')).replace('fetch:createPersonalHandler()','fetch:createPersonalHandler({now:()=>'+now+'})');
 const persist=await mkdtemp(path.join(tmpdir(),'sessionpath-personal-runtime-'));
 // The installed official workerd release supports through 2026-08-06.
 // Production's requested compatibility date is checked by Cloudflare upload.
 const options={modules:true,script:source,compatibilityDate:'2026-08-06',durableObjects:{PERSONAL_FEEDS:{className:'PersonalFeed',useSQLite:true}},bindings:{READ_TOKEN_HASH:hash(READ_TOKEN),WRITE_TOKEN_HASH:hash(WRITE_TOKEN),PUBLIC_AUTOFILL_ENABLED:'true'},durableObjectsPersist:persist,log:new Log(LogLevel.ERROR)};
 const post=packet=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(packet)});
 const get={headers:{Authorization:'Bearer '+READ_TOKEN,Origin:'https://wanhotrading.github.io'}};
 let mf=new Miniflare(options);
 try{
  assert.equal((await mf.dispatchFetch('http://bridge/api/snapshots?market=CL')).status,401);
  assert.equal((await (await mf.dispatchFetch('http://bridge/api/autofill?market=CL')).json()).status,'waiting');
  assert.equal((await mf.dispatchFetch('http://bridge/webhook',post({...packet,token:READ_TOKEN}))).status,401);
  assert.deepEqual(await (await mf.dispatchFetch('http://bridge/webhook',post(packet))).json(),{status:'accepted'});
  assert.deepEqual(await (await mf.dispatchFetch('http://bridge/webhook',post(packet))).json(),{status:'duplicate'});
  const r=await mf.dispatchFetch('http://bridge/api/snapshots?market=CL',get),body=await r.json();
  assert.equal(body.status,'ready');assert.equal(body.packet.token,undefined);assert.equal(body.packet.snapshots.length,3);
  assert.equal(r.headers.get('cache-control'),'no-store, max-age=0');
  const publicResponse=await mf.dispatchFetch('http://bridge/api/autofill?market=CL',{headers:{Origin:'https://wanhotrading.github.io'}});
  assert.deepEqual(await publicResponse.json(),body);
  assert.equal(publicResponse.headers.get('access-control-allow-origin'),'https://wanhotrading.github.io');
  const historical=await (await mf.dispatchFetch('http://bridge/api/history?market=CL&date=2026-11-03')).json();
  assert.equal(historical.schema,'sessionpath.tradingview.history.v1');assert.equal(historical.status,'ready');assert.deepEqual(historical.packet,body.packet);
  assert.equal((await mf.dispatchFetch('http://bridge/api/autofill?market=INVALID')).status,400);
  assert.equal((await (await mf.dispatchFetch('http://bridge/api/snapshots?market=NQ',get)).json()).status,'waiting');
  await mf.dispose();mf=new Miniflare(options);
  const recovered=await (await mf.dispatchFetch('http://bridge/api/snapshots?market=CL',get)).json();
  assert.deepEqual(recovered,body);
  assert.deepEqual(await (await mf.dispatchFetch('http://bridge/api/autofill?market=CL')).json(),body);
  assert.deepEqual(await (await mf.dispatchFetch('http://bridge/api/history?market=CL&date=2026-11-03')).json(),historical);
  const changed=structuredClone(packet);changed.observed_at='2026-11-03T13:40:00Z';changed.sent_at=changed.observed_at;changed.snapshots[0].reference_price=101;
  // Future timestamps fail before they can alter persisted values.
  assert.equal((await mf.dispatchFetch('http://bridge/webhook',post(changed))).status,400);
  assert.deepEqual(await (await mf.dispatchFetch('http://bridge/api/snapshots?market=CL',get)).json(),body);
 }finally{await mf.dispose();}
});
