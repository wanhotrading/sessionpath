// Auto-fill measures completed sessions. It does not change the research model.
import {deriveRows,selectMatches,bucket,mean,pathClass} from './window-engine.mjs';
import {utilization} from './utilization-core.mjs';

const EPS=1e-9;
const WINDOWS=Object.freeze({three:{start:'03:00',end:'05:00',minute:180,endMinute:300,count:24},five:{start:'05:00',end:'08:30',minute:300,endMinute:510,count:42}});
const CL_COLUMNS=['date','contract','rangeAvr','upAvr','downAvr','bboxPosition','closeInRunningRange','observedPath','nextHighAvr','nextLowAvr'];
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const validDate=x=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(x||''))return false;const t=Date.parse(x+'T12:00:00Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===x;};
const near=(a,b)=>Math.abs(a-b)<=EPS*Math.max(1,Math.abs(a),Math.abs(b));
const fail=message=>{throw Error(message);};

export function classifyCompletedCloses(closes,open,expectedCount){
 if(!finite(open)||!Array.isArray(closes)||closes.length!==expectedCount||!closes.every(finite))fail('A complete five-minute close sequence is required.');
 const up=closes.filter(close=>close>open+EPS).length,down=closes.filter(close=>close<open-EPS).length,equal=closes.length-up-down;
 const tilt=up>down?'U':down>up?'D':'TIE';
 const strength=up/closes.length>=.9-EPS?'U90':down/closes.length>=.9-EPS?'D90':tilt;
 return {up,down,equal,total:closes.length,upShare:up/closes.length,downShare:down/closes.length,tilt,strength};
}

function checkHistory(market,days,timeline){
 if(!Array.isArray(days)||!days.length||!timeline||!Array.isArray(Array.isArray(timeline)?timeline:timeline.rows))fail('This market’s historical model is not ready.');
 if(timeline.instrument&&timeline.instrument!==market)fail('The historical model belongs to a different market.');
 const contract=new RegExp('^'+market+'[FGHJKMNQUVXZ]\\d{4}$');
 if(days.some(day=>!day||day.instrument&&day.instrument!==market||!contract.test(day.contract||'')||!validDate(day.date)))fail('The historical model contains a different or unverified market.');
}

function clWindowHistory(history,key,date){
 if(!history||history.schema!=='sessionpath.ny-direction-cl-history.v1'||history.market!=='CL'||JSON.stringify(history.columns)!==JSON.stringify(CL_COLUMNS)||!Array.isArray(history.windows?.[key]))fail('The canonical CL utilization history is not ready.');
 const definition=WINDOWS[key],days=[],rows=[];
 for(const record of history.windows[key]){
  if(!Array.isArray(record)||record.length!==CL_COLUMNS.length||!validDate(record[0])||!/^CL[FGHJKMNQUVXZ]\d{4}$/.test(record[1]||'')||![2,3,4,5,8,9].every(index=>finite(record[index]))||record[6]!==null&&!finite(record[6])||!Array.isArray(record[7])||record[7].length!==12||!record[7].every(finite)||record[8]<0||record[9]>0)fail('The canonical CL utilization history is inconsistent.');
  if(record[0]>=date)continue;
  const index=days.length;days.push({index,date:record[0],contract:record[1],tags:[],knownTags:[]});
  rows.push({dayIndex:index,minute:definition.minute,endMinute:definition.endMinute,...Object.fromEntries(CL_COLUMNS.slice(2).map((column,i)=>[column,record[i+2]]))});
 }
 return {days,rows};
}

function checkedCloses(input,definition){
 if(!input||input.status!=='complete'||input.start!==definition.start||input.end!==definition.end)fail(`${definition.start}–${definition.end} is not complete in the delayed feed.`);
 const {open,high,low,snapshot:s}=input;
 if(![open,high,low].every(finite)||high<low||open>high+EPS||open<low-EPS)fail('The completed session prices are inconsistent.');
 const counts=classifyCompletedCloses(input.closes,open,definition.count);
 if(input.closes.some(close=>close>high+EPS||close<low-EPS))fail('A completed close is outside the supplied session range.');
 if(input.closeCounts&&['up','down','equal','total'].some(key=>input.closeCounts[key]!==counts[key]))fail('The completed close counts could not be verified.');
 return counts;
}

function checkedWindow(input,definition,avr){
 const counts=checkedCloses(input,definition),{open,high,low,snapshot:s}=input;
 if(!s||!['runningHigh','runningLow','open1930','priorHigh','priorLow','decisionOpen','previousHourBaseClose'].every(key=>finite(s[key]))||!(s.priorHigh>s.priorLow)||s.runningHigh<s.runningLow||s.runningHigh<Math.max(s.open1930,s.decisionOpen)-EPS||s.runningLow>Math.min(s.open1930,s.decisionOpen)+EPS||!near(s.decisionOpen,open))fail('The decision-time snapshot is incomplete or inconsistent.');
 if(!Array.isArray(s.previousHourCloses)||s.previousHourCloses.length!==12||!s.previousHourCloses.every(finite)||s.previousHourCloses.some(close=>close>s.runningHigh+EPS||close<s.runningLow-EPS))fail('The completed hour before the decision is incomplete.');
 const range=s.runningHigh-s.runningLow,priorWidth=s.priorHigh-s.priorLow;
 const q={minute:definition.minute,endMinute:definition.endMinute,price:open,avr,printed:range/avr,up:(s.runningHigh-s.open1930)/avr,down:(s.open1930-s.runningLow)/avr,q:(open-s.priorLow)/priorWidth,rangePosition:range>EPS?(open-s.runningLow)/range:null,location:bucket((open-s.priorLow)/priorWidth),behavior:pathClass(s.previousHourCloses.map(close=>(close-s.previousHourBaseClose)/avr)),tags:[],observations:[],limit:50};
 const actualUp=Math.max(0,high-open),actualDown=Math.max(0,open-low);
 if(finite(input.actualUp)&&!near(input.actualUp,actualUp)||finite(input.actualDown)&&!near(input.actualDown,actualDown))fail('The observed session excursions could not be verified.');
 return {q,actualUp,actualDown,counts};
}

function checkFeed(market,date,nyDirection){
 if(!['CL','NQ','ES'].includes(market))fail('Select CL, NQ or ES before auto-fill.');
 if(!validDate(date))fail('Choose a valid New York trading date.');
 const contract=new RegExp('^'+market+'[FGHJKMNQUVXZ]\\d{4}$');
 if(!nyDirection||nyDirection.schema!=='sessionpath.ny-direction.v1'||nyDirection.status!=='ready'||nyDirection.market!==market||nyDirection.date!==date||!contract.test(nyDirection.contract||'')||nyDirection.intervalSeconds!==300)fail('The completed-session feed does not match this market, date and five-minute interval.');
}

// Close-count dominance has no forecast or AVR denominator. It remains usable
// when a user has not yet supplied the frozen AVR for the utilization measure.
export function computeNYCloseArchiveAutofill({market,date,nyDirection}){
 checkFeed(market,date,nyDirection);
 const result={market,date,contract:nyDirection.contract,windows:{},updates:{}};
 for(const [key,definition]of Object.entries(WINDOWS)){
  const counts=checkedCloses(nyDirection.windows?.[key],definition);
  result.windows[key]={start:definition.start,end:definition.end,counts,closeCounts:counts,strength:counts.strength};
  result.updates[`ny-strength-${key}`]=counts.strength;
 }
 return result;
}

export function computeNYDirectionAutofill({market,date,avr,nyDirection,days,timeline,clHistory}){
 checkFeed(market,date,nyDirection);
 if(!(finite(avr)&&avr>0))fail('Enter the positive frozen 19:30 AVR to calculate forecast utilization.');
 if(market!=='CL')checkHistory(market,days,timeline);
 // Filter before deriving outcomes. A current or future historical row is never
 // consulted, even if a replay dataset contains its later candles.
 const earlier=market==='CL'?null:days.filter(day=>day.date<date);
 if(earlier&&!earlier.length)fail('There are no earlier dates to reconstruct these Mean forecasts.');
 const result={market,date,contract:nyDirection.contract,avr,model:'earlier-only Mean; fixed 50 nearest matches; no optional filters',windows:{},updates:{}};
 for(const [key,definition]of Object.entries(WINDOWS)){
  const observed=checkedWindow(nyDirection.windows?.[key],definition,avr);
  const q={...observed.q,date,beforeDate:date};
  const history=market==='CL'?clWindowHistory(clHistory,key,date):{days:earlier,rows:deriveRows(earlier,timeline,definition.minute,definition.endMinute)};
  const selected=selectMatches(history.days,history.rows,q).matches;
  if(!selected.length)fail(`No earlier Mean forecast matches for ${definition.start}–${definition.end}.`);
  const forecastUp=mean(selected.map(match=>match.row.nextHighAvr))*avr,forecastDown=mean(selected.map(match=>-match.row.nextLowAvr))*avr;
  const used=utilization({actualUp:observed.actualUp,actualDown:observed.actualDown,forecastUp,forecastDown});
  if(!used)fail(`The ${definition.start}–${definition.end} forecast has a missing or nonpositive side.`);
  const cohortDates=selected.map(match=>match.day.date);
  if(cohortDates.some(day=>day>=date))fail('An unavailable historical date entered the forecast.');
  result.windows[key]={start:definition.start,end:definition.end,open:observed.q.price,actualUp:observed.actualUp,actualDown:observed.actualDown,forecastUp,forecastDown,upPercent:used.up*100,downPercent:used.down*100,upBand:used.upBand,downBand:used.downBand,tilt:used.tilt,counts:observed.counts,closeCounts:observed.counts,strength:observed.counts.strength,cases:selected.length,thin:selected.length<50,cohortDates,query:q};
  result.updates[`util-${key}-up`]=used.up*100;
  result.updates[`util-${key}-down`]=used.down*100;
  result.updates[`ny-strength-${key}`]=observed.counts.strength;
 }
 return result;
}
