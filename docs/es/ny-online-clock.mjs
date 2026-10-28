export function nyClockParts(epoch){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(epoch).map(x=>[x.type,x.value]));
 return {date:`${p.year}-${p.month}-${p.day}`,clock:`${p.hour}:${p.minute}:${p.second}`,minute:+p.hour*60+ +p.minute,completed:Math.floor((+p.hour*60+ +p.minute)/5)*5};
}
// Same-origin HTTP Date avoids a third-party clock dependency. Age accounts for CDN cache residence.
export function createOnlineClock({fetchImpl=fetch,monotonic=()=>performance.now(),device=()=>Date.now()}={}){
 let epoch=null,at=null,lastSync=null,busy=null;
 const read=()=>({ ...nyClockParts(epoch===null?device():epoch+monotonic()-at),online:epoch!==null&&monotonic()-lastSync<15*60000,source:epoch===null?'device':'server' });
 const sync=()=>busy??=(async()=>{
  const start=monotonic();
  const response=await fetchImpl(`./?sessionpath-clock=${device()}`,{method:'HEAD',cache:'no-store',signal:AbortSignal.timeout(8000)});
  const finish=monotonic(),date=Date.parse(response.headers.get('Date')),age=Number(response.headers.get('Age')||0);
  if(!response.ok||!Number.isFinite(date)||!Number.isFinite(age)||age<0||finish-start>10000)throw Error('Online clock unavailable. Retry clock sync before live tracking.');
  epoch=date+age*1000+(finish-start)/2;at=finish;lastSync=finish;return read();
 })().finally(()=>{busy=null;});
 return {read,sync};
}
