import {createHash} from 'node:crypto';
import {nyTimeToEpoch, classifyLastHourPath, MARKET_CONFIG} from '../data-service/full-context/lib/context-calculations.mjs';
import {PROFILE} from '../../docs/tradingview-live-core.mjs';
import {EXPLICIT_AVR_PROFILE, validateHistoricalRecord} from '../../docs/assistant-forecast-adapter.mjs';

export {PROFILE, EXPLICIT_AVR_PROFILE};
export const HISTORICAL_INPUT_SCHEMA='sessionpath.assistant.historical-inputs.v1';
export const COVERAGE_AUDIT_SCHEMA='sessionpath.assistant.native-history-coverage.v1';
export const CUTOFFS=Object.freeze(['03:00','05:00','08:30']);
const STEP=300;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const shift=(date,days)=>new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
const weekday=date=>new Date(date+'T12:00:00Z').getUTCDay();
const isWeekday=date=>![0,6].includes(weekday(date));
const previousWeekday=date=>{let prior=shift(date,-1);while(!isWeekday(prior))prior=shift(prior,-1);return prior;};
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const local=time=>{const p=Object.fromEntries(formatter.formatToParts(new Date(time*1000)).map(p=>[p.type,p.value]));return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};};
const request=(market,date,cutoff)=>({market,date,cutoff,minute:Number(cutoff.slice(0,2))*60+Number(cutoff.slice(3))});
function validDate(date){try{nyTimeToEpoch(date,'12:00');return true;}catch{return false;}}
function reject(code,message,details={}){throw Object.assign(new Error(message),{name:'NativeHistoryCoverageError',code,details});}
function price(value,market){const tick=MARKET_CONFIG[market].tick;return Number.isFinite(value)&&value>0&&Math.abs(value/tick-Math.round(value/tick))<1e-6;}

// Identity belongs to the source manifest, never to the active delivery month.
// A continuous source cannot be silently relabelled as an explicit contract.
export function validateSourceManifest(manifest){
 if(!manifest||!Object.hasOwn(MARKET_CONFIG,manifest.market))throw Error('A supported source market is required.');
 const {market,source_symbol:symbol,avr_profile:profile,price_basis:basis,sha256}=manifest;
 const prefix=market==='CL'?'NYMEX':market==='GC'?'COMEX':'(?:CME_MINI|CME)';
 const continuous=new RegExp(`^(?:${prefix}:)?${market}1!$`).test(symbol);
 const explicit=new RegExp(`^(?:${prefix}:)?${market}[FGHJKMNQUVXZ]\\d{4}$`).test(symbol);
 if(!(continuous&&profile===PROFILE||explicit&&profile===EXPLICIT_AVR_PROFILE))throw Error('The source symbol and AVR profile must identify the same market and price basis.');
 if(typeof basis!=='string'||!basis.trim()||basis.length>240)throw Error('An explicit source price basis is required.');
 if(!/^[a-f0-9]{64}$/.test(sha256||''))throw Error('The source manifest must pin the native CSV SHA256.');
 if(continuous&&manifest.backadjustment!=='off')throw Error('The continuous profile requires an unadjusted source with backadjustment off.');
 if(manifest.interval_minutes!==5)throw Error('Only genuine native five-minute CSV sources are supported.');
 for(const key of ['from_date','through_date'])if(manifest[key]!==undefined&&!validDate(manifest[key]))throw Error(`Invalid manifest ${key}.`);
 if(manifest.from_date&&manifest.through_date&&manifest.from_date>manifest.through_date)throw Error('The requested coverage range is reversed.');
 return {...manifest,continuous};
}

export function parseNativeCSV(bytes,manifest){
 const source=validateSourceManifest(manifest);
 const lines=String(bytes).replace(/^\uFEFF/u,'').trim().split(/\r?\n/u),header=lines.shift()?.split(',');
 if(!header||!['time','open','high','low','close'].every(k=>header.includes(k))||new Set(header).size!==header.length)throw Error('Expected one native time/open/high/low/close CSV header.');
 const positions=Object.fromEntries(['time','open','high','low','close'].map(k=>[k,header.indexOf(k)]));
 const bars=[];let prior=-Infinity;
 for(const [index,line] of lines.entries()){
  const fields=line.split(',');if(!line.trim()||fields.length!==header.length)throw Error(`Malformed native candle row at ${index+2}.`);
  const bar=Object.fromEntries(Object.entries(positions).map(([key,i])=>[key,fields[i].trim()===''?NaN:Number(fields[i])]));
  if(!Number.isSafeInteger(bar.time)||bar.time%STEP||bar.time<=prior)throw Error(`Duplicate, unordered or unaligned timestamp at ${index+2}.`);
  if(!['open','high','low','close'].every(k=>price(bar[k],source.market))||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close)||bar.low>bar.high)throw Error(`Invalid ${source.market} OHLC or tick grid at ${index+2}.`);
  for(const key of ['symbol','contract','source_symbol'])if(header.includes(key)&&fields[header.indexOf(key)]!==source.source_symbol)throw Error(`Mixed source identity at ${index+2}.`);
  bars.push(bar);prior=bar.time;
 }
 if(!bars.length)throw Error('The native CSV contains no candles.');
 return bars;
}

function window(byTime,start,end,code,label){
 const bars=[],missing=[];
 for(let time=start;time<end;time+=STEP){const bar=byTime.get(time);if(bar)bars.push(bar);else missing.push(time);}
 if(missing.length)reject(code,`The complete ${label} window is unavailable.`,{expectedBars:(end-start)/STEP,observedBars:bars.length,missingCount:missing.length,firstMissing:missing[0]});
 return bars;
}
const stats=bars=>({high:Math.max(...bars.map(b=>b.high)),low:Math.min(...bars.map(b=>b.low)),close:bars.at(-1).close,count:bars.length});
function session(byTime,date){return window(byTime,nyTimeToEpoch(date,'09:30'),nyTimeToEpoch(date,'16:00'),'INCOMPLETE_AVR_SESSION','09:30–16:00 NY session');}

// This path intentionally does not call calculateFrozenAVR, whose public-feed
// metadata contract requires an explicit delivery contract. Both source profiles
// use the same exact 78-bar reference windows, with their own pinned identity.
export function nativeHistoricalSnapshot(bars,date,cutoff,manifest){
 const source=validateSourceManifest(manifest);
 if(!validDate(date)||!isWeekday(date)||!CUTOFFS.includes(cutoff))throw Error('A weekday date and a supported checkpoint are required.');
 const cutoffTime=nyTimeToEpoch(date,cutoff),previousDate=shift(date,-1),priorDate=previousWeekday(date);
 const byTime=new Map();
 for(const bar of bars){
  if(bar.time>cutoffTime)continue;
  if(byTime.has(bar.time))throw Error('Duplicate native candle timestamp.');
  // Only OPEN is observable on the current candle; its H/L/C are never read.
  byTime.set(bar.time,bar.time===cutoffTime?{time:bar.time,open:bar.open,high:bar.open,low:bar.open,close:bar.open}:bar);
 }
 const decision=byTime.get(cutoffTime);
 if(!decision||!price(decision.open,source.market))reject('INCOMPLETE_CUTOFF',`The ${cutoff} decision open is unavailable.`,{cutoffTime});
 const prior=window(byTime,nyTimeToEpoch(priorDate,'09:30'),nyTimeToEpoch(priorDate,'16:00'),'INCOMPLETE_PRIOR_NY',`prior weekday NY session (${priorDate})`);
 const freezeTime=nyTimeToEpoch(previousDate,'19:30'),avrSessions=[],skippedAVRSessions=[];
 for(let back=0;back<35&&avrSessions.length<10;back++){
  const day=shift(previousDate,-back);if(!isWeekday(day)||nyTimeToEpoch(day,'16:00')>freezeTime)continue;
  let rows;try{rows=session(byTime,day);}catch(error){if(error.name!=='NativeHistoryCoverageError')throw error;skippedAVRSessions.push({date:day,...error.details});continue;}
  const s=stats(rows);avrSessions.push({date:day,high:s.high,low:s.low,range:Number((s.high-s.low).toFixed(8)),count:78});
 }
 if(avrSessions.length!==10)reject('INSUFFICIENT_AVR_HISTORY','Ten prior complete 78-bar NY sessions are required.',{n:avrSessions.length,dates:avrSessions.map(s=>s.date),freezeTime,lookbackDays:35,skippedSessions:skippedAVRSessions});
 const avr=avrSessions.reduce((sum,s)=>sum+s.range,0)/10;
 if(!(avr>0))reject('INVALID_AVR','The mean prior session range is not positive.');
 if(avrSessions[0].date!==priorDate)throw Error('The required prior weekday session is not the latest frozen AVR session.');
 const overnightStart=nyTimeToEpoch(previousDate,'19:30');
 const overnight=window(byTime,overnightStart,cutoffTime,'INCOMPLETE_OVERNIGHT',`19:30–${cutoff} overnight`);
 const asia=stats(window(byTime,overnightStart,nyTimeToEpoch(date,'02:00'),'INCOMPLETE_ASIA','Asia'));
 const london=cutoff==='08:30'?stats(window(byTime,nyTimeToEpoch(date,'03:00'),cutoffTime,'INCOMPLETE_LONDON','London')):null;
 const hour=window(byTime,cutoffTime-3600,cutoffTime,'INCOMPLETE_LAST_HOUR','completed last hour'),base=byTime.get(cutoffTime-3900)?.close;
 if(!Number.isFinite(base))reject('INCOMPLETE_LAST_HOUR','The base close preceding the completed last hour is unavailable.');
 const priorStats=stats(prior),overnightStats=stats(overnight);
 const snapshot={cutoff,as_of:new Date(cutoffTime*1000).toISOString(),reference_price:decision.open,avr,open_1930:overnight[0].open,
  range_high:Math.max(overnightStats.high,decision.open),range_low:Math.min(overnightStats.low,decision.open),prior_high:priorStats.high,prior_low:priorStats.low,
  prior_ny_date:priorDate,prior_ny_count:78,avr_count:10,avr_dates:avrSessions.map(s=>s.date).sort(),avr_frozen_at:new Date(freezeTime*1000).toISOString(),
  last_hour_behavior:classifyLastHourPath(hour.map(b=>(b.close-base)/avr)),asia_high:asia.high,asia_low:asia.low,asia_close:asia.close,asia_complete:true,
  london_high:london?.high??null,london_low:london?.low??null,london_close:london?.close??null,london_complete:london!==null};
 const record={market:source.market,date,contract:source.source_symbol,source:{provider:source.provider||'TradingView native CSV',symbol:source.source_symbol,sha256:source.sha256,avrProfile:source.avr_profile,priceBasis:source.price_basis},snapshot};
 validateHistoricalRecord(record,request(source.market,date,cutoff));
 return {record,coverage:{priorNYDate:priorDate,priorNYBars:78,avrCount:10,avrSessions:[...avrSessions].reverse(),avrSkippedSessions:skippedAVRSessions,overnightBars:overnight.length,expectedOvernightBars:(cutoffTime-overnightStart)/STEP,asiaBars:asia.count,londonBars:london?.count??0,lastHourBars:hour.length,decisionPriceBasis:'cutoff_open_only',laterBarsUsed:0}};
}

export function buildNativeHistory(sourceBytes,manifest){
 const source=validateSourceManifest(manifest);
 if(digest(sourceBytes)!==source.sha256)throw Error('Native CSV SHA256 does not match the pinned source manifest.');
 const bars=parseNativeCSV(sourceBytes,source),first=local(bars[0].time),last=local(bars.at(-1).time);
 const from=source.from_date??first.date,through=source.through_date??last.date;
 if(from>through)throw Error('The requested coverage range is reversed.');
 const records=[],attempts=[],excludedWeekends=[];
 for(let date=from;date<=through;date=shift(date,1)){
  if(!isWeekday(date)){excludedWeekends.push(date);continue;}
  for(const cutoff of CUTOFFS){
   try{const {record,coverage}=nativeHistoricalSnapshot(bars,date,cutoff,source);records.push(record);attempts.push({date,cutoff,status:'ready',...coverage});}
   catch(error){if(error.name!=='NativeHistoryCoverageError')throw error;attempts.push({date,cutoff,status:'skipped',code:error.code,reason:error.message,details:error.details});}
  }
 }
 const asset={schema:HISTORICAL_INPUT_SCHEMA,records};
 const audit={schema:COVERAGE_AUDIT_SCHEMA,source:{market:source.market,symbol:source.source_symbol,sha256:source.sha256,avrProfile:source.avr_profile,priceBasis:source.price_basis,intervalMinutes:5,rows:bars.length,firstNY:`${first.date} ${first.time}`,lastNY:`${last.date} ${last.time}`},requested:{from,through,cutoffs:[...CUTOFFS]},summary:{attempted:attempts.length,ready:records.length,skipped:attempts.length-records.length,dates:new Set(records.map(r=>r.date)).size},excludedWeekends,attempts};
 return {asset,audit};
}

// Existing rows retain their original values and order. Identical repeats are
// idempotent; any differing row for the same checkpoint blocks the merge.
export function mergeHistoricalInputs(existing,additions){
 if([existing,additions].some(a=>a?.schema!==HISTORICAL_INPUT_SCHEMA||!Array.isArray(a.records)))throw Error('Expected historical input assets.');
 const rows=[],seen=new Map;
 for(const record of [...existing.records,...additions.records]){
  const cutoff=record?.snapshot?.cutoff;validateHistoricalRecord(record,request(record?.market,record?.date,cutoff||''));
  const key=[record.market,record.date,cutoff].join('|');
  if(seen.has(key)){if(JSON.stringify(seen.get(key))!==JSON.stringify(record))throw Error(`Conflicting historical checkpoint ${key}.`);continue;}
  seen.set(key,record);rows.push(record);
 }
 return {schema:HISTORICAL_INPUT_SCHEMA,records:rows};
}
