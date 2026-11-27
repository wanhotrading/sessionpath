import {validPriorCoverage} from '../../../docs/prior-ny-coverage.mjs';
import {recoverCandleSnapshots} from './recovery.mjs';
export const PERSONAL_SCHEMA = 'sessionpath.personal.tradingview.v1';
export const PERSONAL_AVR_PROFILE = 'continuous-prior10-0930-1600-frozen-before1930-v1';
export const PERSONAL_MARKETS = Object.freeze({CL:0.01,NQ:0.25,ES:0.25,GC:0.1});
export const PERSONAL_CUTOFFS = ['03:00','05:00','08:30'];
export const DECISION_OPEN_TIMING = 'decision_open_v1';
export class FeedError extends Error {
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
const bad=(code)=>{throw new FeedError(code);};
const nyFormatter = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export function nyParts(ms){return Object.fromEntries(nyFormatter.formatToParts(new Date(ms)).map(p=>[p.type,p.value]));}
export function datePlus(date,days){return new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);}
export function validDate(date){return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;}
export function weekday(date){return ![0,6].includes(new Date(date+'T12:00:00Z').getUTCDay());}
export function previousWeekday(date){let prior=datePlus(date,-1);while(!weekday(prior))prior=datePlus(prior,-1);return prior;}
export function nyDate(ms){const p=nyParts(ms);return `${p.year}-${p.month}-${p.day}`;}
export function targetSessionDate(ms){const p=nyParts(ms),d=`${p.year}-${p.month}-${p.day}`;return Number(p.hour)*60+Number(p.minute)>=1170?datePlus(d,1):d;}
export function nyEpoch(date,clock){
  const base=Date.parse(date+'T'+clock+':00Z'); let guess=base;
  for(let i=0;i<3;i++){const p=nyParts(guess);const represented=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);guess+=base-represented;}
  return guess;
}
function instant(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))bad('INVALID_TIMESTAMP');const n=Date.parse(value);if(!Number.isFinite(n)||new Date(n).toISOString().replace('.000Z','Z')!==value.replace('.000Z','Z'))bad('INVALID_TIMESTAMP');return n;}
function keys(obj,allowed){if(!obj||typeof obj!=='object'||Array.isArray(obj)||Object.keys(obj).some(k=>!allowed.includes(k)))bad('UNEXPECTED_FIELDS');}
function price(value,tick){if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>1e9||Math.abs(value/tick-Math.round(value/tick))>0.00001)bad('INVALID_PRICE');return Number((Math.round(value/tick)*tick).toFixed(2));}
const snapshotKeys=['cutoff','as_of','reference_price','open_1930','range_high','range_low','prior_high','prior_low','prior_ny_date','prior_ny_count','avr','avr_count','avr_dates','avr_frozen_at','avr_override','last_hour_rule','asia_high','asia_low','asia_close','asia_complete','london_high','london_low','london_close','london_complete','ready','bbox_history','prior_exchange_close'];
const bboxHistoryKeys=['v','phases','first03','latest_minutes','attempts_up','attempts_down','earlier_close','inherited','past_high','past_low','last_hour_rv'];
// Same contiguous local chart segments as the historical research.
const bboxPhaseEnds=[120,180,300,510];
const bboxPhaseCounts={'03:00':2,'05:00':3,'08:30':4};
const sideMask=(upper,lower)=>(upper?1:0)|(lower?2:0);
function bboxSequenceMatches(prior,next){
  return prior.phases.every((phase,i)=>phase===null||phase===next.phases[i])&&
    (prior.first03===null||prior.first03===next.first03)&&
    prior.attempts_up<=next.attempts_up&&prior.attempts_down<=next.attempts_down&&
    (prior.earlier_close&next.earlier_close)===prior.earlier_close&&
    prior.past_high<=next.past_high&&prior.past_low>=next.past_low;
}
function normalizeBboxHistory(h,s,tick){
  keys(h,bboxHistoryKeys);
  const count=bboxPhaseCounts[s.cutoff];
  const validMask=value=>Number.isInteger(value)&&value>=0&&value<=3;
  if(h.v!==1||!Array.isArray(h.phases)||h.phases.length!==4||h.phases.some((phase,i)=>i<count?!validMask(phase):phase!==null))bad('INVALID_BBOX_HISTORY');
  const phases=[...h.phases];
  const overall=phases.slice(0,count).reduce((mask,phase)=>mask|phase,0);
  const rangeMask=(high,low)=>sideMask(high>s.prior_high,low<s.prior_low);
  if(phases[0]!==rangeMask(s.asia_high,s.asia_low))bad('INVALID_BBOX_ASIA_HISTORY');
  if(count===4&&(phases[2]|phases[3])!==rangeMask(s.london_high,s.london_low))bad('INVALID_BBOX_LONDON_HISTORY');
  if(count===2?h.first03!==null:!validMask(h.first03)||(h.first03&phases[2])!==h.first03)bad('INVALID_BBOX_FIRST_LONDON_BAR');
  const lastPhase=phases.findLastIndex(value=>value!==null&&value>0);
  if(lastPhase<0){
    if(h.latest_minutes!==null)bad('INVALID_BBOX_BREACH_TIME');
  }else {
    const lastClose=bboxPhaseEnds[count-1]-h.latest_minutes;
    const phaseStart=bboxPhaseEnds[lastPhase-1]??-270;
    if(!Number.isInteger(h.latest_minutes)||h.latest_minutes<0||h.latest_minutes%5||lastClose<=phaseStart||lastClose>bboxPhaseEnds[lastPhase])bad('INVALID_BBOX_BREACH_TIME');
  }
  const attemptLimit=2*(bboxPhaseEnds[count-1]+270)/5;
  for(const [attempts,bit] of [[h.attempts_up,1],[h.attempts_down,2]]){
    if(!Number.isInteger(attempts)||attempts<0||attempts>attemptLimit||(attempts>0&&!(overall&bit)))bad('INVALID_BBOX_ATTEMPTS');
  }
  const openSide=rangeMask(s.open_1930,s.open_1930);
  if(!validMask(h.earlier_close)||(h.earlier_close&overall)!==h.earlier_close||h.inherited!==openSide||
    (h.inherited&phases[0])!==h.inherited)bad('INVALID_BBOX_SIDE');
  const high=price(h.past_high,tick),low=price(h.past_low,tick);
  if(high<low||Math.max(high,s.reference_price)!==s.range_high||Math.min(low,s.reference_price)!==s.range_low||
    s.open_1930<low||s.open_1930>high||s.asia_high>high||s.asia_low<low||
    (count===4&&(s.london_high>high||s.london_low<low))||rangeMask(high,low)!==overall)bad('INVALID_BBOX_RANGE');
  if(typeof h.last_hour_rv!=='number'||!Number.isFinite(h.last_hour_rv)||h.last_hour_rv<0||
    h.last_hour_rv>Math.sqrt(12)*(high-low)+1e-5)bad('INVALID_BBOX_VOLATILITY');
  return {v:1,phases,first03:h.first03,latest_minutes:h.latest_minutes,attempts_up:h.attempts_up,
    attempts_down:h.attempts_down,earlier_close:h.earlier_close,inherited:h.inherited,
    past_high:high,past_low:low,last_hour_rv:h.last_hour_rv};
}
export function normalizeSnapshot(s,{date,market,observedMs,tick,decisionOpen}){
  keys(s,snapshotKeys);
  const asOf = instant(s.as_of);
  if (!PERSONAL_CUTOFFS.includes(s.cutoff) || asOf !== nyEpoch(date,s.cutoff)) bad('INVALID_CUTOFF');
  // An exact-open packet may publish only its newest cutoff at this boundary.
  // Earlier snapshots and legacy senders keep the original completed-bar rule.
  if (decisionOpen ? observedMs !== asOf : observedMs < asOf + 300000) bad('INVALID_CUTOFF');
  if(!validDate(s.prior_ny_date)||s.prior_ny_date!==previousWeekday(date))bad('INVALID_PRIOR_SESSION');
  if(s.ready!==true||s.avr_override!==false||s.avr_count!==10||!validPriorCoverage(s)||s.asia_complete!==true||!Number.isInteger(s.last_hour_rule)||s.last_hour_rule<1||s.last_hour_rule>5)bad('INCOMPLETE_SNAPSHOT');
  if(typeof s.avr!=='number'||!Number.isFinite(s.avr)||s.avr<=0||s.avr>1e9)bad('INVALID_AVR');
  const frozen=nyEpoch(datePlus(date,-1),'19:30');
  if(instant(s.avr_frozen_at)!==frozen)bad('INVALID_AVR_FREEZE');
  if(!Array.isArray(s.avr_dates)||s.avr_dates.length!==10||s.avr_dates.some((d,i)=>!validDate(d)||!weekday(d)||d>=date||(i>0&&d<=s.avr_dates[i-1])||nyEpoch(d,'16:00')>frozen))bad('INVALID_AVR_DATES');
  const result={cutoff:s.cutoff,as_of:new Date(instant(s.as_of)).toISOString()};
  for(const k of ['reference_price','open_1930','range_high','range_low','prior_high','prior_low'])result[k]=price(s[k],tick);
  if(result.prior_high<=result.prior_low||result.range_high<result.range_low||[result.open_1930,result.reference_price].some(v=>v<result.range_low||v>result.range_high))bad('INCONSISTENT_PRICES');
  Object.assign(result,{prior_ny_date:s.prior_ny_date,prior_ny_count:s.prior_ny_count,...(s.prior_exchange_close?{prior_exchange_close:s.prior_exchange_close}:{}),avr:s.avr,avr_count:10,avr_dates:[...s.avr_dates],avr_frozen_at:new Date(frozen).toISOString(),avr_override:false,last_hour_rule:s.last_hour_rule});
  for(const k of ['asia_high','asia_low','asia_close'])result[k]=price(s[k],tick);
  if(result.asia_high<=result.asia_low||result.asia_close<result.asia_low||result.asia_close>result.asia_high||result.asia_high>result.range_high||result.asia_low<result.range_low)bad('INCONSISTENT_ASIA');
  result.asia_complete=true;
  const londonReady=s.cutoff==='08:30';
  if(s.london_complete!==londonReady)bad('INVALID_LONDON_STATE');
  for(const k of ['london_high','london_low','london_close']){if(londonReady)result[k]=price(s[k],tick);else {if(s[k]!==null)bad('FUTURE_LONDON_VALUES');result[k]=null;}}
  if(londonReady&&(result.london_high<=result.london_low||result.london_close<result.london_low||result.london_close>result.london_high||result.london_high>result.range_high||result.london_low<result.range_low))bad('INCONSISTENT_LONDON');
  result.london_complete=londonReady;result.ready=true;
  if(market!=='GC'&&Object.hasOwn(s,'bbox_history')){
    // An invalid optional attestation must not disable ordinary Auto-fill.
    try{result.bbox_history=normalizeBboxHistory(s.bbox_history,result,tick);}
    catch(error){if(!(error instanceof FeedError))throw error;}
  }
  return result;
}
export function normalizePacket(input,{now=Date.now()}={}){
  keys(input,['schema','token','market','source_symbol','timeframe','timezone','observed_at','sent_at','session_date','avr_profile','feed_type','backadjustment','snapshots','last_price','confirmed','checkpoint_timing','research_bars','recovery']);
  if(input.schema!==PERSONAL_SCHEMA||!Object.hasOwn(PERSONAL_MARKETS,input.market)||input.source_symbol!==input.market+'1!'||input.timeframe!=='5'||input.timezone!=='America/New_York'||input.confirmed!==true||input.feed_type!=='continuous_front_contract'||input.backadjustment!=='off'||input.avr_profile!==PERSONAL_AVR_PROFILE)bad('INVALID_FEED');
  const observedMs=instant(input.observed_at),sentMs=instant(input.sent_at);
  if(observedMs%300000||observedMs>now+5000||now-observedMs>180000||sentMs<observedMs||sentMs>now+30000||now-sentMs>180000||sentMs-observedMs>180000)bad('STALE_TRANSPORT');
  if(!validDate(input.session_date)||input.session_date!==targetSessionDate(observedMs-1))bad('SESSION_DATE_MISMATCH');
  if(!Array.isArray(input.snapshots)||input.snapshots.length>3)bad('INVALID_SNAPSHOTS');
  const decisionOpen = Object.hasOwn(input,'checkpoint_timing');
  if (decisionOpen && (input.checkpoint_timing !== DECISION_OPEN_TIMING || input.snapshots.length === 0)) bad('INVALID_CHECKPOINT_TIMING');
  if (decisionOpen && observedMs > now) bad('STALE_TRANSPORT');
  const snapshots = input.snapshots.map((snapshot,index) => normalizeSnapshot(snapshot, {
    date: input.session_date,
    market: input.market,
    observedMs,
    tick: PERSONAL_MARKETS[input.market],
    decisionOpen: decisionOpen && index === input.snapshots.length - 1
  }));
  if (input.recovery && !decisionOpen && snapshots.length < 3) {
    try {
      const recovered = recoverCandleSnapshots(input.recovery,{date:input.session_date,market:input.market,observedMs,known:snapshots});
      const combined = [...snapshots,...recovered].sort((a,b)=>a.cutoff.localeCompare(b.cutoff));
      const shared = ['open_1930','prior_high','prior_low','prior_ny_date','prior_ny_count','avr','avr_dates','asia_high','asia_low','asia_close'];
      if (combined.every((s,i)=>s.cutoff===PERSONAL_CUTOFFS[i] && (!i ||
          shared.every(k=>JSON.stringify(s[k])===JSON.stringify(combined[0][k])) &&
          s.range_high>=combined[i-1].range_high && s.range_low<=combined[i-1].range_low))) snapshots.splice(0,snapshots.length,...combined);
    } catch (error) { if (!(error instanceof FeedError)) throw error; }
  }
  if(snapshots.some((s,i)=>i&&PERSONAL_CUTOFFS.indexOf(s.cutoff)<=PERSONAL_CUTOFFS.indexOf(snapshots[i-1].cutoff)))bad('DUPLICATE_OR_UNORDERED_CUTOFF');
  if(snapshots.length&&(!weekday(input.session_date)||nyDate(observedMs)!==input.session_date))bad('INVALID_SESSION_DATE');
  // Available snapshots are cumulative; a sender may omit a still-unready cutoff,
  // but must never skip an earlier ready cutoff and supply a later one.
  if(snapshots.some((s,i)=>s.cutoff!==PERSONAL_CUTOFFS[i]))bad('MISSING_EARLIER_CUTOFF');
  const shared=['open_1930','prior_high','prior_low','prior_ny_date','prior_ny_count','avr','avr_count','avr_dates','avr_frozen_at','asia_high','asia_low','asia_close'];
  if(snapshots.some((s,i)=>i&&(shared.some(k=>JSON.stringify(s[k])!==JSON.stringify(snapshots[0][k]))||s.range_high<snapshots[i-1].range_high||s.range_low>snapshots[i-1].range_low)))bad('INCONSISTENT_SNAPSHOT_SEQUENCE');
  let previousHistory=null;
  for(const snapshot of snapshots){
    if(!snapshot.bbox_history)continue;
    if(previousHistory&&!bboxSequenceMatches(previousHistory,snapshot.bbox_history))delete snapshot.bbox_history;
    else previousHistory=snapshot.bbox_history;
  }
  const tick=PERSONAL_MARKETS[input.market],lastPrice=price(input.last_price,tick);
  const researchBars=normalizeResearchBars(input.research_bars,{date:input.session_date,observedMs,tick,lastPrice});
  return {schema:PERSONAL_SCHEMA,market:input.market,source_symbol:input.source_symbol,timeframe:'5',timezone:'America/New_York',confirmed:true,observed_at:new Date(observedMs).toISOString(),sent_at:new Date(sentMs).toISOString(),session_date:input.session_date,avr_profile:PERSONAL_AVR_PROFILE,feed_type:'continuous_front_contract',backadjustment:'off',snapshots,last_price:lastPrice,...(decisionOpen?{checkpoint_timing:DECISION_OPEN_TIMING}:{}),...(researchBars?{research_bars:researchBars}:{})};
}

function normalizeResearchBars(values,{date,observedMs,tick,lastPrice}){
  if(!Array.isArray(values)||values.length===0||values.length>468||values.length%3)return null;
  const start=nyEpoch(date,'03:00'),end=nyEpoch(date,'16:00');
  const expected=(Math.min(observedMs,end)-start)/300000;
  if(expected!==values.length/3)return null;
  for(let i=0;i<values.length;i+=3){
    const [high,low,close]=[values[i],values[i+1],values[i+2]];
    if(high===null&&low===null&&close===null)continue;
    if(![high,low,close].every(x=>Number.isSafeInteger(x)&&x>0&&x*tick<=1e9)||high<close||close<low)return null;
  }
  if(observedMs<=end&&Math.abs(values.at(-1)*tick-lastPrice)>1e-7)return null;
  return values;
}

