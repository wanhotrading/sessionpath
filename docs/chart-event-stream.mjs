// The endpoint sends a complete, validated JSON result after optional SSE
// heartbeats. This reader never exposes partial model text or retries a request.
export const CHART_RESPONSE_MAX_BYTES=128*1024;
export const CHART_EVENT_MAX_BYTES=64*1024;
const interrupted=()=>new Error('The chart reader connection was interrupted. Please try again.');
const unreadable=()=>new Error('The chart reader returned an unreadable response. Please try again.');
const incomplete=()=>new Error('The chart reader ended before returning a result. Please try again.');
const cancelled=()=>Object.assign(new Error('Request cancelled.'),{name:'AbortError'});
const parseResult=text=>{try{return JSON.parse(text);}catch{throw unreadable();}};

export async function readChartResponse(response,{signal}={}){
 const stream=/^text\/event-stream(?:\s*;|\s*$)/iu.test(response.headers?.get('Content-Type')??'');
 let reader;try{reader=response.body?.getReader();}catch{throw unreadable();}
 if(!reader)throw unreadable();
 const decoder=new TextDecoder('utf-8',{fatal:true});
 let total=0,ended=false,aborted=Boolean(signal?.aborted),json='';
 let line='',lineBytes=0,eventBytes=0,eventName='',data=[],skipLF=false,result,hasResult=false;
 const abort=()=>{aborted=true;try{void reader.cancel().catch(()=>{});}catch{}};
 signal?.addEventListener('abort',abort,{once:true});
 const finishEvent=()=>{
  if(eventName==='result'){
   if(hasResult)throw new Error('The chart reader returned more than one result. Please try again.');
   if(!data.length)throw unreadable();
   result=parseResult(data.join('\n'));hasResult=true;
  }
  eventName='';data=[];eventBytes=0;
 };
 const finishLine=()=>{
  eventBytes+=lineBytes+1;
  if(eventBytes>CHART_EVENT_MAX_BYTES)throw new Error('The chart reader response was too large. Please try again.');
  if(line===''){finishEvent();}
  else if(!line.startsWith(':')){
   const colon=line.indexOf(':'),field=colon<0?line:line.slice(0,colon);
   let value=colon<0?'':line.slice(colon+1);if(value.startsWith(' '))value=value.slice(1);
   if(field==='event'){
    if(hasResult&&value==='result')throw new Error('The chart reader returned more than one result. Please try again.');
    eventName=value;
   }else if(field==='data')data.push(value);
  }
  line='';lineBytes=0;
 };
 const consume=text=>{
  for(const character of text){
   if(skipLF){skipLF=false;if(character==='\n')continue;}
   if(character==='\r'){finishLine();skipLF=true;}
   else if(character==='\n')finishLine();
   else{
    line+=character;const point=character.codePointAt(0);lineBytes+=point<128?1:point<2048?2:point<65536?3:4;
    if(eventBytes+lineBytes>CHART_EVENT_MAX_BYTES)throw new Error('The chart reader response was too large. Please try again.');
   }
  }
 };
 try{
  if(aborted)throw cancelled();
  for(;;){
   let item;try{item=await reader.read();}catch{if(aborted||signal?.aborted)throw cancelled();throw interrupted();}
   if(aborted||signal?.aborted)throw cancelled();
   if(item.done){ended=true;break;}
   total+=item.value.byteLength;
   if(total>CHART_RESPONSE_MAX_BYTES)throw new Error('The chart reader response was too large. Please try again.');
   let text;try{text=decoder.decode(item.value,{stream:true});}catch{throw unreadable();}
   if(stream){
    // Process the entire received chunk before returning, so two completed
    // result events received together cannot silently select either answer.
    consume(text);if(hasResult)return result;
   }else json+=text;
  }
  let rest;try{rest=decoder.decode();}catch{throw unreadable();}
  if(stream){consume(rest);if(hasResult)return result;throw incomplete();}
  json+=rest;return parseResult(json);
 }finally{
  signal?.removeEventListener('abort',abort);
  if(!ended){try{await reader.cancel();}catch{}}
  reader.releaseLock();
 }
}
