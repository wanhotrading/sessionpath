import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {ASSISTANT_FORECAST_SCHEMA,ASSISTANT_WINDOWS,createForecastRequester,expansionResult,mountAssistantForecastAdapter,validateForecastRequest} from '../../../docs/assistant-forecast-adapter.mjs';
import {fixture} from '../backend/test/fixtures.mjs';
import {normalizePacket} from '../backend/validation.mjs';

function harness({market='CL',window='03:00-05:00',cutoffs,clock}={}){
 const f=fixture({market,...(cutoffs?{cutoffs}:{}),...(clock?{clock}:{})});
 const state={now:f.now,body:{schema:'sessionpath.tradingview.read.v1',status:'ready',receivedAt:new Date(f.now).toISOString(),packet:normalizePacket(f.packet,{now:f.now})},applies:0,ready:true,replay:false,historical:false,context:'unchanged',calls:[]};
 const input={requestId:'test-request-1',market,window};
 const applySnapshot=({request,snapshot,packet})=>{
  state.applies++;state.context='applied';
  state.model={query:{date:packet.session_date,minute:request.minute,price:snapshot.reference_price,avr:snapshot.avr,rangeHigh:snapshot.range_high,rangeLow:snapshot.range_low},box:{n:40,upPoints:2,downPoints:1,upMedianPoints:1.5,downMedianPoints:.8,coverage:.5,interval:[.35,.65],touchUp:.4,touchDown:.45,extensionUpPoints:.7,extensionDownPoints:.3,endMinute:request.endMinute},code:'EXACT-EXISTING-RENDERER-CODE',conditions:{year:'',nearestCaseLimit:50}};
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
