import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {AutoFillError,nyTimeToEpoch,calculateContext,calculateDecisionOpen,calculateFrozenAVR,calculateLastHourBehavior} from '../data-service/full-context/lib/context-calculations.mjs';

export const HISTORICAL_INPUT_SCHEMA='sessionpath.assistant.historical-inputs.v1';
export const EXPLICIT_AVR_PROFILE='explicit-prior10-0930-1600-frozen-before1930-v1';
export const DEFAULT_CSV=new URL('../../../../outputs/cl-journal-oct28-nov2/CLZ2026-5m-native-wide.csv',import.meta.url);
export const DEFAULT_AUDIT=new URL('../../../../outputs/cl-journal-oct28-nov2/final-inputs.json',import.meta.url);
export const DEFAULT_OUTPUT=new URL('../../docs/assistant-historical-inputs.json',import.meta.url);
const CUTOFFS=['03:00','05:00','08:30'];
const dateFormatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const shift=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const near=(actual,expected)=>Number.isFinite(actual)&&Number.isFinite(expected)&&Math.abs(actual-expected)<=1e-9;
function civil(time){const p=Object.fromEntries(dateFormatter.formatToParts(new Date(time*1000)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};}

export function parseNativeCSV(bytes){
 const lines=String(bytes).replace(/^\uFEFF/u,'').trim().split(/\r?\n/u),header=lines.shift()?.split(',');
 if(!header||!['time','open','high','low','close'].every(key=>header.includes(key))||new Set(header).size!==header.length)throw new Error('Expected one native time/open/high/low/close CSV header.');
 const positions=Object.fromEntries(['time','open','high','low','close'].map(key=>[key,header.indexOf(key)]));
 const bars=[];let prior=-Infinity;
 for(const [index,line]of lines.entries()){
  if(!line.trim())throw new Error(`Empty candle row at ${index+2}.`);
  const columns=line.split(',');if(columns.length!==header.length)throw new Error(`Malformed candle row at ${index+2}.`);
  const bar=Object.fromEntries(Object.entries(positions).map(([key,position])=>[key,columns[position].trim()===''?NaN:Number(columns[position])]));
  if(!Number.isSafeInteger(bar.time)||bar.time%300||bar.time<=prior)throw new Error(`Duplicate, unordered or unaligned timestamp at ${index+2}.`);
  if(!['open','high','low','close'].every(key=>Number.isFinite(bar[key])&&Math.abs(bar[key]*100-Math.round(bar[key]*100))<=1e-6)||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close)||bar.low>bar.high)throw new Error(`Invalid CL candle at ${index+2}.`);
  bars.push(bar);prior=bar.time;
 }
 if(!bars.length)throw new Error('The native CSV contains no candles.');return bars;
}

function completeObserved(byTime,start,end){
 const rows=[];for(let time=start;time<end;time+=300){const row=byTime.get(time);if(!row)throw new AutoFillError('INCOMPLETE_HISTORICAL_WINDOW','A completed historical input candle is missing.');rows.push(row);}
 if(!rows.length)throw new Error('A historical observation window cannot be empty.');
 return {high:Math.max(...rows.map(row=>row.high)),low:Math.min(...rows.map(row=>row.low)),close:rows.at(-1).close};
}

export function historicalSnapshot(bars,date,cutoff){
 const time=nyTimeToEpoch(date,cutoff),observed=bars.filter(bar=>bar.time<=time).map(bar=>bar.time===time?{time:bar.time,open:bar.open,high:bar.open,low:bar.open,close:bar.open}:bar);
 // The current candle contributes its OPEN only. Its later high/low/close and
 // all subsequent candles are physically absent from every calculation feed.
 const feed={meta:{market:'CL',symbol:'NYMEX:CLZ2026',contract:'CLZ2026',instrumentType:'FUTURE',intervalSeconds:300,quoteTime:time,source:'TradingView native CSV',continuous:false},bars:observed};
 const options={date,cutoff,market:'CL',contract:'CLZ2026',nowMs:time*1000};
 const context=calculateContext(feed,options),decision=calculateDecisionOpen(feed,options),avr=calculateFrozenAVR(feed,options),behavior=calculateLastHourBehavior(feed,{...options,avr:avr.value});
 const byTime=new Map(observed.map(bar=>[bar.time,bar])),asia=completeObserved(byTime,nyTimeToEpoch(shift(date,-1),'19:30'),nyTimeToEpoch(date,'02:00'));
 const london=cutoff==='08:30'?completeObserved(byTime,nyTimeToEpoch(date,'03:00'),time):null;
 const dates=[...avr.dates].sort();
 if(context.priorBarCount!==78||avr.n!==10||dates.length!==10||dates.at(-1)!==context.priorDate||avr.sessions.some(session=>session.count!==78)||dates.some(day=>nyTimeToEpoch(day,'16:00')>avr.freezeTime))throw new Error('The reference sessions do not satisfy the frozen ten-session protocol.');
 return {cutoff,as_of:new Date(time*1000).toISOString(),reference_price:decision.open,avr:avr.value,open_1930:context.open1930,
  range_high:Math.max(context.rangeHigh,decision.open),range_low:Math.min(context.rangeLow,decision.open),prior_high:context.priorHigh,prior_low:context.priorLow,
  prior_ny_date:context.priorDate,prior_ny_count:78,avr_count:10,avr_dates:dates,avr_frozen_at:new Date(avr.freezeTime*1000).toISOString(),last_hour_behavior:behavior.behavior,
  asia_high:asia.high,asia_low:asia.low,asia_close:asia.close,asia_complete:true,london_high:london?.high??null,london_low:london?.low??null,london_close:london?.close??null,london_complete:london!==null};
}

export function verifyPreparedAudit(asset,audit,sourceBytes){
 if(audit?.schema!=='sessionpath.cl-final-inputs.v1'||audit.source?.sha256!==digest(sourceBytes)||audit.source?.contract!=='NYMEX:CLZ2026'||audit.source?.intervalMinutes!==5||!Array.isArray(audit.dates)||audit.dates.length!==4)throw new Error('The audited journal provenance does not match the native CSV.');
 let checked=0;
 for(const day of audit.dates)for(const window of Object.values(day.windows||{})){
  const actual=asset.records.find(record=>record.date===day.date&&record.snapshot.cutoff===window.cutoff)?.snapshot;
  if(!actual)throw new Error(`The audited ${day.date} ${window.cutoff} checkpoint is missing.`);
  const expected=window.inputs,prior=window.priorContext;
  for(const [key,value]of Object.entries({reference_price:expected.price,avr:expected.avr,open_1930:expected.open1930,range_high:expected.rangeHigh,range_low:expected.rangeLow,prior_high:prior.priorHigh,prior_low:prior.priorLow}))if(!near(actual[key],value))throw new Error(`The audited ${day.date} ${window.cutoff} ${key} value differs.`);
  if(actual.last_hour_behavior!==expected.behavior||actual.prior_ny_date!==prior.priorDate||JSON.stringify(actual.avr_dates)!==JSON.stringify([...window.avr.dates].sort())||actual.avr_frozen_at!==new Date(window.avr.freezeTime*1000).toISOString())throw new Error(`The audited ${day.date} ${window.cutoff} reference protocol differs.`);
  checked++;
 }
 if(checked!==12)throw new Error('All twelve audited journal checkpoints are required.');return checked;
}

export function buildHistoricalInputs(sourceBytes,{audit}={}){
 const bars=parseNativeCSV(sourceBytes),sha256=digest(sourceBytes),candidates=new Map(),records=[];
 for(const bar of bars){const local=civil(bar.time);if(CUTOFFS.includes(local.time)&&![0,6].includes(new Date(local.date+'T00:00:00Z').getUTCDay()))candidates.set(local.date+'|'+local.time,local);}
 for(const candidate of [...candidates.values()].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))){
  let snapshot;
  try{snapshot=historicalSnapshot(bars,candidate.date,candidate.time);}catch(error){if(error instanceof AutoFillError)continue;throw error;}
  records.push({market:'CL',date:candidate.date,contract:'NYMEX:CLZ2026',source:{provider:'TradingView native CSV',sha256,avrProfile:EXPLICIT_AVR_PROFILE,priceBasis:'Unadjusted explicit December 2026 delivery contract.'},snapshot});
 }
 if(!records.length)throw new Error('No native checkpoints have all required historical inputs.');
 const asset={schema:HISTORICAL_INPUT_SCHEMA,records};if(audit)verifyPreparedAudit(asset,audit,sourceBytes);return asset;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const source=process.argv[2]??DEFAULT_CSV,auditPath=process.argv[3]??DEFAULT_AUDIT,output=process.argv[4]??DEFAULT_OUTPUT;
 const [bytes,auditText]=await Promise.all([readFile(source),readFile(auditPath,'utf8')]);
 const asset=buildHistoricalInputs(bytes,{audit:JSON.parse(auditText)});await writeFile(output,JSON.stringify(asset,null,2)+'\n');
 console.log(JSON.stringify({schema:asset.schema,records:asset.records.length,dates:new Set(asset.records.map(record=>record.date)).size,first:asset.records[0].date,last:asset.records.at(-1).date,sourceSHA256:digest(bytes),auditedJournalCheckpoints:12}));
}
