import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as settle} from 'node:timers/promises';
import {JSDOM} from 'jsdom';
import {loadChartConfiguration,mountAssistantChat} from '../../../docs/assistant-chat.mjs';
import {CHART_REFERENCE_VERSION} from '../../../docs/chart-reading-reference.mjs';

const chartReaderHealth = {
 ok:true,service:'sessionpath-assistant',chartModel:'gpt-6.1-sol',chartProvider:'openai'
};
const chartResponse = {
 ok:true,schema:'sessionpath.assistant.chart.v1',action:'describe_chart',market:'CL',window:'03:00-05:00',date:null,
 model:'gpt-6.1-sol',referenceVersion:CHART_REFERENCE_VERSION,
 analysis:{
  summary:'The chart shows a small rebound after an earlier decline.',
  sequence:['The visible candles turn upward after the earlier decline.'],
  bbox:'The BBOX is visible.',
  sessionpath:'A SessionPath box is visible.',
  uncertainties:['The exact session high is not readable.']
 }
};

function setup(t, fetchImpl) {
 const dom = new JSDOM('<!doctype html><html data-startup="ready"><body></body></html>',
  {url:'https://wanhotrading.github.io/sessionpath/'});
 const {document} = dom.window;
 const calls=[];
 dom.window.URL.createObjectURL=()=> 'blob:local-chart';
 dom.window.URL.revokeObjectURL=()=>{};
 dom.window.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
 const fetcher=async(url,options)=>{
  calls.push({url,options});
  return fetchImpl(url,options);
 };
 const ui=mountAssistantChat({
  instrument:{id:'CL'},document,fetchImpl:fetcher,
  getChartConfiguration:({signal})=>loadChartConfiguration({signal,fetchImpl:fetcher}),
  prepareImage:async()=>({dataUrl:'data:image/jpeg;base64,/9j/2Q==',width:1200,height:600})
 });
 t.after(()=>{ui.destroy();dom.window.close();});
 return {calls,document,ui,attach:(name='screenshot.png')=>ui.attachImage(new dom.window.File(['test'],name,{type:'image/png'}))};
}

test('a screenshot checks only provider metadata before Send and shows the confirmed reader in its result',async t=>{
 const {calls,document,ui,attach}=setup(t, url=>url.endsWith('/health')?Response.json(chartReaderHealth):Response.json(chartResponse));
 assert.equal(calls.length,0);
 await attach();
 await settle();
 assert.equal(calls.length,1);
 assert.match(calls[0].url,/\/health$/u);
 assert.equal(calls[0].options.method,'GET');
 assert.equal(calls[0].options.credentials,'omit');
 assert.equal(calls[0].options.body,undefined);
 const disclosure=document.querySelector('.sp-chat-image-disclosure');
 assert.match(disclosure.textContent,/Configured reader · GPT-6\.1 Sol \(OpenAI\)/u);
 assert.match(disclosure.textContent,/OpenAI or OpenRouter\/xAI/u);
 await ui.submit('What happened around the box?');
 assert.equal(calls.length,2);
 assert.match(calls[1].url,/\/api\/chart$/u);
 assert.equal(calls[1].options.method,'POST');
 assert.equal(JSON.parse(calls[1].options.body).image.dataUrl,'data:image/jpeg;base64,/9j/2Q==');
 assert.match(document.querySelector('.sp-chat-chart-reading').textContent,/GPT-6\.1 Sol \(OpenAI\)/u);
});

test('the browser accepts the legacy Grok health response and ignores unsupported or conflicting provider claims',async()=>{
 const makeHealth=(model,provider)=>loadChartConfiguration({fetchImpl:async()=>Response.json({
  ok:true,service:'sessionpath-assistant',chartModel:model,...(provider?{chartProvider:provider}:{})
 })});
 assert.equal(await makeHealth('x-ai/grok-4.7'),'x-ai/grok-4.7');
 assert.equal(await makeHealth('gpt-6.1-sol','openrouter'),null);
 assert.equal(await makeHealth('gpt-6.1-sol'),null);
 assert.equal(await makeHealth('<img src=x>','openai'),null);
});

test('pending health metadata is aborted on removal, and a failed replacement shows both possible services',async t=>{
 let finishOld;
 const {calls,document,ui,attach}=setup(t,url=>{
  assert.match(url,/\/health$/u);
  if(calls.length===1)return new Promise(resolve=>{finishOld=resolve;});
  return Promise.reject(new TypeError('network unavailable'));
 });
 await attach('old.png');
 assert.match(document.querySelector('.sp-chat-image-disclosure').textContent,/OpenAI or OpenRouter\/xAI/u);
 ui.clearAttachment();
 assert.equal(calls[0].options.signal.aborted,true);
 await attach('new.png');
 finishOld(Response.json(chartReaderHealth));
 await settle();
 const disclosure=document.querySelector('.sp-chat-image-disclosure');
 assert.match(disclosure.textContent,/OpenAI or OpenRouter\/xAI/u);
 assert.doesNotMatch(disclosure.textContent,/Configured reader/u);
 assert.equal(document.querySelector('.sp-chat-filename').textContent,'new.png');
 assert.equal(document.querySelector('.sp-chat-send').disabled,false);
});
