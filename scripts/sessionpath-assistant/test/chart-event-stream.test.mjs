import test from 'node:test';
import assert from 'node:assert/strict';
import {readChartResponse,CHART_EVENT_MAX_BYTES,CHART_RESPONSE_MAX_BYTES} from '../../../docs/chart-event-stream.mjs';
const encoder=new TextEncoder();
function streamed(chunks,{type='text/event-stream',open=false,onCancel=()=>{}}={}){
 let position=0;
 return new Response(new ReadableStream({
  pull(controller){if(position<chunks.length){const chunk=chunks[position++];controller.enqueue(typeof chunk==='string'?encoder.encode(chunk):chunk);}else if(!open)controller.close();},
  cancel(reason){onCancel(reason);},
 }),{headers:{'Content-Type':type}});
}
const frame=value=>'event: result\ndata: '+JSON.stringify(value)+'\n\n';

test('ordinary JSON and JSON error responses remain supported',async()=>{
 const body={ok:false,error:{message:'Usage limit reached.'}};
 assert.deepEqual(await readChartResponse(Response.json(body,{status:429})),body);
 assert.deepEqual(await readChartResponse(streamed(['{"ok":', 'true}'],{type:'application/json'})),{ok:true});
});
test('SSE ignores heartbeat comments, unrelated events and fields, and joins data lines',async()=>{
 const response=streamed([': connected\n\nretry: 1000\nevent: progress\ndata: ignore\n\nevent: result\r\ndata: {"ok":\r\ndata: true}\r\n\r\n']);
 assert.deepEqual(await readChartResponse(response),{ok:true});
});
test('fragmented UTF8, event names and CRLF boundaries produce one complete result',async()=>{
 const value={ok:true,text:'山雪 🐕'},bytes=encoder.encode(': ping\r\n\r\n'+frame(value).replaceAll('\n','\r\n'));
 const chunks=Array.from(bytes,byte=>new Uint8Array([byte]));
 assert.deepEqual(await readChartResponse(streamed(chunks)),value);
});
test('a completed result closes an otherwise open response without waiting for EOF',async()=>{
 let cancelled=false;
 assert.deepEqual(await readChartResponse(streamed([frame({ok:true})],{open:true,onCancel:()=>{cancelled=true;}})),{ok:true});
 assert.equal(cancelled,true);
});
test('a server error envelope is returned as data for the existing UI checks',async()=>{
 const body={ok:false,error:{code:'CHART_MODEL_TIMEOUT',message:'The chart reader timed out.'}};
 assert.deepEqual(await readChartResponse(streamed([frame(body)])),body);
});
test('premature EOF or an unfinished result event never yields a partial reading',async()=>{
 for(const text of [': ping\n\n','event: result\ndata: {"ok":true}','event: result\ndata: {"ok":true}\n']){
  await assert.rejects(readChartResponse(streamed([text])),/ended before returning a result/);
 }
});
test('malformed result JSON and UTF8 use fixed messages without echoing content',async()=>{
 for(const response of [streamed(['event: result\ndata: PRIVATE_BROKEN_TEXT\n\n']),streamed([new Uint8Array([255])]),new Response('PRIVATE_BROKEN_TEXT')]){
  await assert.rejects(readChartResponse(response),error=>error.message==='The chart reader returned an unreadable response. Please try again.');
 }
});
test('two final results arriving in one chunk are rejected instead of choosing one',async()=>{
 await assert.rejects(readChartResponse(streamed([frame({ok:true})+frame({ok:false})])),/more than one result/);
});
test('event and whole-response bounds close the reader',async()=>{
 let count=0;
 await assert.rejects(readChartResponse(streamed(['event: result\ndata: '+ 'x'.repeat(CHART_EVENT_MAX_BYTES)],{open:true,onCancel:()=>count++})),/too large/);
 assert.equal(count,1);
 await assert.rejects(readChartResponse(streamed([': x\n\n'.repeat(Math.ceil(CHART_RESPONSE_MAX_BYTES/5))])),/too large/);
 await assert.rejects(readChartResponse(new Response('x'.repeat(CHART_RESPONSE_MAX_BYTES+1))),/too large/);
});
test('abort before and while waiting cancels the reader and returns AbortError',async()=>{
 const before=new AbortController();before.abort();let cancelled=0;
 await assert.rejects(readChartResponse(streamed([],{open:true,onCancel:()=>cancelled++}),{signal:before.signal}),{name:'AbortError'});
 const during=new AbortController(),pending=readChartResponse(streamed([': waiting\n\n'],{open:true,onCancel:()=>cancelled++}),{signal:during.signal});
 await Promise.resolve();during.abort();await assert.rejects(pending,{name:'AbortError'});assert.ok(cancelled>=2);
});
test('broken connections expose a fixed error and do not retry',async()=>{
 const response=new Response(new ReadableStream({start(controller){controller.error(new Error('PRIVATE_CONNECTION_DETAIL'));}}),{headers:{'Content-Type':'text/event-stream'}});
 await assert.rejects(readChartResponse(response),error=>error.message==='The chart reader connection was interrupted. Please try again.');
});
