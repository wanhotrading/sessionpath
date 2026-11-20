// validation.mjs
const PERSONAL_SCHEMA = 'sessionpath.personal.tradingview.v1';
const PERSONAL_AVR_PROFILE = 'continuous-prior10-0930-1600-frozen-before1930-v1';
const PERSONAL_MARKETS = Object.freeze({CL:0.01,NQ:0.25,ES:0.25,GC:0.1});
const PERSONAL_CUTOFFS = ['03:00','05:00','08:30'];
const DECISION_OPEN_TIMING = 'decision_open_v1';
class FeedError extends Error {
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
const bad=(code)=>{throw new FeedError(code);};
const nyFormatter = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function nyParts(ms){return Object.fromEntries(nyFormatter.formatToParts(new Date(ms)).map(p=>[p.type,p.value]));}
function datePlus(date,days){return new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);}
function validDate(date){return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;}
function weekday(date){return ![0,6].includes(new Date(date+'T12:00:00Z').getUTCDay());}
function previousWeekday(date){let prior=datePlus(date,-1);while(!weekday(prior))prior=datePlus(prior,-1);return prior;}
function nyDate(ms){const p=nyParts(ms);return `${p.year}-${p.month}-${p.day}`;}
function targetSessionDate(ms){const p=nyParts(ms),d=`${p.year}-${p.month}-${p.day}`;return Number(p.hour)*60+Number(p.minute)>=1170?datePlus(d,1):d;}
function nyEpoch(date,clock){
  const base=Date.parse(date+'T'+clock+':00Z'); let guess=base;
  for(let i=0;i<3;i++){const p=nyParts(guess);const represented=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);guess+=base-represented;}
  return guess;
}
function instant(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))bad('INVALID_TIMESTAMP');const n=Date.parse(value);if(!Number.isFinite(n)||new Date(n).toISOString().replace('.000Z','Z')!==value.replace('.000Z','Z'))bad('INVALID_TIMESTAMP');return n;}
function keys(obj,allowed){if(!obj||typeof obj!=='object'||Array.isArray(obj)||Object.keys(obj).some(k=>!allowed.includes(k)))bad('UNEXPECTED_FIELDS');}
function price(value,tick){if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>1e9||Math.abs(value/tick-Math.round(value/tick))>0.00001)bad('INVALID_PRICE');return Number((Math.round(value/tick)*tick).toFixed(2));}
const snapshotKeys=['cutoff','as_of','reference_price','open_1930','range_high','range_low','prior_high','prior_low','prior_ny_date','prior_ny_count','avr','avr_count','avr_dates','avr_frozen_at','avr_override','last_hour_rule','asia_high','asia_low','asia_close','asia_complete','london_high','london_low','london_close','london_complete','ready','bbox_history'];
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
function normalizeSnapshot(s,{date,market,observedMs,tick,decisionOpen}){
  keys(s,snapshotKeys);
  const asOf = instant(s.as_of);
  if (!PERSONAL_CUTOFFS.includes(s.cutoff) || asOf !== nyEpoch(date,s.cutoff)) bad('INVALID_CUTOFF');
  // An exact-open packet may publish only its newest cutoff at this boundary.
  // Earlier snapshots and legacy senders keep the original completed-bar rule.
  if (decisionOpen ? observedMs !== asOf : observedMs < asOf + 300000) bad('INVALID_CUTOFF');
  if(s.ready!==true||s.avr_override!==false||s.avr_count!==10||s.prior_ny_count!==78||s.asia_complete!==true||!Number.isInteger(s.last_hour_rule)||s.last_hour_rule<1||s.last_hour_rule>5)bad('INCOMPLETE_SNAPSHOT');
  if(typeof s.avr!=='number'||!Number.isFinite(s.avr)||s.avr<=0||s.avr>1e9)bad('INVALID_AVR');
  const frozen=nyEpoch(datePlus(date,-1),'19:30');
  if(instant(s.avr_frozen_at)!==frozen)bad('INVALID_AVR_FREEZE');
  if(!validDate(s.prior_ny_date)||s.prior_ny_date!==previousWeekday(date))bad('INVALID_PRIOR_SESSION');
  if(!Array.isArray(s.avr_dates)||s.avr_dates.length!==10||s.avr_dates.some((d,i)=>!validDate(d)||!weekday(d)||d>=date||(i>0&&d<=s.avr_dates[i-1])||nyEpoch(d,'16:00')>frozen)||s.avr_dates[9]!==s.prior_ny_date)bad('INVALID_AVR_DATES');
  const result={cutoff:s.cutoff,as_of:new Date(instant(s.as_of)).toISOString()};
  for(const k of ['reference_price','open_1930','range_high','range_low','prior_high','prior_low'])result[k]=price(s[k],tick);
  if(result.prior_high<=result.prior_low||result.range_high<result.range_low||[result.open_1930,result.reference_price].some(v=>v<result.range_low||v>result.range_high))bad('INCONSISTENT_PRICES');
  Object.assign(result,{prior_ny_date:s.prior_ny_date,prior_ny_count:78,avr:s.avr,avr_count:10,avr_dates:[...s.avr_dates],avr_frozen_at:new Date(frozen).toISOString(),avr_override:false,last_hour_rule:s.last_hour_rule});
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
function normalizePacket(input,{now=Date.now()}={}){
  keys(input,['schema','token','market','source_symbol','timeframe','timezone','observed_at','sent_at','session_date','avr_profile','feed_type','backadjustment','snapshots','last_price','confirmed','checkpoint_timing','research_bars']);
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

// state.mjs

function addsBoundaryAtSameObservation(current,incoming){
  if (incoming.observedMs !== current.observedMs || incoming.packet.session_date !== current.packet.session_date || incoming.packet.checkpoint_timing !== DECISION_OPEN_TIMING) return false;
  const boundary = incoming.packet.snapshots.at(-1);
  return boundary?.as_of === incoming.packet.observed_at && !Object.hasOwn(current.snapshotHashes,boundary.cutoff);
}

function canAddBboxHistory(original,candidate){
  if(!original||original.bbox_history||!candidate?.bbox_history)return false;
  const {bbox_history,...candidateInputs}=candidate;
  return JSON.stringify(original)===JSON.stringify(candidateInputs);
}

function addsHistoryAtSameObservation(current,incoming){
  return incoming.observedMs===current.observedMs&&incoming.packet.session_date===current.packet.session_date&&
    incoming.packet.snapshots.some(candidate=>canAddBboxHistory(current.packet.snapshots.find(s=>s.cutoff===candidate.cutoff),candidate));
}
function addsResearchAtSameObservation(current,incoming){
  return incoming.observedMs===current.observedMs&&incoming.packet.session_date===current.packet.session_date&&
    incoming.packet.research_bars&&!current.packet.research_bars;
}

function decideFeedUpdate(current,incoming){
  // A historical-feed correction must not stop a fresh transport heartbeat.
  // Snapshot immutability is enforced by retaining first-accepted values below.
  if(current&&incoming.observedMs<=current.observedMs&&!addsBoundaryAtSameObservation(current,incoming)&&!addsHistoryAtSameObservation(current,incoming)&&!addsResearchAtSameObservation(current,incoming))return {status:incoming.packetHash===current.packetHash||incoming.packetHash===current.reconciliation?.sourcePacketHash?'duplicate':'ignored'};
  if(current&&incoming.packet.session_date<current.packet.session_date)return {status:'ignored'};
  return {status:'accepted'};
}
const frozenCutoffs=['03:00','05:00','08:30'];
async function stateHash(value){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function initialProvenance(entry,cutoff,basis){
  return {sourceObservedAt:entry.packet.observed_at,receivedAt:entry.receivedAt,sourcePacketHash:entry.reconciliation?.sourcePacketHash??entry.packetHash,snapshotHash:entry.snapshotHashes[cutoff],basis};
}
async function reconcileFrozenCheckpoints(current,incoming){
  const sameDay=current?.packet.session_date===incoming.packet.session_date;
  const prior=new Map((sameDay?current.packet.snapshots:[]).map(snapshot=>[snapshot.cutoff,snapshot]));
  const supplied=new Map(incoming.packet.snapshots.map(snapshot=>[snapshot.cutoff,snapshot]));
  const snapshots=[],snapshotHashes={},checkpointProvenance={},retainedCutoffs=[],revisedCutoffs=[],missingCutoffs=[],addedCutoffs=[],historyAddedCutoffs=[],changedFields={};
  for(const cutoff of frozenCutoffs){
    const original=prior.get(cutoff),candidate=supplied.get(cutoff);
    if(original){
      const addingHistory=canAddBboxHistory(original,candidate);
      snapshots.push(addingHistory?candidate:original);
      snapshotHashes[cutoff]=addingHistory?incoming.snapshotHashes[cutoff]:current.snapshotHashes[cutoff];
      retainedCutoffs.push(cutoff);
      checkpointProvenance[cutoff]=current.checkpointProvenance?.[cutoff]??initialProvenance(current,cutoff,'legacy-receipt');
      if(addingHistory){
        historyAddedCutoffs.push(cutoff);
        checkpointProvenance[cutoff]={...checkpointProvenance[cutoff],bboxHistory:initialProvenance(incoming,cutoff,'enriched-matching-checkpoint')};
      }else if(!candidate)missingCutoffs.push(cutoff);
      else if(incoming.snapshotHashes[cutoff]!==current.snapshotHashes[cutoff]){
        revisedCutoffs.push(cutoff);
        changedFields[cutoff]=Object.keys(original).filter(key=>JSON.stringify(original[key])!==JSON.stringify(candidate[key]));
      }
    }else if(candidate){
      // The caller independently validated this fresh publisher packet before
      // storage. The first verified value for a NEW decision is kept verbatim,
      // including source corrections; never fabricate an older baseline into it.
      snapshots.push(candidate);snapshotHashes[cutoff]=incoming.snapshotHashes[cutoff];addedCutoffs.push(cutoff);
      checkpointProvenance[cutoff]=initialProvenance(incoming,cutoff,'first-received');
    }
  }
  // Keep transport timestamps and the reported quote when an authenticated
  // boundary or matching history enriches the same observation.
  const addingBoundary = current && addsBoundaryAtSameObservation(current,incoming);
  const sameObservation = current && (addingBoundary || addsHistoryAtSameObservation(current,incoming) || addsResearchAtSameObservation(current,incoming));
  const packet = sameObservation
    ? {...current.packet,...(addingBoundary?{checkpoint_timing:DECISION_OPEN_TIMING}:{}),snapshots}
    : {...incoming.packet,snapshots};
  const researchBars=(sameDay?current.packet.research_bars:null)||[];
  const suppliedBars=incoming.packet.research_bars||[];
  const length=Math.max(researchBars.length,suppliedBars.length);
  // A later delivery can fill gaps or extend coverage. Freeze the first H/L/C
  // to prevent a provider correction changing an already displayed first breach.
  if(length)packet.research_bars=Array.from({length},(_,i)=>researchBars[i]??suppliedBars[i]??null);
  const endpointCloses={...(sameDay?current.packet.endpoint_closes:null)};
  for(const cutoff of ['05:00','08:30']){
    const snapshot=snapshots.find(s=>s.cutoff===cutoff);
    if(nyEpoch(incoming.packet.session_date,cutoff)===incoming.observedMs)endpointCloses[cutoff]??=incoming.packet.last_price;
    if(cutoff==='08:30'&&snapshot?.london_complete)endpointCloses[cutoff]??=snapshot.london_close;
  }
  if(Object.keys(endpointCloses).length)packet.endpoint_closes=endpointCloses;
  const reconciliation={schema:'sessionpath.tradingview.reconciliation.v1',policy:'first-accepted-per-checkpoint',status:revisedCutoffs.length||missingCutoffs.length?'preserved_frozen':'aligned',sourceObservedAt:incoming.packet.observed_at,sourcePacketHash:incoming.packetHash,retainedCutoffs,revisedCutoffs,missingCutoffs,addedCutoffs,changedFields,...(historyAddedCutoffs.length?{historyAddedCutoffs}:{})};
  // The composite can contain first-accepted checkpoints from different source
  // revisions. Its own hash must describe the stored packet, not a rejected
  // replacement; per-cutoff provenance identifies each authenticated source.
  const packetHash=JSON.stringify(packet)===JSON.stringify(incoming.packet)?incoming.packetHash:await stateHash(packet);
  const transport = sameObservation ? current : incoming;
  return {...transport,packet,packetHash,snapshotHashes,checkpointProvenance,reconciliation};
}
// SQLite-backed Durable Objects also expose the transactional KV storage API.
// Keep frozen daily inputs separately from the live heartbeat. Neither record
// contains a token; unchanged five-minute heartbeats do not rewrite history.
const MAX_HISTORY_DATES=1024;
class PersonalFeedStore {
  constructor(storage,{historyLimit=MAX_HISTORY_DATES}={}){this.storage=storage;this.historyLimit=historyLimit;}
  async getLatest(){return (await this.storage.get('latest'))??null;}
  async getHistory(date){
    const saved=await this.storage.get('history:'+date);
    if(saved)return saved;
    const latest=await this.getLatest();
    return latest?.packet.session_date===date&&latest.packet.snapshots.length?latest:null;
  }
  async archive(tx,entry){
    if(!entry?.packet.snapshots.length)return;
    const date=entry.packet.session_date,key='history:'+date,prior=await tx.get(key);
    if(prior&&JSON.stringify(prior.snapshotHashes)===JSON.stringify(entry.snapshotHashes)&&
       JSON.stringify(prior.packet.endpoint_closes)===JSON.stringify(entry.packet.endpoint_closes)&&
       JSON.stringify(prior.packet.research_bars)===JSON.stringify(entry.packet.research_bars))return;
    if(prior&&decideFeedUpdate(prior,entry).status!=='accepted')return;
    await tx.put(key,entry);
    if(prior)return;
    const dates=[...new Set([...(await tx.get('history-dates')??[]),date])].sort();
    while(dates.length>this.historyLimit)await tx.delete('history:'+dates.shift());
    await tx.put('history-dates',dates);
  }
  async accept(incoming){return this.storage.transaction(async tx=>{
    const current=await tx.get('latest'),result=decideFeedUpdate(current,incoming);
    if(result.status==='accepted'){
      const reconciled=await reconcileFrozenCheckpoints(current,incoming);
      // Upgrade old deployments lazily: save their last complete day before
      // the next session replaces it, even when the new packet is a heartbeat.
      await this.archive(tx,current);await this.archive(tx,reconciled);
      await tx.put('latest',reconciled);
    }
    return result;
  });}
}


// overnight-timing.mjs

const OVERNIGHT_STEP_MS = 300_000;
const OVERNIGHT_EPS = 1e-8;
const overnightMask = (high, low, upper, lower) =>
  Number(high > upper + OVERNIGHT_EPS) + 2 * Number(low < lower - OVERNIGHT_EPS);
const overnightSide = (price, upper, lower) => overnightMask(price, price, upper, lower);
const overnightFlag = value => Number.isInteger(value) && value >= 0 && value <= 3 ? value : null;

// The current sender supplies contiguous H/L/C from 03:00 when coverage is complete.
// Its 19:30–03:00 checkpoint supplies edge flags, but no sequence of within-window closes.
function summarizeOvernightTiming(packet) {
  if (!packet || !['CL', 'NQ', 'ES'].includes(packet.market) || !packet.snapshots.length) return null;
  const at03 = nyEpoch(packet.session_date, '03:00');
  const stamp = Date.parse(packet.observed_at);
  const elapsed = (stamp - at03) / OVERNIGHT_STEP_MS;
  if (!Number.isInteger(elapsed) || elapsed < 0) return null;
  const step = Math.min(174, 108 + elapsed);
  const window = step < 132 ? 2 : 3;
  const cutoff = window === 2 ? '03:00' : '05:00';
  const start = window === 2 ? 108 : 132;
  const opening = packet.snapshots.find(snapshot => snapshot.cutoff === cutoff);
  const { prior_high: upper, prior_low: lower, prior_ny_date: priorDate } = opening || packet.snapshots[0];
  const matching = packet.snapshots.filter(s => s.prior_high === upper && s.prior_low === lower && s.prior_ny_date === priorDate);
  const tick = PERSONAL_MARKETS[packet.market];
  const bars = packet.research_bars || [];
  function barAt(closeStep) {
    const index = (closeStep - 109) * 3;
    if (!Number.isFinite(bars[index])) return null;
    return bars.slice(index, index + 3).map(value => value * tick);
  }
  const phases = matching.find(s => s.bbox_history)?.bbox_history.phases;
  const asia = overnightFlag(phases?.[0]);
  const gap = overnightFlag(phases?.[1]);
  const night = asia === null || gap === null ? null : asia | gap;
  const early = matching.filter(s => s.cutoff !== '03:00')
    .map(s => overnightFlag(s.bbox_history?.phases?.[2])).find(v => v !== null);

  function scan(from, through) {
    let mask = 0;
    let complete = true;
    for (let close = from + 1; close <= through; close++) {
      const bar = barAt(close);
      if (!bar) { complete = false; continue; }
      mask |= overnightMask(bar[0], bar[1], upper, lower);
    }
    return { mask, complete };
  }

  function traces(through) {
    return [1, 2].map(edge => {
      let breached = Boolean(night & edge);
      let returnConfirmed = false;
      let armed = false;
      let freshWindow = null;
      for (let close = 109; close <= through; close++) {
        const bar = barAt(close);
        if (!bar) { armed = false; continue; }
        const wick = Boolean(overnightMask(bar[0], bar[1], upper, lower) & edge);
        // Test the wick first. A close back inside on this bar cannot arm
        // the same bar as a fresh attempt, regardless of its intrabar path.
        if (wick && armed) { freshWindow ??= close <= 132 ? 2 : 3; armed = false; }
        breached ||= wick;
        if (breached && overnightSide(bar[2], upper, lower) === 0) {
          returnConfirmed = true;
          armed = true;
        }
      }
      return { returnConfirmed, freshWindow };
    });
  }

  const active = scan(start, step);
  const earlyBars = window === 3 && early === undefined ? scan(108, 132) : null;
  const openingSide = opening ? overnightSide(opening.reference_price, upper, lower) : null;
  const price = step === start ? opening?.reference_price :
    elapsed <= 66 ? packet.last_price : packet.endpoint_closes?.['08:30'] ?? barAt(174)?.[2];
  const position = Number.isFinite(price) ? overnightSide(price, upper, lower) : null;
  return {
    version: 1, window, step, price: price ?? null, position, openingSide, lower, upper,
    past: [null, night, ...(window === 3 ? [early ?? (earlyBars?.complete ? earlyBars.mask : null)] : [])],
    activeMask: active.mask | (openingSide ?? 0) | (position ?? 0),
    activeComplete: openingSide !== null && active.complete,
    priorPaths: traces(start), observedPaths: traces(step),
  };
}

// router.mjs
const PERSONAL_ORIGIN='https://wanhotrading.github.io';
const MAX_BODY_BYTES=16384;
const encoder=new TextEncoder();
function hasValidMarketQuery(url){return [...url.searchParams.keys()].every(k=>k==='market')&&url.searchParams.getAll('market').length===1&&Object.hasOwn(PERSONAL_MARKETS,url.searchParams.get('market'));}
const historyDateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
function hasValidHistoryQuery(url,current){
  const date=url.searchParams.get('date'),parts=Object.fromEntries(historyDateFormat.formatToParts(current).map(p=>[p.type,p.value])),today=`${parts.year}-${parts.month}-${parts.day}`;
  return [...url.searchParams.keys()].every(k=>k==='market'||k==='date')&&url.searchParams.getAll('market').length===1&&url.searchParams.getAll('date').length===1&&Object.hasOwn(PERSONAL_MARKETS,url.searchParams.get('market'))&&/^20\d{2}-\d{2}-\d{2}$/.test(date??'')&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date&&date<=today;
}
async function readHistory(market,date,env){
  const saved=await env.PERSONAL_FEEDS.getByName(market).getHistory(date);
  return {schema:'sessionpath.tradingview.history.v1',status:saved?.packet.snapshots.length?'ready':'unavailable',date,receivedAt:saved?.receivedAt??null,packet:publicPacket(saved?.packet),source:'TradingView personal Pine alert',validationBasis:'authenticated_pine_attestation',...checkpointMetadata(saved)};
}
// A source may revise historical candles when its alert runtime recalculates.
// Reads retain the first verified version of EACH decision checkpoint. A later
// checkpoint is verified on its own receipt, rather than being represented as
// part of one unchanged upstream packet. These receipts contain no credentials.
function checkpointMetadata(entry){
  return {snapshotPolicy:'first-accepted-per-checkpoint',checkpointProvenance:entry?.checkpointProvenance??null,reconciliation:entry?.reconciliation??null};
}
async function readSnapshot(market,env,current){
  const latest=await env.PERSONAL_FEEDS.getByName(market).getLatest();
  const stale=latest&&(current-latest.observedMs>480000||current-Date.parse(latest.receivedAt)>480000||latest.packet.session_date!==targetSessionDate(current));
  return {schema:'sessionpath.tradingview.read.v1',status:stale?'stale':latest?.packet.snapshots.length?'ready':'waiting',receivedAt:latest?.receivedAt??null,packet:publicPacket(latest?.packet),source:'TradingView personal Pine alert',validationBasis:'authenticated_pine_attestation',...checkpointMetadata(latest)};
}
function publicPacket(packet){
  if(!packet)return null;
  const {research_bars,...published}=packet;
  const overnight = summarizeOvernightTiming(packet);
  return {...published,
    ...(research_bars?{research_through:180+5*(research_bars.length/3)}:{}),
    ...(overnight?{overnight_timing:overnight}:{}),
  };
}
const followupWindows={'03:00':[180,300],'05:00':[300,510],'08:30':[510,960]};
function followupQuery(url,now){
  const query=url.searchParams;
  if(query.size!==5||['market','date','cutoff','upper','lower'].some(k=>query.getAll(k).length!==1))return null;
  const market=query.get('market'),date=query.get('date'),cutoff=query.get('cutoff');
  if(!Object.hasOwn(PERSONAL_MARKETS,market)||!validDate(date)||date>nyDate(now)||!Object.hasOwn(followupWindows,cutoff))return null;
  const read=name=>/^\d{1,10}(?:\.\d{1,8})?$/.test(query.get(name))?Number(query.get(name)):NaN;
  const upper=read('upper'),lower=read('lower');
  if(!(upper>lower&&lower>0&&upper<=1e9))return null;
  return {market,date,cutoff,upper,lower};
}
function verifiedFirstBreach(packet,{market,date,cutoff,upper,lower}){
  const range=followupWindows[cutoff];
  if(!packet||packet.session_date!==date||packet.market!==market||!range||!packet.snapshots.some(s=>s.cutoff===cutoff))return {status:'unavailable'};
  const [start,end]=range,bars=packet.research_bars,tick=PERSONAL_MARKETS[market];
  if(!bars?.length)return {status:'unavailable'};
  const through=Math.min(end,180+5*(bars.length/3));
  if(through<=start)return {status:'waiting'};
  const epsilon=1e-8,width=upper-lower;
  for(let minute=start+5;minute<=through;minute+=5){
    const offset=3*((minute-180)/5-1);
    if(bars[offset]===null)return {status:'gap'};
    const high=bars[offset]*tick,low=bars[offset+1]*tick,close=bars[offset+2]*tick;
    const up=high>upper+epsilon,down=low<lower-epsilon;
    if(up&&down)return {status:'ambiguous',minute};
    if(!up&&!down)continue;
    const outside=close>upper+epsilon||close<lower-epsilon;
    const reaches=factor=>up?high>=lower+factor*width-epsilon:low<=upper-factor*width+epsilon;
    return {status:'breach',minute,observation:{side:up?'U':'D',signalType:outside?'CLOSE_OUTSIDE':'WICK_ONLY',
      strengthPercent:outside?Math.max(0,100*(up?close-upper:lower-close)/width):null,
      alreadyReached:{reach120:reaches(1.2),reach130:reaches(1.3)}}};
  }
  return {status:'unbreached',minute:through};
}
async function sha256(value,cryptoImpl=globalThis.crypto){return Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',encoder.encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');}
async function authenticateToken(token,expectedHash,cryptoImpl=globalThis.crypto){
  if(typeof expectedHash!=='string'||!/^[a-f0-9]{64}$/.test(expectedHash))throw new FeedError('SERVICE_UNCONFIGURED',503);
  // Both buffers are fixed-size SHA-256 digests. Workers supplies a native
  // timing-safe comparison; tests inject Node's native equivalent.
  const supplied=await cryptoImpl.subtle.digest('SHA-256',encoder.encode(typeof token==='string'?token:''));
  const expected=Uint8Array.from(expectedHash.match(/../g),h=>parseInt(h,16));
  if(typeof cryptoImpl.subtle.timingSafeEqual!=='function')throw new FeedError('SERVICE_UNAVAILABLE',503);
  const equal=cryptoImpl.subtle.timingSafeEqual(supplied,expected);
  return equal&&typeof token==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(token);
}
async function boundedJSON(request){
  if(!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type')??''))throw new FeedError('JSON_REQUIRED',415);
  const length=request.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY_BYTES))throw new FeedError('BODY_TOO_LARGE',413);
  if(!request.body)throw new FeedError('INVALID_JSON');
  const reader=request.body.getReader();const chunks=[];let bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_BODY_BYTES){await reader.cancel();throw new FeedError('BODY_TOO_LARGE',413);}chunks.push(value);}}
  finally{reader.releaseLock();}
  const result=new Uint8Array(bytes);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(result));}catch{throw new FeedError('INVALID_JSON');}
}
function createPersonalHandler({now=Date.now,cryptoImpl=globalThis.crypto}={}){
  return async function fetch(request,env){
    const headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0','CDN-Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    const reply=(body,status=200)=>new Response(body===null?null:JSON.stringify(body),{status,headers});
    try{
      const url=new URL(request.url),origin=request.headers.get('Origin');
      if(origin&&origin!==PERSONAL_ORIGIN)throw new FeedError('ORIGIN_DENIED',403);
      if(origin===PERSONAL_ORIGIN)headers.set('Access-Control-Allow-Origin',origin);
      if(request.method==='OPTIONS'){
        const privateRead=url.pathname==='/api/snapshots',publicRead=url.pathname==='/api/autofill'&&env.PUBLIC_AUTOFILL_ENABLED==='true',historyRead=url.pathname==='/api/history'&&env.PUBLIC_AUTOFILL_ENABLED==='true';
        if(origin!==PERSONAL_ORIGIN||(!privateRead&&!publicRead&&!historyRead)||!(historyRead?hasValidHistoryQuery(url,now()):hasValidMarketQuery(url)))throw new FeedError('ORIGIN_DENIED',403);
        const allowedHeaders=privateRead?['authorization']:[];
        if(request.headers.get('Access-Control-Request-Method')!=='GET'||(request.headers.get('Access-Control-Request-Headers')??'').split(',').some(x=>x.trim()&&!allowedHeaders.includes(x.trim().toLowerCase())))throw new FeedError('PREFLIGHT_DENIED',403);
        headers.set('Access-Control-Allow-Methods','GET');if(privateRead)headers.set('Access-Control-Allow-Headers','Authorization');headers.set('Access-Control-Max-Age','300');return reply(null,204);
      }
      if(url.pathname==='/health'&&request.method==='GET'&&!url.search)return reply({ok:true,service:'sessionpath-personal'});
      if(url.pathname==='/webhook'&&request.method==='POST'){
        if(url.search||request.headers.has('Authorization'))throw new FeedError('INVALID_REQUEST');
        const input=await boundedJSON(request);
        if(!await authenticateToken(input?.token,env.WRITE_TOKEN_HASH,cryptoImpl))throw new FeedError('UNAUTHORIZED',401);
        const receivedMs=now(),packet=normalizePacket(input,{now:receivedMs});
        const snapshotHashes=Object.fromEntries(await Promise.all(packet.snapshots.map(async s=>[s.cutoff,await sha256(JSON.stringify(s),cryptoImpl)])));
        const envelope={packet,receivedAt:new Date(receivedMs).toISOString(),observedMs:Date.parse(packet.observed_at),packetHash:await sha256(JSON.stringify(packet),cryptoImpl),snapshotHashes};
        const result=await env.PERSONAL_FEEDS.getByName(packet.market).accept(envelope);
        if(result.status==='conflict')throw new FeedError(result.code,409);
        return reply({status:result.status});
      }
      // This opt-in route deliberately shares the validated feed with everyone.
      // It never reads or forwards the private bearer/write credential.
      if(url.pathname==='/api/autofill'&&request.method==='GET'){
        if(env.PUBLIC_AUTOFILL_ENABLED!=='true')throw new FeedError('NOT_FOUND',404);
        if(!hasValidMarketQuery(url))throw new FeedError('INVALID_QUERY');
        return reply(await readSnapshot(url.searchParams.get('market'),env,now()));
      }
      if(url.pathname==='/api/history'&&request.method==='GET'){
        if(env.PUBLIC_AUTOFILL_ENABLED!=='true')throw new FeedError('NOT_FOUND',404);
        if(!hasValidHistoryQuery(url,now()))throw new FeedError('INVALID_QUERY');
        return reply(await readHistory(url.searchParams.get('market'),url.searchParams.get('date'),env));
      }
      if(url.pathname==='/api/followup'&&request.method==='GET'){
        if(env.PUBLIC_AUTOFILL_ENABLED!=='true')throw new FeedError('NOT_FOUND',404);
        const query=followupQuery(url,now());
        if(!query)throw new FeedError('INVALID_QUERY');
        const saved=await env.PERSONAL_FEEDS.getByName(query.market).getHistory(query.date);
        return reply({date:query.date,market:query.market,cutoff:query.cutoff,...verifiedFirstBreach(saved?.packet,query)});
      }
      if(url.pathname==='/api/snapshots'&&request.method==='GET'){
        if(!hasValidMarketQuery(url))throw new FeedError('INVALID_QUERY');
        const bearer=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.get('Authorization')??'');
        if(!await authenticateToken(bearer?.[1],env.READ_TOKEN_HASH,cryptoImpl))throw new FeedError('UNAUTHORIZED',401);
        return reply(await readSnapshot(url.searchParams.get('market'),env,now()));
      }
      throw new FeedError('NOT_FOUND',404);
    }catch(error){
      // No request, token, header, body, or exception strings are logged/echoed.
      return reply({error:error instanceof FeedError?error.code:'SERVICE_UNAVAILABLE'},error instanceof FeedError?error.status:503);
    }
  };
}


// worker.mjs
import {DurableObject} from 'cloudflare:workers';

export class PersonalFeed extends DurableObject {
  async getLatest(){return new PersonalFeedStore(this.ctx.storage).getLatest();}
  async getHistory(date){return new PersonalFeedStore(this.ctx.storage).getHistory(date);}
  async accept(envelope){return new PersonalFeedStore(this.ctx.storage).accept(envelope);}
}
export default {fetch:createPersonalHandler()};
