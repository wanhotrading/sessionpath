import {instrument} from './instrument.mjs';
import {rate} from './research-core.mjs';
import {nyTimestamp} from './planner-v3.mjs';
export const returnClock=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
export function checkpointMinute(clock){
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock))return null;
 const m=Number(clock.slice(0,2))*60+Number(clock.slice(3));
 return m>=180&&m<510?Math.floor(m/30)*30:null;
}
export function makeBBoxReturnCode(q,result,observedClock=''){
 const r=result.remaining;
 if(!r.n)return '';
 const m=observedClock?Number(observedClock.slice(0,2))*60+Number(observedClock.slice(3)):q.anchor;
 if(observedClock&&checkpointMinute(observedClock)!==q.anchor)throw Error('Observation time must belong to the selected checkpoint.');
 const start=nyTimestamp(q.date,q.now??m),end=nyTimestamp(q.date,q.end),anchor=nyTimestamp(q.date,q.anchor);
 const code=[instrument.returnPrefix,start,end,q.side,q.group,r.k,r.n,(100*r.lo).toFixed(4),(100*r.hi).toFixed(4),anchor,q.now===null?0:1].join('|');
 parseBBoxReturnCode(code);return code;
}
export function parseBBoxReturnCode(code){
 const a=String(code).trim().split('|'),v=a.slice(1).map(Number);
 if(a.length!==11||a[0]!==instrument.returnPrefix||a.slice(1).some(x=>!x.trim())||v.some(x=>!Number.isFinite(x)))throw Error('Invalid BBOX return code.');
 const [start,end,side,group,k,n,lo,hi,anchor,conditional]=v;
 if(![start,end,anchor,k,n].every(Number.isInteger)||start<=0||start<anchor||end<=start||end-anchor>6*3600000||![1,-1].includes(side)||![0,1,2,3].includes(group)||![0,1].includes(conditional)||n<1||k<0||k>n||lo<0||hi>100||lo>100*k/n||hi<100*k/n)throw Error('Invalid BBOX return values.');
 return {start,end,side,group,k,n,lo,hi,anchor,conditional};
}
export function matchesReturnGroup(s,group){
 return group===null||group===0&&s[2]===0||group===1&&s[2]===1||group===2&&s[4]===-s[1]||group===3&&s[4]===0;
}
export function remainingChanceCurve(cases,start,end){
 return Array.from({length:(end-start)/5+1},(_,i)=>start+i*5).map(minute=>{
  const eligible=cases.filter(r=>r.first===null||r.first>minute);
  return {minute,...rate(eligible.filter(r=>r.first!==null&&r.first<=end).length,eligible.length)};
 });
}
export function bboxReturnStats(days,{date,year='',anchor,now,end,side,group,observation=null}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))throw Error('Choose a trading date in Session inputs.');
 const exact=observation!==null,start=exact?observation:anchor+30;
 if(exact&&(!Number.isInteger(observation)||observation%5!==0||observation<185||observation>505))throw Error('Use a completed five-minute observation from 03:05 through 08:25.');
 if(!Number.isInteger(anchor)||anchor%30!==0||anchor<180||anchor>480||!Number.isInteger(end)||end%5!==0||end<(exact?observation+5:anchor+30)||end>510||now!==null&&(!Number.isInteger(now)||now%5!==0||now<start||now>end||now===end&&!exact))throw Error('Choose a deadline after the observation and an update time before the deadline. Block updates begin after the whole block.');
 if(![1,-1].includes(side)||!(group===null||[0,1,2,3].includes(group)))throw Error('Select U or D and the observed box condition.');
 const base=[];
 for(const d of days){
  if(d.date>=date||(year&&d.date.slice(0,4)!==year))continue;
  // One first qualifying observation per date, side and condition in this block.
  const s=d.signals.filter(x=>(exact?x[0]===observation:x[0]>=anchor&&x[0]<anchor+30)&&x[1]===side&&matchesReturnGroup(x,group)).sort((a,b)=>a[0]-b[0])[0];
  if(s)base.push({date:d.date,observed:s[0],first:s[3]});
 }
 const remaining=base.filter(r=>now===null||r.first===null||r.first>now);
 const hits=rs=>rs.filter(r=>r.first!==null&&r.first<=end).length;
 const summarize=rs=>rate(hits(rs),rs.length);
 return {original:summarize(base),remaining:summarize(remaining),alreadyReturned:base.length-remaining.length,decay:remainingChanceCurve(base,start,end),
  byYear:['2022','2023','2024','2025','2026'].map(year=>({year,...summarize(remaining.filter(r=>r.date.startsWith(year)))})),
  curve:Array.from({length:(end-(now??anchor))/5},(_,i)=>(now??anchor)+5*(i+1)).filter(minute=>minute>=anchor+30).map(minute=>({minute,...rate(remaining.filter(r=>r.first!==null&&r.first<=minute).length,remaining.length)})),
  cases:remaining.map(r=>({...r,returned:r.first!==null&&r.first<=end}))};
}
