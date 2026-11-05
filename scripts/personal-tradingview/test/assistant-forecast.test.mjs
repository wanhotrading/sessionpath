import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {ASSISTANT_FORECAST_SCHEMA,ASSISTANT_WINDOWS,EXPLICIT_AVR_PROFILE,archivedForecastRecord,createForecastRequester,expansionResult,historicalFeedRecord,loadHistoricalForecast,mountAssistantForecastAdapter,supplementForecastRecord,validateForecastRequest,validateHistoricalRecord} from '../../../docs/assistant-forecast-adapter.mjs';
import {nyTimestamp,boxEstimate,enrichResearch} from '../../../docs/planner-v3.mjs';
import {readFile} from 'node:fs/promises';
import {makeForecastCode} from '../../../docs/indicator-v5.mjs';
import {fixture} from '../backend/test/fixtures.mjs';
import {normalizePacket} from '../backend/validation.mjs';

function harness({market='CL',window='03:00-05:00',cutoffs,clock}={}){
 const f=fixture({market,...(cutoffs?{cutoffs}:{}),...(clock?{clock}:{})});
 const state={now:f.now,body:{schema:'sessionpath.tradingview.read.v1',status:'ready',receivedAt:new Date(f.now).toISOString(),packet:normalizePacket(f.packet,{now:f.now})},applies:0,ready:true,replay:false,historical:false,context:'unchanged',calls:[]};
 const input={requestId:'test-request-1',market,window};
 const applySnapshot=({request,snapshot,packet})=>{
  state.applies++;state.context='applied';
  state.model={query:{date:packet.session_date,minute:request.minute,price:snapshot.reference_price,avr:snapshot.avr,rangeHigh:snapshot.range_high,rangeLow:snapshot.range_low},box:{n:40,upPoints:2,downPoints:1,upMedianPoints:1.5,downMedianPoints:.8,coverage:.5,interval:[.35,.65],touchUp:.4,touchDown:.45,extensionUpPoints:.7,extensionDownPoints:.3,endMinute:request.endMinute,dates:Array(40).fill('2026-10-30')},code:'EXACT-EXISTING-RENDERER-CODE',conditions:{year:'',nearestCaseLimit:50}};
 };
 const options={market,feedURL:'https://feed.example/api/autofill',isReady:()=>state.ready,isReplay:()=>state.replay,isHistorical:()=>state.historical,context:()=>state.context,applySnapshot,readForecast:()=>state.model,now:()=>state.now,fetchImpl:async(url,init)=>{state.calls.push({url:String(url),init});return Response.json(state.body);}};
 return {state,input,options,request:createForecastRequester(options)};
}

for(const market of ['CL','NQ','ES','GC'])for(const window of Object.keys(ASSISTANT_WINDOWS))test(`${market} ${window}: fresh checkpoint returns only the existing model and exact code`,async()=>{
 const h=harness({market,window}),result=await h.request(h.input);
 assert.equal(result.schema,ASSISTANT_FORECAST_SCHEMA);assert.equal(result.ok,true);assert.equal(h.state.applies,1);
 assert.equal(result.code,'EXACT-EXISTING-RENDERER-CODE');assert.equal(result.source.checkpoint,ASSISTANT_WINDOWS[window].cutoff);
 assert.deepEqual(result.range,{upper:102,lower:99,upPoints:2,downPoints:1,medianUpPoints:1.5,medianDownPoints:.8,orangeUpper:h.state.model.query.rangeHigh+.7,orangeLower:h.state.model.query.rangeLow-.3,extensionUpPoints:.7,extensionDownPoints:.3});
 assert.equal(result.probabilities.units,'fraction');assert.equal(result.probabilities.containment.n,40);assert.equal(result.probabilities.containment.k,20);assert.equal(result.probabilities.upperTouch.k,16);assert.equal(result.probabilities.lowerTouch.k,18);
 assert.deepEqual(result.probabilities.containment.interval,[.35,.65]);assert.equal(result.sampleCount,40);assert.ok(result.warnings.some(w=>w.includes('not a trade win rate')));
 assert.equal(new URL(h.state.calls[0].url).searchParams.get('market'),market);assert.equal(h.state.calls[0].init.credentials,'omit');assert.equal(h.state.calls[0].init.cache,'no-store');assert.equal(h.state.calls[0].init.headers,undefined,'public request never carries an API/private key');
});

test('strict requests cannot change model inputs, inject an endpoint, or cross markets',()=>{
 const h=harness();
 for(const input of [{...h.input,price:42},{...h.input,endpoint:'https://bad.example'},{...h.input,market:'NQ'},{...h.input,window:'09:00-16:00'},{...h.input,requestId:'<script>'}])assert.throws(()=>validateForecastRequest(input,'CL'));
});

for(const [flag,error]of [['replay','REPLAY_ACTIVE'],['historical','HISTORICAL_MODE'],['ready','RESEARCH_LOADING']])test(`${flag} is preserved and never auto-filled`,async()=>{
 const h=harness();h.state[flag]=flag!=='ready';const result=await h.request(h.input);
 assert.equal(result.ok,false);assert.equal(result.error.code,error);assert.equal(h.state.applies,0);assert.equal(h.state.calls.length,0);
});

test('a missing future checkpoint never falls back to an earlier window',async()=>{
 const h=harness({window:'05:00-08:30',cutoffs:['03:00'],clock:'04:00'}),result=await h.request(h.input);
 assert.equal(result.ok,false);assert.equal(result.error.code,'CHECKPOINT_UNAVAILABLE');assert.equal(h.state.applies,0);assert.equal(result.code,undefined);
});

test('stale, wrong-day, mismatched market and invalid AVR coverage packets never change inputs',async()=>{
 for(const mutate of [h=>h.state.now+=600000,h=>h.state.body.packet.session_date='2026-11-02',h=>h.state.body.packet.market='NQ',h=>h.state.body.packet.snapshots[0].avr_count=9]){
  const h=harness();mutate(h);const result=await h.request(h.input);assert.equal(result.ok,false);assert.equal(result.error.code,'FEED_UNAVAILABLE');assert.equal(h.state.applies,0);
 }
});

test('stopped CL and ES delivery reports the actual last confirmed bar without applying stale checkpoints',async()=>{
 for(const market of ['CL','ES']){
  const h=harness({market});h.state.body.status='stale';h.state.now+=105*60000;
  h.state.body.packet.token='never-echo-this-private-value';const result=await h.request(h.input);
  assert.equal(result.ok,false);assert.equal(result.error.code,'FEED_UNAVAILABLE');assert.equal(h.state.applies,0);assert.equal(result.code,undefined);
  assert.match(result.error.message,new RegExp(market+' has no recent validated TradingView deliveries'));assert.match(result.error.message,/2026-11-03 08:35 NY \(105 min ago\)/);assert.match(result.error.message,/sender alert and webhook/);assert.match(result.error.message,/cannot restart upstream/);assert.doesNotMatch(result.error.message,/never-echo|token|Bearer|fresh, verified/);assert.ok(result.error.message.length<400);
 }
});

test('profile and coverage failures retain a specific safe reason, not raw feed values',async()=>{
 const profile=harness();profile.state.body.packet.avr_profile='private-untrusted-profile-value';const p=await profile.request(profile.input);assert.match(p.error.message,/different data profile/);assert.doesNotMatch(p.error.message,/private-untrusted/);assert.equal(profile.state.applies,0);
 const coverage=harness();coverage.state.body.packet.snapshots[0].avr_count=9;const c=await coverage.request(coverage.input);assert.match(c.error.message,/timing or complete-session coverage checks/);assert.match(c.error.message,/Last confirmed bar/);assert.equal(coverage.state.applies,0);
});

test('a server-ready feed rejected by a mismatched browser clock gives clock guidance without weakening validation',async()=>{
 for(const delta of [-120000,600000]){
  const h=harness();h.state.now+=delta;const result=await h.request(h.input);assert.equal(result.ok,false);assert.equal(result.error.code,'FEED_UNAVAILABLE');assert.match(result.error.message,/server reports CL connected/);assert.match(result.error.message,/device.*automatic date\/time/);assert.equal(h.state.applies,0);
 }
});

test('editing inputs during a fetch preserves the edit and discards the fetched result',async()=>{
 const h=harness();h.options.fetchImpl=async()=>{h.state.context='manual edit';return Response.json(h.state.body);};
 const result=await createForecastRequester(h.options)(h.input);assert.equal(result.error.code,'INPUTS_CHANGED');assert.equal(h.state.applies,0);
});

test('output from a different checkpoint, date or endpoint cannot escape as a forecast',async()=>{
 for(const mutate of [h=>h.state.model.query.minute=300,h=>h.state.model.query.date='2026-11-02',h=>h.state.model.box.endMinute=960,h=>h.state.model.query.avr=123]){
  const h=harness(),apply=h.options.applySnapshot;h.options.applySnapshot=args=>{apply(args);mutate(h);};
  const result=await createForecastRequester(h.options)(h.input);assert.equal(result.ok,false);assert.equal(result.error.code,'FORECAST_MISMATCH');assert.equal(result.code,undefined);
 }
});

test('a disabled NY timing export stays blocked instead of exposing its code',async()=>{
 const h=harness({window:'08:30-16:00'}),apply=h.options.applySnapshot;h.options.applySnapshot=args=>{apply(args);h.state.model.exportBlocked=true;h.state.model.error='Select a confirmed breakout before exporting.';};
 const result=await createForecastRequester(h.options)(h.input);assert.equal(result.ok,false);assert.equal(result.error.code,'EXPORT_UNAVAILABLE');assert.equal(result.code,undefined);
});

test('NY structured export events supply actual renderer values, with no result-panel scraping',async t=>{
 const dom=new JSDOM('<!doctype html><main><p>Deliberately unrelated display text 999%</p></main>');t.after(()=>dom.window.close());
 const h=harness({window:'08:30-16:00'}),apply=h.options.applySnapshot;
 const bridge=mountAssistantForecastAdapter({...h.options,document:dom.window.document,readForecast:()=>null,applySnapshot:args=>{apply(args);dom.window.document.dispatchEvent(new dom.window.CustomEvent('sessionpath:forecast-export',{detail:{code:h.state.model.code,model:h.state.model}}));}});t.after(()=>bridge.destroy());
 const received=new Promise(resolve=>dom.window.document.addEventListener('sessionpath:assistant-result',event=>resolve(event.detail),{once:true}));
 dom.window.document.dispatchEvent(new dom.window.CustomEvent('sessionpath:assistant-request',{detail:h.input}));
 const result=await received;assert.equal(result.ok,true);assert.equal(result.requestId,h.input.requestId);assert.equal(result.code,h.state.model.code);assert.equal(result.range.upper,102);assert.equal(result.probabilities.containment.p,.5);
});

test('NY timing research pending export waits for the later ready code on the first attempt',async t=>{
 const dom=new JSDOM('<!doctype html><main></main>');t.after(()=>dom.window.close());
 const h=harness({window:'08:30-16:00'}),apply=h.options.applySnapshot;let readyTimer,readySent=false;
 const emit=model=>dom.window.document.dispatchEvent(new dom.window.CustomEvent('sessionpath:forecast-export',{detail:{code:model.code,model}}));
 const bridge=mountAssistantForecastAdapter({...h.options,document:dom.window.document,readForecast:()=>null,applySnapshot:args=>{
  apply(args);emit({...h.state.model,code:'PENDING-BASE-CODE',exportPending:true,exportBlocked:true,error:'Loading chart research…'});
  readyTimer=setTimeout(()=>{readySent=true;emit({...h.state.model,code:'READY-CODE-WITH-TIMING',exportPending:false,exportBlocked:false,error:''});},10);
 }});t.after(()=>{clearTimeout(readyTimer);bridge.destroy();});
 const result=await bridge.request(h.input);assert.equal(readySent,true);assert.equal(result.ok,true);assert.equal(result.code,'READY-CODE-WITH-TIMING');assert.equal(h.state.applies,1);
});

test('permanently blocked NY timing export still fails without waiting for another event',{timeout:1000},async t=>{
 const dom=new JSDOM('<!doctype html><main></main>');t.after(()=>dom.window.close());
 const h=harness({window:'08:30-16:00'}),apply=h.options.applySnapshot;
 const bridge=mountAssistantForecastAdapter({...h.options,document:dom.window.document,readForecast:()=>null,applySnapshot:args=>{
  apply(args);const model={...h.state.model,exportPending:false,exportBlocked:true,error:'Chart research unavailable. Choose Mean box code only.'};
  dom.window.document.dispatchEvent(new dom.window.CustomEvent('sessionpath:forecast-export',{detail:{code:model.code,model}}));
 }});t.after(()=>bridge.destroy());
 const result=await bridge.request(h.input);assert.equal(result.ok,false);assert.equal(result.error.code,'EXPORT_UNAVAILABLE');assert.match(result.error.message,/Chart research unavailable/);assert.equal(result.code,undefined);
});

test('a second concurrent request cannot overwrite the first request’s model',async()=>{
 const h=harness();let release;const held=new Promise(resolve=>release=resolve);h.options.fetchImpl=async()=>{await held;return Response.json(h.state.body);};const request=createForecastRequester(h.options);
 const first=request(h.input),second=await request({...h.input,requestId:'second'});assert.equal(second.error.code,'REQUEST_BUSY');release();assert.equal((await first).ok,true);assert.equal(h.state.applies,1);
});

test('compression probabilities retain their separate printed-AVR cohort and exact zero-expansion cases',()=>{
 const observations={avr:[
  {date:'2026-11-01',year:'2026',p03:.51,p05:.51},
  {date:'2026-11-02',year:'2026',p03:.60,p05:.90},
  {date:'2026-10-30',year:'2026',p03:.26,p05:.90},
  {date:'2026-11-03',year:'2026',p03:.51,p05:2}
 ]};
 const result=expansionResult(observations,{date:'2026-11-03',minute:180,endMinute:300,printed:.55,avr:5,year:'2026',tags:['SOME_TAG'],limit:1});
 assert.equal(result.sampleCount,2);assert.equal(result.noFurtherExpansion.p,.5);assert.equal(result.noFurtherExpansion.k,1);assert.equal(result.noFurtherExpansion.n,2);assert.equal(result.add25.p,.5);
 assert.equal(result.meanAddedAvr,.15000000000000002);assert.ok(result.cohort.includes('nearest-case limits do not filter'));
 assert.equal(result.conditions.printedBand,'50–<75%');
});

test('failure of optional expansion history keeps the actual mean box and code intact',async()=>{
 const h=harness();h.options.readExpansion=async()=>{throw Error('offline');};const result=await createForecastRequester(h.options)(h.input);
 assert.equal(result.ok,true);assert.equal(result.expansion,null);assert.equal(result.code,'EXACT-EXISTING-RENDERER-CODE');assert.equal(result.range.upper,102);assert.ok(result.warnings.some(w=>w.includes('compression/expansion history is unavailable')));
});

function historicalFixture(h){
 const request=validateForecastRequest({...h.input,date:'2026-11-02'},h.input.market,h.state.now),s=h.state.body.packet.snapshots.find(s=>s.cutoff===request.cutoff);
 const snapshot={...structuredClone(s),as_of:new Date(nyTimestamp(request.date,request.minute)).toISOString(),prior_ny_date:'2026-10-30',last_hour_behavior:'Lower finish'};
 for(const key of ['avr_dates','avr_count','avr_frozen_at'])delete snapshot[key];
 return {request,record:{market:request.market,date:request.date,contract:request.market+'Z2026',source:{provider:'TradingView native CSV',avrProfile:EXPLICIT_AVR_PROFILE},snapshot}};
}

test('dated input accepts only real dates, rejects future dates, and keeps explicit today on the live path',()=>{
 const h=harness();assert.equal(validateForecastRequest({...h.input,date:null},'CL',h.state.now).historical,false);
 assert.equal(validateForecastRequest({...h.input,date:'2026-11-03'},'CL',h.state.now).historical,false);
 assert.equal(validateForecastRequest({...h.input,date:'2026-11-02'},'CL',h.state.now).historical,true);
 assert.throws(()=>validateForecastRequest({...h.input,date:'2026-02-30'},'CL',h.state.now),{code:'INVALID_DATE'});
 assert.throws(()=>validateForecastRequest({...h.input,date:'2026-11-04'},'CL',h.state.now),{code:'FUTURE_DATE'});
});

for(const window of Object.keys(ASSISTANT_WINDOWS))test(`explicit historical ${window} can enter Replay and never fetches today’s packet`,async()=>{
 const h=harness({window}),{request,record}=historicalFixture(h);h.state.replay=true;h.state.historical=true;
 h.options.readHistorical=async()=>record;const apply=h.options.applySnapshot;h.options.applySnapshot=args=>{apply(args);h.state.replay=true;h.state.historical=false;};
 const result=await createForecastRequester(h.options)(request);
 // Request metadata is internal; callers may only pass the public schema.
 assert.equal(result.error.code,'INVALID_REQUEST');
 const success=await createForecastRequester(h.options)({...h.input,date:request.date});assert.equal(success.ok,true);assert.equal(success.mode,'historical');assert.equal(success.date,'2026-11-02');assert.equal(success.source.provider,'TradingView native CSV');assert.equal(success.source.avrProfile,EXPLICIT_AVR_PROFILE);assert.equal(h.state.calls.length,0);assert.equal(h.state.applies,1);
});

test('a historical request with no actual record never substitutes a live code or changes inputs',async()=>{
 const h=harness();h.options.readHistorical=async()=>null;const result=await createForecastRequester(h.options)({...h.input,date:'2026-11-02'});
 assert.equal(result.ok,false);assert.equal(result.error.code,'HISTORICAL_UNAVAILABLE');assert.equal(result.date,'2026-11-02');assert.equal(result.code,undefined);assert.equal(h.state.calls.length,0);assert.equal(h.state.applies,0);
});

test('historical metadata, contract basis and duplicate records are checked',()=>{
 const h=harness(),{request,record}=historicalFixture(h),payload={schema:'sessionpath.assistant.historical-inputs.v1',records:[record]};
 assert.equal(supplementForecastRecord(payload,request),record);
 for(const change of [r=>r.date='2026-11-01',r=>r.snapshot.as_of=new Date(nyTimestamp('2026-11-02',300)).toISOString(),r=>r.contract='NQZ2026',r=>r.snapshot.prior_ny_date='2026-11-02',r=>r.source.avrProfile='continuous-prior10-0930-1600-frozen-before1930-v1']){const invalid=structuredClone(record);change(invalid);assert.throws(()=>validateHistoricalRecord(invalid,request),{code:'HISTORICAL_UNAVAILABLE'});}
 assert.throws(()=>supplementForecastRecord({...payload,records:[record,record]},request),{code:'HISTORICAL_UNAVAILABLE'});
});

test('the historical server preserves original continuous-contract attestation without requiring freshness today',()=>{
 const h=harness(),request=validateForecastRequest({...h.input,date:'2026-11-03'},'CL',h.state.now+86400000);
 const body={...h.state.body,schema:'sessionpath.tradingview.history.v1',date:'2026-11-03',validationBasis:'authenticated_pine_attestation'};
 const record=historicalFeedRecord(body,request);assert.equal(record.contract,'CL1!');assert.equal(record.snapshot.cutoff,'03:00');assert.equal(record.source.provider,'TradingView personal Pine alert');assert.equal(record.source.avrProfile,h.state.body.packet.avr_profile);
 assert.equal(historicalFeedRecord({...body,validationBasis:'unverified'},request),null);assert.equal(historicalFeedRecord({...body,date:'2026-11-02'},request),null);
});

test('dated lookup prefers actual research/static inputs and uses only the dated history endpoint as its final fallback',async()=>{
 const h=harness(),{request,record}=historicalFixture(h);let calls=0;
 assert.equal(await loadHistoricalForecast({request,archive:record,loadSupplement:()=>{throw Error('must not run');},feedURL:'https://feed.example',fetchImpl:()=>{calls++;}}),record);
 assert.equal(await loadHistoricalForecast({request,archive:null,loadSupplement:async()=>({schema:'sessionpath.assistant.historical-inputs.v1',records:[record]}),feedURL:'https://feed.example',fetchImpl:()=>{calls++;}}),record);assert.equal(calls,0);
 await assert.rejects(loadHistoricalForecast({request,archive:null,loadSupplement:async()=>({schema:'sessionpath.assistant.historical-inputs.v1',records:[]}),feedURL:'https://feed.example/api/autofill',fetchImpl:async url=>{calls++;const parsed=new URL(url);assert.equal(parsed.pathname,'/api/history');assert.equal(parsed.searchParams.get('date'),'2026-11-02');return Response.json({schema:'sessionpath.tradingview.history.v1',status:'unavailable',date:'2026-11-02'});}}),{code:'HISTORICAL_UNAVAILABLE'});assert.equal(calls,1);
});

test('historical model output cannot include the target date or later dates in its sample',async()=>{
 const h=harness(),{record}=historicalFixture(h),apply=h.options.applySnapshot;h.options.readHistorical=async()=>record;h.options.applySnapshot=args=>{apply(args);h.state.model.box.dates[0]='2026-11-02';};
 const result=await createForecastRequester(h.options)({...h.input,date:'2026-11-02'});assert.equal(result.ok,false);assert.equal(result.error.code,'HISTORICAL_LOOKAHEAD');assert.equal(result.code,undefined);
});

test('real CL archive input reconstruction and forecast use no target/future outcome candles',async()=>{
 const base=new URL('../../../docs/',import.meta.url),json=async path=>JSON.parse(await readFile(new URL(path,base),'utf8'));
 const [rawDays,tags,extra,timeline]=await Promise.all(['data/days.json','data/tags.json','data/planner-extra.json','data/timeline.json'].map(json)),{days}=enrichResearch(rawDays,tags,extra);
 const request=validateForecastRequest({requestId:'real-archive',market:'CL',window:'03:00-05:00',date:'2026-09-24'},'CL',Date.parse('2026-11-05T12:00:00Z'));
 const record=validateHistoricalRecord(archivedForecastRecord(days,timeline,request),request);assert.equal(record.source.avrProfile,EXPLICIT_AVR_PROFILE);
 const mutated=structuredClone(timeline),day=days.find(d=>d.date===request.date),row=(Array.isArray(mutated)?mutated:mutated.rows).find(row=>row[0]===day.index),start=mutated.startMinute??-270,step=mutated.stepMinutes??mutated.step??5,from=(request.minute-start)/step;
 for(let i=from*3;i<row[2].length;i++)row[2][i]=99999999;
 assert.deepEqual(archivedForecastRecord(days,mutated,request),record,'after-cutoff H/L/C cannot change the decision snapshot');
 const s=record.snapshot,q={date:request.date,beforeDate:request.date,minute:request.minute,endMinute:request.endMinute,price:s.reference_price,avr:s.avr,printed:(s.range_high-s.range_low)/s.avr,rangeHigh:s.range_high,rangeLow:s.range_low,tags:[],observations:[],limit:50};
 const box=boxEstimate(days,timeline,q,request.endMinute),changed=boxEstimate(days,mutated,q,request.endMinute);assert.ok(box.n>0);assert.ok(box.dates.every(date=>date<request.date));assert.deepEqual(changed,box);assert.equal(makeForecastCode(changed,q),makeForecastCode(box,q));
});

for(const [market,directory]of [['CL','data/'],['NQ','data/nq/'],['ES','es/data/es/'],['GC','gc/data/gc/']])test(`${market}: all three real research checkpoints preserve actual dated contract and session positions`,async()=>{
 const base=new URL('../../../docs/',import.meta.url),json=async name=>JSON.parse(await readFile(new URL(directory+name,base),'utf8')),[days,timeline]=await Promise.all(['days.json','timeline.json'].map(json));
 for(const window of Object.keys(ASSISTANT_WINDOWS)){
  const request=validateForecastRequest({requestId:'actual-'+market,market,window,date:'2026-09-24'},market,Date.parse('2026-11-05T12:00:00Z')),record=validateHistoricalRecord(archivedForecastRecord(days,timeline,request),request);
  assert.equal(record.market,market);assert.equal(record.date,'2026-09-24');assert.match(record.contract,new RegExp('^'+market));assert.equal(record.snapshot.cutoff,request.cutoff);assert.equal(record.snapshot.asia_complete,true);assert.equal(record.snapshot.london_complete,request.minute===510);assert.ok(record.snapshot.prior_ny_date<record.date);
 }
});

function assistantReplayHarness(){
 const h=harness(),{record}=historicalFixture(h),apply=h.options.applySnapshot;h.state.prepares=0;
 h.options.readHistorical=async()=>record;
 h.options.applySnapshot=args=>{apply(args);if(args.request.historical)h.state.replay=true;};
 h.options.prepareLive=({packet,snapshot})=>{h.state.prepares++;assert.equal(packet.session_date,'2026-11-03');assert.equal(snapshot.cutoff,'03:00');h.state.replay=false;h.state.context='verified today inputs prepared';};
 return {...h,run:createForecastRequester(h.options)};
}

test('an assistant historical forecast can return to today after the fresh live checkpoint is validated',async()=>{
 const h=assistantReplayHarness();assert.equal((await h.run({...h.input,date:'2026-11-02'})).mode,'historical');assert.equal(h.state.replay,true);assert.equal(h.state.calls.length,0);
 const today=await h.run({...h.input,date:null});assert.equal(today.ok,true);assert.equal(today.mode,'live');assert.equal(today.date,'2026-11-03');assert.equal(h.state.prepares,1);assert.equal(h.state.replay,false);assert.equal(h.state.calls.length,1);assert.equal(h.state.model.query.date,'2026-11-03');
});

test('a stale live feed cannot exit the assistant historical view or relabel its inputs as today',async()=>{
 const h=assistantReplayHarness();await h.run({...h.input,date:'2026-11-02'});h.state.now+=600000;
 const result=await h.run({...h.input,date:null});assert.equal(result.ok,false);assert.equal(result.error.code,'FEED_UNAVAILABLE');assert.equal(h.state.prepares,0);assert.equal(h.state.replay,true);assert.equal(h.state.model.query.date,'2026-11-02');assert.equal(h.state.applies,1);
});

test('manual Replay ownership and edits stay protected even when a prepareLive callback is available',async()=>{
 const first=assistantReplayHarness();first.state.replay=true;const initial=await first.run({...first.input,date:null});assert.equal(initial.error.code,'REPLAY_ACTIVE');assert.equal(first.state.calls.length,0);assert.equal(first.state.prepares,0);
 const changed=assistantReplayHarness();await changed.run({...changed.input,date:'2026-11-02'});changed.state.context='manual Replay date or inputs';const manual=await changed.run({...changed.input,date:null});assert.equal(manual.error.code,'REPLAY_ACTIVE');assert.equal(changed.state.prepares,0);
 const released=assistantReplayHarness();await released.run({...released.input,date:'2026-11-02'});released.run.resetHistoricalOwnership();const result=await released.run({...released.input,date:null});assert.equal(result.error.code,'REPLAY_ACTIVE');assert.equal(released.state.prepares,0);
});

