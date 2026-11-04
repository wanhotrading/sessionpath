import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPersonalTradingView} from '../../../docs/tradingview-live-core.mjs';
import {harness,settle,READ_KEY,mainIDs,nyIDs,assertNoSuccessFeedback} from './frontend-harness.mjs';

for(const market of ['CL','NQ','ES','GC'])test(market+': authenticated frozen snapshots fill main and NY inputs',async t=>{
 const h=await harness(t,{market,reconnect:true});await settle();
 assert.equal(h.$('asof').value,'05:00','automatic reconnect follows latest checkpoint by default');
 assert.deepEqual(Object.fromEntries(mainIDs.map(id=>[id,Number(h.$(id).value)])),{price:100,avr:5.123456,'prior-high':105,'prior-low':95,open1930:100,'range-high':103,'range-low':97,up:3,down:3});
 assert.deepEqual(Object.fromEntries(nyIDs.map(id=>[id,Number(h.$(id).value)])),{'ny-price':100,'ny-avr':5.123456,'ny-range-high':104,'ny-range-low':96,'ny-position-asia':55,'ny-position-london':65,'ny-printed':156.1});
 assert.equal(h.$('printed').value,'117.1');assert.equal(h.$('location').value,'Q3');assert.equal(h.$('range-position').value,'0.5');assert.equal(h.$('behavior').value,'Higher finish');
 assert.equal(h.state.submits,1);assert.equal(h.state.positionApplies,1,'completed NY position filters apply by default');assert.equal(h.state.nyRefreshes,1);assert.equal(h.status(),'Connected');
 assert.equal(h.state.calls[0].options.headers.Authorization,'Bearer '+READ_KEY);assert.equal(h.state.calls[0].options.credentials,'omit');assert.equal(h.state.calls[0].options.cache,'no-store');
 assert.equal(h.$('year').value,'2025');assert.equal(h.$('ny-year').value,'2024');assert.equal(h.$('ny-asia-shape').value,'Trend');assert.equal(h.$('retained-tag').checked,true);assert.equal(h.dom.window.localStorage.length,0);
});

test('percent units and Own positions preserve the established calculations',async t=>{
 const h=await harness(t,{units:'percent',basis:'own',reconnect:true});await settle();
 assert.ok(Math.abs(Number(h.$('up').value)-300/5.123456)<1e-8);assert.ok(Math.abs(Number(h.$('down').value)-300/5.123456)<1e-8);
 assert.equal(Number(h.$('range-high').value),103);assert.equal(Number(h.$('avr').value),5.123456);assert.equal(Number(h.$('ny-position-asia').value),75);assert.equal(Number(h.$('ny-position-london').value),75);assert.equal(h.state.submits,1);
});

test('a heartbeat preserves frozen opens and does not repeat forecast application',async t=>{
 const h=await harness(t);await h.start();h.state.body.packet.last_price=110;await h.poll();assert.equal(Number(h.$('price').value),100);assert.equal(Number(h.$('ny-price').value),100);assert.equal(h.state.submits,1);assert.equal(h.state.positionApplies,1);assert.equal(h.state.nyRefreshes,1);
});

test('Replay blocks live writes and resumes when switched off',async t=>{
 const h=await harness(t);h.$('replay-toggle').checked=true;await h.start();assert.equal(h.status(),'Failed to fetch');assert.equal(h.state.submits,0);assert.equal(h.$('price').value,'777');assertNoSuccessFeedback(h);
 h.change('replay-toggle',false);await settle();assert.equal(h.state.submits,1);assert.equal(h.$('price').value,'100');assert.equal(h.status(),'Connected');
});

test('research startup blocks writes until model handlers are ready',async t=>{
 const h=await harness(t,{loading:true});await h.start();assert.equal(h.state.submits,0);assert.equal(h.$('price').value,'777');assert.equal(h.$('ny-price').value,'777');assertNoSuccessFeedback(h);
 h.$('analyze-btn').disabled=false;h.doc.documentElement.dataset.startup='ready';await h.poll();assert.equal(h.state.submits,1);assert.equal(h.$('price').value,'100');
});

for(const mode of ['stale','old-ready-timestamp','wrong-market','wrong-date','unauthorized','waiting','network'])test(mode+' response leaves every model input unchanged with terse failure status',async t=>{
 const h=await harness(t,{response:state=>{
  if(mode==='network')throw new TypeError('Failed to fetch');if(mode==='unauthorized')return new Response('{}',{status:401});
  const body=structuredClone(state.body);if(mode==='stale')body.status='stale';if(mode==='old-ready-timestamp')body.packet.observed_at='2026-11-03T13:25:00.000Z';if(mode==='wrong-market')body.packet.market='NQ';if(mode==='wrong-date')body.packet.session_date='2026-11-02';if(mode==='waiting'){body.status='waiting';body.packet=null;body.receivedAt=null;}return Response.json(body);
 }});await h.start();assert.equal(h.$('price').value,'777');assert.equal(h.$('ny-price').value,'777');assert.equal(h.state.submits,0);assert.equal(h.state.positionApplies,0);assert.equal(h.status(),'Failed to fetch');assertNoSuccessFeedback(h);
});

for(const readKey of [null,'short'])test('missing or malformed saved credential never makes an anonymous private request ('+readKey+')',async t=>{
 const h=await harness(t,{readKey});await h.start();assert.equal(h.state.calls.length,0);assert.equal(h.status(),'Failed to fetch');assert.equal(h.$('price').value,'777');assert.equal(h.doc.querySelectorAll('input[type=password]').length,0);assertNoSuccessFeedback(h);
});

test('context change during fetch discards the old response before applying a fresh request',async t=>{
 let complete;const h=await harness(t,{response:state=>state.calls.length===1?new Promise(resolve=>{complete=resolve;}):Response.json(state.body)});await h.start();h.change('asof','05:00');complete(Response.json(h.state.body));await settle();assert.equal(h.state.submits,0);assert.equal(h.$('price').value,'777');await h.poll();assert.equal(h.state.submits,1);assert.equal(h.$('range-high').value,'103');
});

test('manual Decision time survives automatic polls',async t=>{
 const h=await harness(t,{reconnect:true});await settle();assert.equal(h.$('asof').value,'05:00');h.change('asof','03:00');await settle();assert.equal(h.$('range-high').value,'102');await h.poll();assert.equal(h.$('asof').value,'03:00');assert.equal(h.$('range-high').value,'102');
});

test('NY date away and back refills only today and resets its fingerprint',async t=>{
 const h=await harness(t);await h.start();h.change('ny-date','2026-11-02');await settle();h.$('ny-price').value='999';h.change('ny-date','2026-11-03');await settle();assert.equal(h.$('ny-price').value,'100');assert.equal(h.state.nyRefreshes,2);
});

test('unmount aborts pending reads, suppresses late writes and removes success feedback',async t=>{
 let complete;const h=await harness(t,{response:()=>new Promise(resolve=>{complete=resolve;})});await h.start();h.dom.window.dispatchEvent(new h.dom.window.Event('pagehide'));assert.equal(h.state.calls[0].options.signal.aborted,true);complete(Response.json(h.state.body));await settle();assert.equal(h.state.submits,0);assert.equal(h.$('price').value,'777');assertNoSuccessFeedback(h);assert.ok(![...h.state.timers.values()].some(timer=>timer.ms===30000));
});

test('remount is idempotent and never recreates the setup panel',async t=>{
 const h=await harness(t);mountPersonalTradingView({instrument:{id:'CL'},endpoint:'https://sessionpath-personal.jjj-jason2345.workers.dev'});assert.equal(h.doc.querySelectorAll('#personal-auto-fill-row').length,1);assert.equal(h.doc.querySelectorAll('#personal-tradingview').length,0);assert.equal(h.state.calls.length,0);
});
