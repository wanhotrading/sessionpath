import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {buildNativeHistory,nativeHistoricalSnapshot,parseNativeCSV,validateSourceManifest,mergeHistoricalInputs,PROFILE,EXPLICIT_AVR_PROFILE,HISTORICAL_INPUT_SCHEMA} from '../build-native-history.mjs';
import {nyTimeToEpoch} from '../../data-service/full-context/lib/context-calculations.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const csv=rows=>'time,open,high,low,close\n'+rows.map(b=>[b.time,b.open,b.high,b.low,b.close].join(',')).join('\n')+'\n';
const clock=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});

// Portable exchange-session fixture. Every complete NY range is designed as
// 77 * 0.25 + 2 + 1 = 22.25. Overnight closes differ from the next OPEN.
// October 1 through November 3 crosses weekends and the NY DST transition.
function syntheticNativeBars(){
 const rows=[];
 for(let time=nyTimeToEpoch('2026-10-01','00:00');time<=nyTimeToEpoch('2026-11-03','05:25');time+=300){
  const p=Object.fromEntries(clock.formatToParts(new Date(time*1000)).map(p=>[p.type,p.value]));
  const date=`${p.year}-${p.month}-${p.day}`,minute=Number(p.hour)*60+Number(p.minute),weekday=new Date(date+'T12:00:00Z').getUTCDay();
  if(weekday===6||weekday===0&&minute<1080||weekday===5&&minute>=1020||weekday>=1&&weekday<=4&&minute>=1020&&minute<1080)continue;
  const day=(Date.parse(date+'T00:00:00Z')-Date.parse('2026-10-01T00:00:00Z'))/86400000,base=20000+day*25;
  if(minute>=570&&minute<960){
   const open=base+(minute-570)/5*.25;rows.push({time,open,high:open+2,low:open-1,close:open+.5});
  }else{
   const open=base+minute/5*.25;rows.push({time,open,high:open+1,low:open-.5,close:open-.25});
  }
 }
 return rows;
}

const fixture=syntheticNativeBars(),bytes=csv(fixture);
const manifest={market:'NQ',source_symbol:'CME_MINI:NQ1!',avr_profile:PROFILE,price_basis:'Synthetic unadjusted continuous test fixture.',backadjustment:'off',interval_minutes:5,sha256:hash(bytes),from_date:'2026-10-16',through_date:'2026-11-03'};
const bars=parseNativeCSV(bytes,manifest),result=buildNativeHistory(bytes,manifest);
const at=(date='2026-10-28',cutoff='08:30',source=bars,m=manifest)=>nativeHistoricalSnapshot(source,date,cutoff,m);
const asset=records=>({schema:HISTORICAL_INPUT_SCHEMA,records});

test('continuous snapshots preserve identity and reproduce designed prices and exact coverage',()=>{
 const {record:r,coverage:c}=at(),s=r.snapshot;
 assert.equal(r.contract,'CME_MINI:NQ1!');assert.equal(r.source.symbol,r.contract);assert.equal(r.source.avrProfile,PROFILE);assert.equal(r.source.sha256,hash(bytes));
 assert.deepEqual([s.reference_price,s.avr,s.prior_ny_date,s.prior_high,s.prior_low,s.open_1930,s.range_high,s.range_low],[20700.5,22.25,'2026-10-27',20671.25,20649,20708.5,20722.75,20674.5]);
 assert.deepEqual([s.asia_high,s.asia_low,s.asia_close,s.london_high,s.london_low,s.london_close],[20722.75,20674.5,20680.5,20701.25,20683.5,20700]);
 assert.equal(s.last_hour_behavior,'Higher finish');
 assert.deepEqual([c.priorNYBars,c.avrCount,c.overnightBars,c.asiaBars,c.londonBars,c.lastHourBars,c.laterBarsUsed],[78,10,156,78,66,12,0]);
 assert.deepEqual(s.avr_dates,['2026-10-14','2026-10-15','2026-10-16','2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-26','2026-10-27']);
 for(const cutoff of ['03:00','05:00']){const {record,coverage}=at('2026-10-28',cutoff);assert.equal(record.snapshot.london_complete,false);assert.deepEqual([record.snapshot.london_high,record.snapshot.london_low,record.snapshot.london_close],[null,null,null]);assert.equal(coverage.overnightBars,cutoff==='03:00'?90:114);}
});

test('all three checkpoints ignore decision HLC and all later candles, including after truncation',()=>{
 for(const cutoff of ['03:00','05:00','08:30']){
  const time=nyTimeToEpoch('2026-10-28',cutoff),baseline=at('2026-10-28',cutoff).record.snapshot;
  const mutated=bars.map(b=>b.time>=time?{...b,high:1e8,low:1,close:1e7}:b);
  assert.deepEqual(at('2026-10-28',cutoff,mutated).record.snapshot,baseline);
  const truncated=bars.filter(b=>b.time<=time).map(b=>b.time===time?{time:b.time,open:b.open}:b);
  assert.deepEqual(at('2026-10-28',cutoff,truncated).record.snapshot,baseline);
 }
});

test('decision OPEN rather than preceding close or current HLC sets price and running extrema',()=>{
 const time=nyTimeToEpoch('2026-10-28','08:30'),previousClose=bars.find(b=>b.time===time-300).close;
 assert.equal(previousClose,20700);assert.equal(at().record.snapshot.reference_price,20700.5);
 for(const [open,expectedHigh,expectedLow]of [[21000,21000,20674.5],[20500,20722.75,20500]]){
  const changed=bars.map(b=>b.time===time?{...b,open,high:99999,low:1,close:99999}:b),s=at('2026-10-28','08:30',changed).record.snapshot;
  assert.deepEqual([s.reference_price,s.range_high,s.range_low],[open,expectedHigh,expectedLow]);assert.notEqual(s.reference_price,previousClose);
 }
});

test('coverage records every intended weekday checkpoint and missing end-of-source decision',()=>{
 const weekdays=['2026-10-16','2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-11-02','2026-11-03'];
 assert.equal(result.audit.attempts.length,39);assert.deepEqual(result.audit.summary,{attempted:39,ready:38,skipped:1,dates:13});
 for(const date of weekdays)assert.deepEqual(result.audit.attempts.filter(x=>x.date===date).map(x=>x.cutoff),['03:00','05:00','08:30']);
 const absent=result.audit.attempts.find(x=>x.date==='2026-11-03'&&x.cutoff==='08:30');assert.equal(absent.status,'skipped');assert.equal(absent.code,'INCOMPLETE_CUTOFF');
 assert.deepEqual(result.audit.excludedWeekends,['2026-10-17','2026-10-18','2026-10-24','2026-10-25','2026-10-31','2026-11-01']);
 assert.equal(new Set(result.asset.records.map(r=>r.market+'|'+r.date+'|'+r.snapshot.cutoff)).size,38);
});

test('missing overnight and cutoff candles produce explicit skips without interpolation',()=>{
 const missingTime=nyTimeToEpoch('2026-10-28','08:25'),missing=bars.filter(b=>b.time!==missingTime);
 assert.throws(()=>at('2026-10-28','08:30',missing),e=>e.code==='INCOMPLETE_OVERNIGHT'&&e.details.missingCount===1&&e.details.firstMissing===missingTime);
 const cutoffTime=nyTimeToEpoch('2026-10-28','08:30');assert.throws(()=>at('2026-10-28','08:30',bars.filter(b=>b.time!==cutoffTime)),e=>e.code==='INCOMPLETE_CUTOFF');
 const modifiedBytes=csv(missing),modified=buildNativeHistory(modifiedBytes,{...manifest,sha256:hash(modifiedBytes),from_date:'2026-10-28',through_date:'2026-10-28'});
 assert.equal(modified.audit.attempts.find(x=>x.cutoff==='08:30').code,'INCOMPLETE_OVERNIGHT');assert.equal(modified.audit.summary.ready,2);
});

test('an incomplete most recent prior weekday cannot fall back to an older BBOX',()=>{
 const missingTime=nyTimeToEpoch('2026-10-27','10:00'),missing=bars.filter(b=>b.time!==missingTime);
 assert.throws(()=>at('2026-10-28','08:30',missing),e=>e.code==='INCOMPLETE_PRIOR_NY'&&e.details.missingCount===1&&e.details.firstMissing===missingTime);
 assert.equal(at('2026-10-27','08:30').record.snapshot.prior_ny_date,'2026-10-26');
});

test('AVR audits excluded incomplete older sessions and requires ten complete sessions',()=>{
 const missingTime=nyTimeToEpoch('2026-10-14','10:00'),computed=at('2026-10-28','08:30',bars.filter(b=>b.time!==missingTime));
 assert.equal(computed.record.snapshot.avr_count,10);assert.ok(computed.record.snapshot.avr_dates.includes('2026-10-13'));assert.ok(!computed.record.snapshot.avr_dates.includes('2026-10-14'));
 assert.deepEqual(computed.coverage.avrSkippedSessions.map(s=>[s.date,s.missingCount,s.firstMissing]),[['2026-10-14',1,missingTime]]);
 const shortened=bars.filter(b=>b.time>=nyTimeToEpoch('2026-10-15','00:00'));assert.throws(()=>at('2026-10-28','08:30',shortened),e=>e.code==='INSUFFICIENT_AVR_HISTORY'&&e.details.n===9);
});

test('Monday uses Friday BBOX and Sunday 19:30 freeze across the NY DST change',()=>{
 const friday=at('2026-10-30','03:00').record.snapshot,monday=at('2026-11-02','03:00').record.snapshot;
 assert.equal(monday.prior_ny_date,'2026-10-30');assert.equal(monday.avr_dates.at(-1),'2026-10-30');assert.equal(monday.avr_frozen_at,'2026-11-02T00:30:00.000Z');
 assert.equal(friday.as_of,'2026-10-30T07:00:00.000Z');assert.equal(monday.as_of,'2026-11-02T08:00:00.000Z');assert.equal(friday.avr_frozen_at,'2026-10-29T23:30:00.000Z');
});

test('source identity, profile, hash and tick grids are enforced for every supported market',()=>{
 for(const patch of [{avr_profile:EXPLICIT_AVR_PROFILE},{source_symbol:'CME_MINI:NQZ2026'},{source_symbol:'CME_MINI:ES1!'},{source_symbol:'NYMEX:NQ1!'},{backadjustment:'on'}])assert.throws(()=>validateSourceManifest({...manifest,...patch}));
 assert.throws(()=>buildNativeHistory(bytes,{...manifest,sha256:'0'.repeat(64)}),/SHA256/);
 for(const [market,symbol,good,bad]of [['CL','NYMEX:CL1!','90.01','90.005'],['NQ','CME_MINI:NQ1!','30000.25','30000.1'],['ES','CME_MINI:ES1!','7000.25','7000.1'],['GC','COMEX:GC1!','4000.1','4000.25']]){
  const m={...manifest,market,source_symbol:symbol},sample=p=>`time,open,high,low,close\n300,${p},${p},${p},${p}`;
  assert.equal(parseNativeCSV(sample(good),m).length,1);assert.throws(()=>parseNativeCSV(sample(bad),m),/tick grid/);
 }
 for(const tail of ['300,1,2,1,1\n300,1,2,1,1','301,1,2,1,1','600,1,2,1,1\n300,1,2,1,1','300,2,1,3,2'])assert.throws(()=>parseNativeCSV('time,open,high,low,close\n'+tail,manifest));
 assert.throws(()=>parseNativeCSV('time,open,high,low,close,symbol\n300,1,2,1,1,NQZ2026',manifest),/Mixed source/);
 const explicit={...manifest,source_symbol:'CME_MINI:NQZ2026',avr_profile:EXPLICIT_AVR_PROFILE,price_basis:'Synthetic explicit December 2026 test contract.'};
 assert.equal(validateSourceManifest(explicit).continuous,false);assert.equal(at('2026-10-28','08:30',bars,explicit).record.contract,explicit.source_symbol);
});

test('merges preserve values and order, deduplicate identical inputs, and reject changed or relabelled checkpoints',()=>{
 const existing=asset(result.asset.records.slice(0,4).map(clone)),additions=asset(result.asset.records.slice(4)),before=JSON.stringify(existing);
 const merged=mergeHistoricalInputs(existing,additions);assert.equal(JSON.stringify(existing),before);assert.deepEqual(merged.records.slice(0,4),existing.records);assert.deepEqual(merged,result.asset);
 assert.deepEqual(mergeHistoricalInputs(merged,result.asset),merged);
 const altered=asset([clone(result.asset.records[0])]);altered.records[0].snapshot.avr+=.25;assert.throws(()=>mergeHistoricalInputs(merged,altered),/Conflicting/);
 const relabelled=asset([clone(result.asset.records[0])]);relabelled.records[0].contract='CME_MINI:NQZ2026';relabelled.records[0].source.avrProfile=EXPLICIT_AVR_PROFILE;assert.throws(()=>mergeHistoricalInputs(merged,relabelled),/Conflicting/);
 assert.doesNotMatch(JSON.stringify(result.asset),/Administrator|csv_path|raw_bars|closes|Volume/);
});

test('runner requires a manifest and both output paths',()=>{
 const runner=fileURLToPath(new URL('../run-native-history.mjs',import.meta.url)),run=spawnSync(process.execPath,[runner],{encoding:'utf8'});
 assert.notEqual(run.status,0);assert.match(run.stderr,/Usage:.*manifest.*output.*audit/i);
});

test('runner resolves CSV relative to its manifest and creates portable output artifacts',async t=>{
 const root=await mkdtemp(join(tmpdir(),'sessionpath-native-history-'));
 t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())));await rm(root,{recursive:true,force:true});});
 const inputs=join(root,'nested','inputs');await mkdir(inputs,{recursive:true});
 await writeFile(join(inputs,'candles.csv'),bytes);const manifestPath=join(inputs,'source.json');await writeFile(manifestPath,JSON.stringify({...manifest,csv_path:'candles.csv'}));
 const output=join(root,'artifacts','inputs.json'),audit=join(root,'artifacts','coverage.json'),runner=fileURLToPath(new URL('../run-native-history.mjs',import.meta.url));
 const run=spawnSync(process.execPath,[runner,manifestPath,output,audit],{cwd:root,encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(await readFile(output,'utf8')),result.asset);assert.deepEqual(JSON.parse(await readFile(audit,'utf8')),result.audit);
 assert.equal(JSON.parse(run.stdout).apiCostUSD,0);assert.doesNotMatch(await readFile(output,'utf8'),/csv_path|candles\.csv/);
});
