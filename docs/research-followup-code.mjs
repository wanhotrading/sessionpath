import {nyTimestamp} from './planner-v3.mjs';
import {validateAsOf,WINDOW_BOUNDS} from './research-probability-core.mjs';

const EPS=1e-8;
export function nyParts(ms){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(ms).map(x=>[x.type,x.value]));
 return {date:`${p.year}-${p.month}-${p.day}`,minute:Number(p.hour)*60+Number(p.minute),second:Number(p.second)};
}
export function classifyEndpoint(close,upper,lower){
 if(![close,upper,lower].every(Number.isFinite)||upper<=lower)throw Error('Enter valid previous Mean box edges and the completed endpoint close.');
 return close>upper+EPS?'ABOVE_U':close<lower-EPS?'BELOW_D':'INSIDE';
}
export function observeFirstBreach({window,minute,upper,lower,high,low,close}){
 const bounds=WINDOW_BOUNDS[window];
 if(!bounds||!Number.isInteger(minute)||minute%5||minute<=bounds[0]||minute>bounds[1])throw Error('Use a completed five-minute close within the selected window.');
 if(![upper,lower,high,low,close].every(Number.isFinite)||upper<=lower||high<low||close<low-EPS||close>high+EPS)throw Error('Enter the first breach candle’s valid high, low and close.');
 const u=high>upper+EPS,d=low<lower-EPS;
 if(u&&d)throw Error('The first candle broke both sides. Five-minute data cannot identify the first direction; no side-specific probability is shown.');
 if(!u&&!d)throw Error('This candle did not strictly breach either Mean boundary. A touch is insufficient.');
 const side=u?'U':'D',width=upper-lower,signalType=close>upper+EPS||close<lower-EPS?'CLOSE_OUTSIDE':'WICK_ONLY';
 return {side,signalType,strengthPercent:signalType==='WICK_ONLY'?null:Math.max(0,100*(u?close-upper:lower-close)/width),alreadyReached:{reach120:u?high>=lower+1.2*width-EPS:low<=upper-1.2*width+EPS,reach130:u?high>=lower+1.3*width-EPS:low<=upper-1.3*width+EPS}};
}
function outcomeTriple(x){
 if(!x?.available||!Number.isFinite(x.probability)||!(x.n>0))return [-1,0,0];
 return [Number((100*x.probability).toFixed(6)),x.successes,x.n];
}
export function makeResearchCode({market,kind,date,startMinute,endMinute,upper,lower,side,state,through,flags=0,outcomes}){
 validateAsOf(date);validateAsOf(through);
 if(through>=date)throw Error('Research training must end before the observation trading date.');
 const metrics=kind==='EP'?['hh','ll','both']:['return20','reach120','reach130'];
 const parts=['SR1',market,kind,nyTimestamp(date,startMinute),nyTimestamp(date,endMinute),Number(upper).toFixed(6),Number(lower).toFixed(6),side,...metrics.flatMap(k=>outcomeTriple(outcomes[k])),nyTimestamp(through,0),state,flags];
 const code=parts.join('|');parseResearchCode(code,market);return code;
}
export function parseResearchCode(code,market){
 const p=String(code).trim().split('|');
 if(p.length!==20||p[0]!=='SR1'||!['CL','NQ'].includes(p[1])||(market&&p[1]!==market)||!['EP','FB'].includes(p[2]))throw Error('Use the matching market’s complete research code.');
 const [start,end,upper,lower]=p.slice(3,7).map(Number),through=Number(p[17]),flags=Number(p[19]);
 if(p.some(s=>s.trim()==='')||![start,end,upper,lower,through,flags].every(Number.isFinite)||upper<=lower||start<=0||end<=start||!Number.isInteger(flags)||flags<0||flags>3)throw Error('Research code contains invalid bounds or dates. Experimental strength readings are view-only.');
 const a=nyParts(start),b=nyParts(end),t=nyParts(through);
 if(a.date!==b.date||a.second||b.second||t.minute||t.second||t.date>=a.date||start%300000||end%300000)throw Error('Research times must be completed five-minute New York times, with earlier training dates.');
 if(p[2]==='EP'&&(![[300,510],[510,960]].some(([s,e])=>a.minute===s&&b.minute===e)||p[7]!=='B'||!['ABOVE_U','INSIDE','BELOW_D'].includes(p[18])||flags))throw Error('Invalid endpoint research window.');
 if(p[2]==='FB'){
  const bounds=Object.values(WINDOW_BOUNDS).find(([,e])=>e===b.minute);
  if(!bounds||a.minute<=bounds[0]||a.minute>=bounds[1]||!['U','D'].includes(p[7])||!['WICK_ONLY','CLOSE_OUTSIDE'].includes(p[18]))throw Error('Invalid first-breach research window.');
 }
 const metrics=[];
 for(let i=8;i<17;i+=3){const [probability,k,n]=p.slice(i,i+3).map(Number);if(![probability,k,n].every(Number.isFinite)||!Number.isInteger(k)||!Number.isInteger(n)||k<0||n<k||(n===0?(probability!==-1||k!==0):probability<0||probability>100))throw Error('Invalid research counts or probability.');metrics.push({probability,k,n});}
 if(p[2]==='FB'&&(p[18]==='WICK_ONLY'||b.minute-a.minute<20)&&metrics[0].n)throw Error('A full 20-minute close-return probability is unavailable for this observation.');
 if(p[2]==='FB'&&((flags&1)&&metrics[1].n||(flags&2)&&metrics[2].n))throw Error('Already reached targets cannot have a future probability.');
 return {market:p[1],kind:p[2],start,end,upper,lower,side:p[7],metrics,through,state:p[18],flags,date:a.date,startMinute:a.minute,endMinute:b.minute};
}
export function parseResearchSnapshot(text,market){
 const raw=String(text).trim(),match=raw.match(/(?:SEP1|SFB1)\|[^\r\n]+/);if(!match)throw Error('Paste a SEP1 endpoint or SFB1 first-breach snapshot from Pine Logs.');
 const p=match[0].split('|'),kind=p[0]==='SEP1'?'EP':'FB';
 if(p.length!==(kind==='EP'?10:14)||p.some(s=>s.trim()==='')||p[1]!==market)throw Error('Snapshot is incomplete or belongs to another market.');
 const start=Number(p[2]),end=Number(p[3]);if(!Number.isFinite(start)||!Number.isFinite(end))throw Error('Invalid snapshot times.');
 const a=nyParts(start),b=nyParts(end);if(a.date!==b.date||a.second||b.second||start%300000||end%300000)throw Error('Invalid snapshot trading date.');
 if(kind==='EP'){
  const [high,low,close,upper,lower]=p.slice(4,9).map(Number);
  const category=p[9];
  if(![[300,510],[510,960]].some(([s,e])=>a.minute===s&&b.minute===e)||!Number.isFinite(high)||!Number.isFinite(low)||high<=low||close>high+EPS||close<low-EPS||category!==classifyEndpoint(close,upper,lower))throw Error('Endpoint snapshot does not reconcile.');
  return {kind,date:a.date,minute:a.minute,endMinute:b.minute,high,low,close,upper,lower,state:category};
 }
 const signal=Number(p[4]),[upper,lower]=p.slice(5,7).map(Number),[close,high,low]=p.slice(9,12).map(Number),s=nyParts(signal),window=Object.keys(WINDOW_BOUNDS).find(k=>WINDOW_BOUNDS[k][0]===a.minute&&WINDOW_BOUNDS[k][1]===b.minute);
 if(!window||s.date!==a.date||s.second||signal%300000)throw Error('Unsupported first-breach snapshot window.');
 const observation=observeFirstBreach({window,minute:s.minute,upper,lower,high,low,close});
 if(observation.side!==p[7]||observation.signalType!==p[8])throw Error('Snapshot direction/type does not reconcile.');
 return {kind,date:a.date,window,minute:s.minute,endMinute:b.minute,upper,lower,close,high,low,...observation};
}
