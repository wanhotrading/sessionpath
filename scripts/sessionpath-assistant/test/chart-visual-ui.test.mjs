import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountAssistantChat,validateChartReading} from '../../../docs/assistant-chat.mjs';
import {CHART_REFERENCE_VERSION} from '../../../docs/chart-reading-reference.mjs';
import {makeChartSessionPathCode} from '../../../docs/session-path-code.mjs';

const context={market:'NQ',window:'03:00-05:00',date:null};
const visualTags=()=>[
 {session:'NTA',tag:'DOWN_THEN_BOUNCE',confidence:'tentative',evidence:'Price falls early and then recovers part of the drop.',uncertainty:'The exact close cannot be read.',complete:true,source:'visual',status:'candidate'},
 {session:'ASIA',tag:'UP_FINISH',confidence:'clear',evidence:'Price rises and finishes near the visible high.',uncertainty:'Exact HLC values are unavailable.',complete:true,source:'visual',status:'candidate'},
 {session:'LONDON',tag:'RALLY_FADE',confidence:'tentative',evidence:'A rise is followed by a visible fade.',uncertainty:'The size of the fade is uncertain.',complete:true,source:'visual',status:'candidate'},
 {session:'NY',tag:null,confidence:'unclassified',evidence:'Only the early New York candles are visible.',uncertainty:'The session has not ended.',complete:false,source:'visual',status:'in_progress'},
];
const formalTags=()=>['NTA','ASIA','LONDON','NY'].map(session=>({session,tag:null,status:session==='NY'?'in_progress':'unverified',reason:session==='NY'?'The session is not complete.':'Exact session high, low and close values are unreadable.'}));
const reading=(overrides={})=>({ok:true,schema:'sessionpath.assistant.chart.v1',action:'describe_chart',...context,model:'x-ai/grok-4.7',referenceVersion:CHART_REFERENCE_VERSION,analysis:{summary:'Price recovered after an early decline.',sequence:['An early decline is visible.','Later candles recover.'],bbox:'A BBOX is visible.',sessionpath:'The forecast box is visible.',uncertainties:['Exact prices cannot be confirmed.']},visualTags:visualTags(),shapeTags:formalTags(),...overrides});

async function render(t,reply,query='Read this chart.'){
 const dom=new JSDOM('<!doctype html><html data-startup="ready"><body><select id="asof"><option value="03:00">03:00</option></select><button id="analyze-btn">Forecast</button><select id="formal-nta"><option value="NARROW">Narrow range</option></select></body></html>',{url:'https://wanhotrading.github.io/sessionpath/?instrument=NQ',pretendToBeVisual:true});
 const {document:doc}=dom.window,state={applies:[],forecasts:[],calls:[]};
 dom.window.URL.createObjectURL=()=> 'blob:local-chart';dom.window.URL.revokeObjectURL=()=>{};
 dom.window.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
 doc.addEventListener('sessionpath:apply-path-code',event=>state.applies.push(event.detail));doc.addEventListener('sessionpath:assistant-request',event=>state.forecasts.push(event.detail));
 const ui=mountAssistantChat({instrument:{id:'NQ'},document:doc,now:()=>Date.parse('2026-11-04T14:45:00Z'),prepareImage:async()=>({dataUrl:'data:image/jpeg;base64,/9j/2Q==',width:1200,height:600}),fetchImpl:async(url,options)=>{state.calls.push({url,options});return Response.json(reply);}});
 t.after(()=>{ui.destroy();dom.window.close();});
 await ui.attachImage(new dom.window.File(['chart'],'private-chart.png',{type:'image/png'}));await ui.submit(query);
 return {dom,doc,ui,state,item:doc.querySelector('.sp-chat-chart-reading')};
}

test('a readable visual candidate leads while unverified formal evidence stays in its own collapsed section',async t=>{
 const h=await render(t,reading()),visual=h.item.querySelector('.sp-chat-visual-reading'),calculated=h.item.querySelector('.sp-chat-calculated-classification');
 assert.equal(visual.getAttribute('aria-label'),'Visual reading');assert.equal(calculated.querySelector('summary').textContent,'Calculated classification');assert.equal(calculated.open,false);
 assert.ok(visual.compareDocumentPosition(calculated)&h.dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
 const nta=visual.querySelector('[data-session="NTA"]');assert.match(nta.textContent,/NTA · NY to Asia · Down then bounce/);assert.match(nta.textContent,/Tentative/);assert.match(nta.textContent,/Observed · Price falls early/);assert.match(nta.textContent,/Uncertainty · The exact close/);assert.doesNotMatch(nta.textContent,/Unverified|DOWN_THEN_BOUNCE/);
 assert.match(visual.querySelector('[data-session="ASIA"]').textContent,/Clear visual read/);assert.match(calculated.textContent,/NTA · NY to Asia · Unverified/);assert.match(calculated.textContent,/Exact session high, low and close values are unreadable/);
 assert.equal(h.state.calls.length,1);assert.equal(h.doc.querySelector('.sp-chat-attachment').hidden,true);
});

test('the incomplete New York row explains why it has no final candidate',async t=>{
 const h=await render(t,reading()),ny=h.item.querySelector('.sp-chat-visual-tags [data-session="NY"]');
 assert.match(ny.textContent,/New York · Session in progress/);assert.equal(ny.querySelector('.sp-chat-visual-badge').textContent,'In progress');assert.match(ny.textContent,/Only the early New York candles/);assert.match(ny.textContent,/No final visual tag while this session is incomplete/);assert.doesNotMatch(ny.textContent,/Unverified|Clear visual read|Tentative/);
});

test('visual candidates alone cannot create, copy, or apply a formal path code or change a selector',async t=>{
 const reply=reading({shapeTags:undefined,chartObservation:{market:'NQ',ticker:'NQ1!',date:'2026-11-04',cutoff:'2026-11-04T10:45',timezone:'America/New_York',intervalMinutes:5}});
 assert.equal(makeChartSessionPathCode(reply),'');const h=await render(t,reply,'Give me the path code.');
 assert.ok(h.item.querySelector('.sp-chat-visual-tags'));assert.equal(h.item.querySelector('[aria-label="Session paths code"]'),null);assert.equal(h.item.querySelector('.sp-chat-path-actions'),null);assert.equal(h.item.querySelector('.sp-chat-copy'),null);assert.equal(h.doc.querySelector('#formal-nta').value,'NARROW');assert.deepEqual(h.state.applies,[]);assert.deepEqual(h.state.forecasts,[]);assert.match(h.item.querySelector('.sp-chat-calculated-classification').textContent,/No calculated classification is available/);
});

test('legacy responses retain their formal classification and visible narrative without a visual-candidate payload',async t=>{
 const h=await render(t,reading({visualTags:undefined}));assert.ok(h.item);assert.equal(h.item.querySelector('.sp-chat-visual-tags'),null);assert.equal(h.item.querySelector('.sp-chat-visual-unavailable'),null);assert.match(h.item.querySelector('.sp-chat-visual-reading').textContent,/Price recovered after an early decline/);assert.match(h.item.querySelector('.sp-chat-calculated-classification').textContent,/London · Unverified/);
});

test('malformed visual payloads do not discard an otherwise valid narrative and formal result',async t=>{
 for(const visual of [{candidate:'UP_FINISH'},visualTags().slice(1),visualTags().map(row=>row.session==='NTA'?{...row,tag:'<img src=x onerror=evil()>'}:row)]){
  const reply=reading({visualTags:visual});assert.equal(validateChartReading(reply,context),true);const h=await render(t,reply);assert.ok(h.item);assert.equal(h.item.querySelector('.sp-chat-visual-tags'),null);assert.match(h.item.querySelector('.sp-chat-visual-unavailable').textContent,/Visual candidates are unavailable/);assert.match(h.item.textContent,/Price recovered after an early decline/);assert.ok(h.item.querySelector('.sp-chat-calculated-classification'));assert.equal(h.doc.querySelector('.sp-chat-retry'),null);
 }
});

test('visual observations and uncertainty preserve encoded markup and quotes as literal text',async t=>{
 const rows=visualTags();rows[0].evidence='&lt;img src=x onerror="evil()"&gt; falls then recovers.';rows[0].uncertainty='&lt;script&gt;evil()&lt;/script&gt; is not a price.';
 const h=await render(t,reading({visualTags:rows}));const nta=h.item.querySelector('.sp-chat-visual-tags [data-session="NTA"]');assert.ok(nta);assert.ok(nta.textContent.includes(rows[0].evidence));assert.ok(nta.textContent.includes(rows[0].uncertainty));assert.equal(h.item.querySelector('img,script,svg'),null);assert.doesNotMatch(h.dom.window.sessionStorage.getItem('sessionpath-assistant-chat-v1')||'',/evil|private-chart|base64/);
});

test('markup rejected by the visual contract cannot create elements or discard a safely rendered narrative',async t=>{
 const rows=visualTags();rows[0].evidence='<img src=x onerror="evil()">';const reply=reading({visualTags:rows});reply.analysis.summary='<svg onload="evil()"> Price recovered.';
 const h=await render(t,reply);assert.ok(h.item.querySelector('.sp-chat-visual-unavailable'));assert.ok(h.item.textContent.includes(reply.analysis.summary));assert.equal(h.item.querySelector('img,script,svg'),null);assert.ok(h.item.querySelector('.sp-chat-calculated-classification'));
});
