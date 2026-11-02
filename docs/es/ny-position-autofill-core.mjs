// Pure, completed-session position plan. No DOM writes, network requests,
// historical refitting or rounding before the canonical quarter selection.
import {nyPositionSelection} from './ny-position-helper.mjs';

const MARKETS=['CL','NQ','ES','GC'];
const MONTHS='[FGHJKMNQUVXZ]';
const TICKS={CL:.01,NQ:.25,ES:.25,GC:.1};
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const fail=message=>{throw Error(message);};
const validDate=value=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;
 const epoch=Date.parse(value+'T12:00:00Z');
 return Number.isFinite(epoch)&&new Date(epoch).toISOString().slice(0,10)===value;
};

function checkConvention(observed,expected){
 const valid=convention=>{
  if(!convention||!String(convention.status||'').startsWith('FROZEN')||!String(convention.id||'').trim()||convention.timeZone!=='America/New_York'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(convention.frozenUTC||'')||!Number.isFinite(Date.parse(convention.frozenUTC||'')))return false;
  return ['bboxSession','avrSession'].every(key=>{
   const window=convention[key];
   return window&&Number.isInteger(window.startMinute)&&Number.isInteger(window.endMinute)&&window.startMinute>=0&&window.startMinute<window.endMinute&&window.endMinute<=1440&&window.startMinute%5===0&&window.endMinute%5===0;
  });
 };
 if(!valid(expected)||!valid(observed)||observed.id!==expected.id||observed.frozenUTC!==expected.frozenUTC||['bboxSession','avrSession'].some(key=>['startMinute','endMinute'].some(field=>observed[key][field]!==expected[key][field])))fail('Gold closing positions require the matching reviewed AVR/BBOX convention.');
}

function checkedSession(input,{key,start,end,minutes,intervals}){
 if(!input||input.start!==start||input.end!==end||input.status!==undefined&&input.status!=='complete'||input.complete===false||input.coverage?.complete===false||Number(input.missingCount)>0||Number(input.coverage?.missingCount)>0)fail(`The completed ${key} session is missing or partial.`);
 if(!intervals.includes(input.intervalSeconds)||!Number.isInteger(input.count)||input.count!==minutes*60/input.intervalSeconds)fail(`The completed ${key} session has incomplete candle coverage.`);
 if(!['open','high','low','close'].every(field=>finite(input[field]))||!(input.high>input.low)||input.open<input.low||input.open>input.high||input.close<input.low||input.close>input.high)fail(`The completed ${key} high, low and closing price are inconsistent.`);
 return {start,end,open:input.open,high:input.high,low:input.low,close:input.close,count:input.count,intervalSeconds:input.intervalSeconds};
}

function checkCompletionClock(direction,date){
 if(direction.timeZone!==undefined&&direction.timeZone!=='America/New_York')fail('Closing positions require New York session times.');
 // The service's cutoff receipt is exclusive: 08:30 is known, but its H/L/C
 // are not part of Asia or London. Older compatible receipts may omit it.
 if(direction.completedThrough!==undefined){
  if(!Number.isSafeInteger(direction.completedThrough))fail('The completed-session cutoff is invalid.');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(direction.completedThrough*1000)).map(part=>[part.type,part.value]));
  if(`${parts.year}-${parts.month}-${parts.day}`!==date||parts.hour!=='08'||parts.minute!=='30')fail('The completed-session receipt does not end at this date’s 08:30 New York cutoff.');
  if(direction.quoteTime!==undefined&&(!Number.isSafeInteger(direction.quoteTime)||direction.quoteTime<direction.completedThrough))fail('The source has not reached the 08:30 completed-session cutoff.');
 }
}

/**
 * Own: (session close - that session low) / that session's high-low.
 * Prior: both closes measured against one prior NY BBOX high-low; values may
 * lie below zero or above one. Asia runs yesterday 19:30 through today 02:00;
 * London runs today 03:00 through 08:30. Their endpoint bars are excluded by
 * the versioned server receipt. Complete native 15m session OHLC are sufficient
 * for this position calculation; they never substitute for 5m close counts.
 */
export function computeNYPositionAutofill(result,{market,date,basis='bbox',mode='wide',convention}={}){
 if(!MARKETS.includes(market)||!validDate(date)||!['bbox','own'].includes(basis)||!['wide','exact'].includes(mode))fail('Choose a valid market, trading date and Own/Prior Exact/Wide method.');
 // A present but unavailable/invalid new receipt must not fall through to an
 // older observation. Position OHLC can be complete while unrelated 5m close
 // counts are unavailable, so the independent receipt is preferred.
 const independent=result&&Object.hasOwn(result,'nyPositions'),direction=independent?result.nyPositions:result?.nyDirection;
 const contractPattern=new RegExp('^'+market+MONTHS+'\\d{4}$');
 const schema=independent?'sessionpath.ny-positions.v1':'sessionpath.ny-direction.v1';
 if(!result||result.status!=='ready'||result.market!==market||result.date!==date||result.cutoff!=='08:30'||!contractPattern.test(result.contract||'')||!direction||direction.schema!==schema||direction.status!=='ready'||direction.market!==market||direction.date!==date||direction.contract!==result.contract||!(independent?[300,900]:[300]).includes(direction.intervalSeconds))fail('The completed-session feed does not match this market, date, contract and 08:30 cutoff.');
 if(independent&&(direction.timeZone!=='America/New_York'||!Number.isSafeInteger(direction.completedThrough)))fail('The completed-session position receipt needs its New York 08:30 cutoff.');
 checkCompletionClock(direction,date);
 if(market==='GC'){
  checkConvention(result.convention,convention);
  checkConvention(direction.convention,convention);
 }
 const sessions={
  asia:checkedSession(direction.asia,{key:'Asia 19:30–02:00',start:'19:30',end:'02:00',minutes:390,intervals:[300,900]}),
  london:checkedSession(direction.london,{key:'London 03:00–08:30',start:'03:00',end:'08:30',minutes:330,intervals:independent?[300,900]:[300]})
 };
 if(independent){
  for(const key of ['priorLow','priorHigh']){
   const observed=direction[key],expected=result.values?.[key];
   if(!finite(observed)||!finite(expected)||Math.abs(observed-expected)>TICKS[market]/1000+Number.EPSILON*Math.max(1,Math.abs(observed),Math.abs(expected))*8)fail('The closing-position receipt uses a different prior NY BBOX range.');
  }
 }
 let prior;
 if(basis==='bbox'){
  const low=result.values?.priorLow,high=result.values?.priorHigh;
  if(!finite(low)||!finite(high)||!(high>low))fail('The prior NY BBOX range is missing or has zero width.');
  prior={low,high};
 }
 const positions={},percentages={};
 for(const [key,session]of Object.entries(sessions)){
  const low=basis==='own'?session.low:prior.low,high=basis==='own'?session.high:prior.high;
  positions[key]=(session.close-low)/(high-low);
  percentages[key]=positions[key]*100;
  session.referenceLow=low;session.referenceHigh=high;
  if(!finite(positions[key])||!finite(percentages[key]))fail('A completed-session closing position could not be calculated.');
 }
 const selection=nyPositionSelection({...positions,basis,mode});
 return {market,date,contract:result.contract,basis,mode,sourceSchema:schema,positions,percentages,sessions,selection,method:selection.method,
  updates:{'ny-position-asia':percentages.asia,'ny-position-london':percentages.london}};
}
