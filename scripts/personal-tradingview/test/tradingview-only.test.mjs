import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,settle,READ_KEY,mainIDs,nyIDs,assertNoSuccessFeedback} from './frontend-harness.mjs';

test('only Auto-fill and the two-state status remain below Decision time',async t=>{
 const h=await harness(t),row=h.$('personal-auto-fill-row');assert.equal(h.$('scenario-form').querySelector('.planning-bar').nextElementSibling,row);assert.equal(h.primary().textContent,'Auto-fill');assert.equal(h.primary().type,'button');assert.equal(row.querySelectorAll('button').length,1);assert.equal(row.querySelectorAll('input,select,details,a').length,0);
 assert.equal(h.doc.querySelectorAll('#personal-tradingview,.tv-connect,.tv-disconnect,.tv-follow,.tv-setup-links').length,0);assert.equal(h.doc.querySelectorAll('[aria-label="TradingView private read key"],[aria-label="TradingView personal webhook URL"]').length,0);assert.equal(h.status(),'Failed to fetch');assert.equal(h.state.calls.length,0);
});

test('fresh03:00 delivery waits and automatically applies03:05 without exposing setup or technical status',async t=>{
 const h=await harness(t),ready=structuredClone(h.state.body);h.state.now=Date.parse('2026-11-03T08:02:00Z');h.state.body={...ready,status:'waiting',receivedAt:'2026-11-03T08:00:01Z',packet:{...ready.packet,observed_at:'2026-11-03T08:00:00Z',sent_at:'2026-11-03T08:00:00Z',snapshots:[]}};
 await h.start();assert.equal(h.status(),'Connected');assert.equal(h.$('price').value,'777');assertNoSuccessFeedback(h);
 h.state.now=Date.parse('2026-11-03T08:05:10Z');h.state.body={...ready,receivedAt:'2026-11-03T08:05:01Z',packet:{...ready.packet,observed_at:'2026-11-03T08:05:00Z',sent_at:'2026-11-03T08:05:00Z',snapshots:[ready.packet.snapshots[0]]}};
 await h.poll();assert.equal(h.status(),'Connected');assert.equal(h.$('range-high').value,'102');assert.equal(h.state.submits,1);assert.equal(h.state.audioStarts,3);
});

test('Auto-fill retries just after the boundary and applies the true 03:00 open',async t=>{
 const h=await harness(t,{market:'NQ'}),ready=structuredClone(h.state.body);
 h.state.now=Date.parse('2026-11-03T08:00:01Z');
 h.state.body={...ready,status:'waiting',receivedAt:new Date(h.state.now).toISOString(),packet:{...ready.packet,observed_at:'2026-11-03T08:00:00Z',sent_at:'2026-11-03T08:00:00Z',snapshots:[]}};
 await h.start();
 assert.equal(h.$('price').value,'777');
 assertNoSuccessFeedback(h);

 const retry=[...h.state.timers.entries()].find(([,timer])=>timer.ms===4000);
 assert.ok(retry,'A pending checkpoint schedules a short boundary retry');
 h.state.now+=4000;
 h.state.body={...ready,receivedAt:new Date(h.state.now).toISOString(),packet:{...ready.packet,checkpoint_timing:'decision_open_v1',observed_at:'2026-11-03T08:00:00Z',sent_at:'2026-11-03T08:00:02Z',last_price:100,snapshots:[{...ready.packet.snapshots[0],reference_price:100.25}]}};
 h.state.timers.delete(retry[0]);
 retry[1].fn();
 await settle();
 assert.equal(h.status(),'Connected');
 assert.equal(h.$('price').value,'100.25');
 assert.equal(h.state.submits,1);
 assert.equal(h.state.audioStarts,3);
 assert.ok([...h.state.timers.values()].some(timer=>timer.ms===30000),'Normal polling resumes after the verified checkpoint');
});

for(const market of ['CL','NQ','ES','GC'])test(market+': explicit Auto-fill honors chosen03:00, applies NY filters, and rings/highlights once',async t=>{
 const h=await harness(t,{market});await h.start();assert.equal(h.state.calls.length,1);const call=h.state.calls[0];assert.equal(new URL(call.url).pathname,'/api/snapshots');assert.equal(new URL(call.url).searchParams.get('market'),market);assert.equal(call.options.headers.Authorization,'Bearer '+READ_KEY);assert.equal(h.$('asof').value,'03:00');assert.equal(h.$('range-high').value,'102');assert.equal(h.$('range-low').value,'98');assert.equal(h.state.submits,1);assert.equal(h.state.positionApplies,1);
 for(const id of [...mainIDs,...nyIDs])assert.ok(h.$(id).classList.contains('auto-fill-updated'),id+' is visibly filled');for(const id of ['year','ny-year','ny-asia-shape','util-three-up','ny-strength-three'])assert.ok(!h.$(id).classList.contains('auto-fill-updated'),id+' stays manual');assert.equal(h.state.audioStarts,3);assert.match(h.$('personal-auto-fill-popup').textContent,/^Done!/);assert.equal(h.status(),'Connected');
});

test('rapid clicks produce one request and one application with accessible busy state',async t=>{
 let complete;const h=await harness(t,{response:()=>new Promise(resolve=>{complete=resolve;})});const button=h.primary();button.click();button.click();await settle();assert.equal(h.state.calls.length,1);assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');complete(Response.json(h.state.body));await settle();assert.equal(h.state.submits,1);assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-busy'),'false');assert.equal(h.status(),'Connected');
});

test('saved credentials stay out of DOM and remain stable across refills',async t=>{
 const h=await harness(t);await h.start();await h.poll();await h.start();assert.equal(h.state.calls.length,3);assert.ok(h.state.calls.every(call=>call.options.headers.Authorization==='Bearer '+READ_KEY));assert.ok(!h.doc.documentElement.outerHTML.includes(READ_KEY));assert.equal(h.dom.window.localStorage.length,0);
});

test('late NY panels retain manual dominance entries and receive their review notes',async t=>{
 const h=await harness(t,{lateNY:true});await h.mountNY();assert.match(h.$('ny-util-autofill-status').textContent,/manual/i);assert.match(h.$('ny-close-autofill-status').textContent,/manual/i);await h.start();for(const [id,value]of Object.entries({'util-three-up':'12','util-three-down':'13','util-five-up':'14','util-five-down':'15','ny-strength-three':'16','ny-strength-five':'17'}))assert.equal(h.$(id).value,value);assert.equal(h.state.positionApplies,1);
});

test('success feedback expires after1.5seconds, unchanged polling is silent, explicit refill rings again',async t=>{
 const h=await harness(t);await h.start();assert.equal(h.state.audioStarts,3);assert.ok([...h.state.timers.values()].some(timer=>timer.ms===1500));h.expireFeedback();assert.equal(h.doc.querySelectorAll('.auto-fill-updated').length,0);assert.equal(h.$('personal-auto-fill-popup').hidden,true);h.state.body.packet.last_price=110;await h.poll();assert.equal(h.state.audioStarts,3);assert.equal(h.$('personal-auto-fill-popup').hidden,true);await h.start();assert.equal(h.state.audioStarts,6);assert.equal(h.$('personal-auto-fill-popup').hidden,false);
});

test('unsupported audio leaves successful Auto-fill and visual feedback intact',async t=>{
 const h=await harness(t,{audioAvailable:false});await h.start();assert.equal(h.state.submits,1);assert.equal(h.$('price').value,'100');assert.equal(h.state.audioStarts,0);assert.equal(h.$('price').classList.contains('auto-fill-updated'),true);assert.equal(h.$('personal-auto-fill-popup').hidden,false);
});

for(const market of ['CL','NQ','ES','GC'])test(market+': fresh browser uses explicitly configured server-managed data without key or cookies',async t=>{
 const h=await harness(t,{market,readKey:null,managedReadURL:'https://sessionpath-personal.jjj-jason2345.workers.dev/api/autofill'});await settle();assert.equal(h.state.calls.length,1);const call=h.state.calls[0];assert.equal(new URL(call.url).pathname,'/api/autofill');assert.equal(new URL(call.url).searchParams.get('market'),market);assert.deepEqual(call.options.headers,{});assert.equal(call.options.credentials,'omit');assert.equal(call.options.cache,'no-store');assert.equal(h.status(),'Connected');assert.equal(h.state.submits,1);assert.equal(h.state.positionApplies,1);assert.equal(h.dom.window.sessionStorage.getItem('sessionpath-personal-read-v1'),null);assert.equal(h.dom.window.sessionStorage.getItem('sessionpath-personal-enabled-v1'),null);
});

test('managed mode removes obsolete browser-held private key and never sends it',async t=>{
 const h=await harness(t,{reconnect:true,managedReadURL:'https://sessionpath-personal.jjj-jason2345.workers.dev/api/autofill'});await settle();assert.equal(h.dom.window.sessionStorage.getItem('sessionpath-personal-read-v1'),null);assert.equal(h.dom.window.sessionStorage.getItem('sessionpath-personal-enabled-v1'),null);assert.deepEqual(h.state.calls[0].options.headers,{});await h.start();assert.ok(h.state.calls.every(call=>!call.options.headers.Authorization));assert.ok(!h.doc.documentElement.outerHTML.includes(READ_KEY));
});

test('managed failure stays terse and never falls back to private anonymous reads',async t=>{
 const h=await harness(t,{readKey:null,managedReadURL:'https://sessionpath-personal.jjj-jason2345.workers.dev/api/autofill',response:()=>new Response('{}',{status:503})});await settle();assert.equal(h.status(),'Failed to fetch');assert.equal(h.state.calls.length,1);assert.equal(new URL(h.state.calls[0].url).pathname,'/api/autofill');assert.equal(h.$('price').value,'777');assertNoSuccessFeedback(h);
});

async function localReadinessTick(h){
 const pending=[...h.state.timers.entries()].find(([,timer])=>timer.ms===500);assert.ok(pending,'a local readiness retry is scheduled');h.state.timers.delete(pending[0]);pending[1].fn();await settle();
}

test('fresh managed cold start waits locally, then fills as soon as research is ready',async t=>{
 const h=await harness(t,{loading:true,readKey:null,managedReadURL:'https://sessionpath-personal.jjj-jason2345.workers.dev/api/autofill'});await settle();assert.equal(h.state.calls.length,0);assert.equal(h.state.submits,0);assertNoSuccessFeedback(h);
 await localReadinessTick(h);assert.equal(h.state.calls.length,0,'loading does not poll the server');assert.ok(![...h.state.timers.values()].some(timer=>timer.ms===30000),'no transport retry delays readiness');
 h.doc.documentElement.dataset.startup='ready';await localReadinessTick(h);assert.equal(h.state.calls.length,0,'disabled analysis still prevents an early fetch');
 h.$('analyze-btn').disabled=false;await localReadinessTick(h);assert.equal(h.state.calls.length,1);assert.equal(h.state.submits,1);assert.equal(h.$('asof').value,'05:00');assert.equal(h.$('price').value,'100');assert.equal(h.status(),'Connected');
});

test('managed readiness wait preserves an explicit Decision time selected during startup',async t=>{
 const h=await harness(t,{loading:true,readKey:null,managedReadURL:'https://sessionpath-personal.jjj-jason2345.workers.dev/api/autofill'});h.change('asof','03:00');await settle();assert.equal(h.state.calls.length,0);h.doc.documentElement.dataset.startup='ready';h.$('analyze-btn').disabled=false;await localReadinessTick(h);assert.equal(h.$('asof').value,'03:00');assert.equal(h.$('range-high').value,'102');assert.equal(h.state.submits,1);
});

test('Replay remains protected when a managed cold start becomes ready',async t=>{
 const h=await harness(t,{loading:true,readKey:null,managedReadURL:'https://sessionpath-personal.jjj-jason2345.workers.dev/api/autofill'});h.$('replay-toggle').checked=true;h.doc.documentElement.dataset.startup='ready';h.$('analyze-btn').disabled=false;await localReadinessTick(h);assert.equal(h.state.calls.length,1);assert.equal(h.state.submits,0);assert.equal(h.$('price').value,'777');assertNoSuccessFeedback(h);
 h.change('replay-toggle',false);await settle();assert.equal(h.state.submits,1);assert.equal(h.$('price').value,'100');
});

test('pagehide cancels the managed local readiness retry without requesting or applying data',async t=>{
 const h=await harness(t,{loading:true,readKey:null,managedReadURL:'https://sessionpath-personal.jjj-jason2345.workers.dev/api/autofill'});await settle();const pending=[...h.state.timers.values()].find(timer=>timer.ms===500);assert.ok(pending);h.dom.window.dispatchEvent(new h.dom.window.Event('pagehide'));assert.ok(![...h.state.timers.values()].some(timer=>timer.ms===500));h.doc.documentElement.dataset.startup='ready';h.$('analyze-btn').disabled=false;pending.fn();await settle();assert.equal(h.state.calls.length,0);assert.equal(h.state.submits,0);assert.equal(h.$('price').value,'777');assertNoSuccessFeedback(h);
});

for(const route of ['http://sessionpath-access.example/api/autofill','https://user:password@sessionpath-access.example/api/autofill','https://sessionpath-access.example/api/autofill?key=do-not-publish'])test('invalid or credential-bearing managed route is rejected before mounting or fetching',async t=>{
 const h=await harness(t,{readKey:null,managedReadURL:route});await settle();assert.equal(h.primary(),null);assert.equal(h.state.calls.length,0);assert.equal(h.$('price').value,'777');
});
