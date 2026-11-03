import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {normalizePacket} from '../backend/validation.mjs';

const pine=await readFile(new URL('./sessionpath-personal-exporter.pine',import.meta.url),'utf8');
const downloadPine=await readFile(new URL('../../../docs/SessionPath-personal-TradingView-sender.pine',import.meta.url),'utf8');
const sourceAudit=JSON.parse(await readFile(new URL('./source-audit.json',import.meta.url),'utf8'));
const formatDate=time=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
const f_utc=time=>new Date(time).toISOString().replace('.000Z','Z');
const f_number=value=>value===null||Number.isNaN(value)?'null':String(Number(value.toFixed(8)));

// Exercise the exact Pine JSON concatenation expressions. This small translator
// covers string construction only, not Pine's execution, series or state model.
function translate(statement){return statement.replaceAll('math.max','Math.max').replaceAll('math.min','Math.min').replaceAll('str.tostring','String').replace(/\bna\b/g,'null').replace(/\band\b/g,'&&').replace(/\bor\b/g,'||').replace(/^\s*string (\w+) = /,'let $1 = ');}
function execute(lines,context,result){const names=Object.keys(context),body=lines.map(translate).join('\n')+'\nreturn '+result+';';return new Function(...names,body)(...Object.values(context));}
const snapshotLines=pine.slice(pine.indexOf('f_snapshot(string'),pine.indexOf('\nif sourceConfirmed\n')).split('\n').slice(1).filter(line=>/^    (string s =|s \+=)/.test(line));
const packetLines=pine.slice(pine.indexOf('    string snapshots ='),pine.indexOf('    if str.length(packet)')).split('\n').filter(line=>/^    (string (snapshots|packet) =|(snapshots|packet) \+=)/.test(line));
const days=['2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-11-02'];
const base={f_utc,f_number,f_date:formatDate,Math,String,open1930:100,runningHigh:103,runningLow:98,frozenPriorHigh:105,frozenPriorLow:95,frozenPriorDate:Date.parse('2026-11-02T05:00:00Z'),nightAvr:10,frozenAvrDates:JSON.stringify(days),sessionStart:Date.parse('2026-11-03T00:30:00Z'),asiaHigh:102,asiaLow:99,asiaClose:101,londonHigh:103,londonLow:98,londonClose:100,rule:1};
export function renderSnapshot(cutoff,overrides={}){return execute(snapshotLines,{...base,cutoff,stamp:Date.parse('2026-11-03T'+({'03:00':'08:00','05:00':'10:00','08:30':'13:30'}[cutoff])+':00Z'),reference:101,londonReady:cutoff==='08:30',...overrides},'s');}
export function renderPacket(snapshots,market='CL',overrides={}){return execute(packetLines,{f_utc,f_number,f_date:formatDate,String,snapshot0300:snapshots[0]||'',snapshot0500:snapshots[1]||'',snapshot0830:snapshots[2]||'',senderToken:'Q'.repeat(43),syminfo:{root:market,ticker:market+'1!'},sourceCloseTime:Date.parse('2026-11-03T13:35:00Z'),timenow:Date.parse('2026-11-03T13:35:01Z'),targetDay:Date.parse('2026-11-03T05:00:00Z'),sourceClose:101,AVR_PROFILE:'continuous-prior10-0930-1600-frozen-before1930-v1',...overrides},'packet');}

test('all four current market sources use the reviewed input conventions',()=>{
 assert.equal(sourceAudit.source_commit,'0449c1466fb0176a59d03bfccdf3b7054ebaad8c');
 assert.deepEqual(sourceAudit.sources.map(s=>s.market),['CL','NQ','ES','GC']);
 for(const source of sourceAudit.sources)assert.ok(Object.values(source.checks).every(Boolean));
});
test('token display privacy is the only change from the audited sender and both installers match',()=>{
 const flag=', display = display.none';
 const tokenInput=pine.split('\n').filter(line=>/^string senderToken = input\.string\(/.test(line));
 assert.equal(tokenInput.length,1);
 assert.match(tokenInput[0],/^string senderToken = input\.string\("", "Personal write token", group = "Personal connection", display = display\.none,/);
 assert.equal(pine.split(flag).length-1,1,'Privacy flag must occur exactly once, on the token input');
 const sha256=value=>createHash('sha256').update(value).digest('hex');
 const previousHash='fb7d7f7bce903ce9c9d913531f5e80f4214990875d0423125b3cc8edb042bb64';
 assert.equal(sha256(pine.replace(flag,'')),previousHash,'No calculations, sending gates, packet fields or other source may change');
 assert.equal(downloadPine,pine,'Website download must contain the same privacy fix');
 assert.equal(sourceAudit.token_display_privacy.pre_patch_sha256,previousHash);
 assert.equal(sourceAudit.token_display_privacy.patched_sha256,sha256(pine));
 assert.equal(sourceAudit.token_display_privacy.source_only_verified,true);
 assert.equal(sourceAudit.token_display_privacy.inputs_are_masked,false);
});
test('original last-hour arithmetic is retained with stronger base-candle continuity',()=>{
 const start=pine.indexOf('f_behavior(float baseline) =>');
 const actual=pine.slice(start,pine.indexOf('\nint behavior =',start)).replaceAll('sourceClose','close').replaceAll('sourceTime','time').replace('bool contiguous = time[13] == time - 13 * 300000','bool contiguous = true').trim();
 assert.equal(actual,sourceAudit.shared_original_behavior_function);
});
test('03 and 05 use frozen open and never expose incomplete London prices',()=>{
 for(const cutoff of ['03:00','05:00']){
  const snap=JSON.parse(renderSnapshot(cutoff,{reference:106}));
  assert.equal(snap.reference_price,106);assert.equal(snap.range_high,106);assert.equal(snap.range_low,98);
  assert.equal(snap.london_complete,false);assert.equal(snap.london_high,null);assert.equal(snap.london_low,null);assert.equal(snap.london_close,null);
  assert.equal(snap.ready,true);assert.equal(snap.asia_complete,true);
 }
});
test('08:30 includes only the already completed London window',()=>{
 const snap=JSON.parse(renderSnapshot('08:30'));
 assert.equal(snap.as_of,'2026-11-03T13:30:00Z');assert.equal(snap.reference_price,101);
 assert.equal(snap.london_complete,true);assert.equal(snap.london_high,103);assert.equal(snap.london_low,98);assert.equal(snap.london_close,100);
});
test('current cutoff-bar high/low/close do not enter frozen input serialization',()=>{
 const prior=renderSnapshot('03:00');
 assert.equal(renderSnapshot('03:00',{sourceHigh:9999,sourceLow:1,sourceClose:7777}),prior);
 assert.ok(pine.indexOf('if atCutoff and ready')<pine.indexOf('    if inOvernight\n'));
});
test('all ten AVR dates and the exact prior-NY date/count travel with each checkpoint',()=>{
 const snap=JSON.parse(renderSnapshot('05:00'));
 assert.deepEqual(snap.avr_dates,days);assert.equal(snap.avr_count,10);assert.equal(snap.avr_override,false);
 assert.equal(snap.prior_ny_date,days[9]);assert.equal(snap.prior_ny_count,78);assert.equal(snap.avr_frozen_at,'2026-11-03T00:30:00Z');
});
test('heartbeat and every optional checkpoint combination produce valid JSON',()=>{
 for(let mask=0;mask<8;mask++){
  const snapshots=['03:00','05:00','08:30'].map((cutoff,i)=>mask&(1<<i)?renderSnapshot(cutoff):'');
  const packet=JSON.parse(renderPacket(snapshots));
  assert.equal(packet.snapshots.length,snapshots.filter(Boolean).length);assert.equal(packet.confirmed,true);
  assert.equal(packet.observed_at,'2026-11-03T13:35:00Z');assert.equal(packet.session_date,'2026-11-03');
 }
});
test('four market identities remain separate and source/profile provenance is explicit',()=>{
 for(const market of ['CL','NQ','ES','GC']){
  const packet=JSON.parse(renderPacket([renderSnapshot('03:00')],market));
  assert.equal(packet.market,market);assert.equal(packet.source_symbol,market+'1!');
  assert.equal(packet.feed_type,'continuous_front_contract');assert.equal(packet.backadjustment,'off');assert.equal(packet.timeframe,'5');
  assert.equal(packet.avr_profile,'continuous-prior10-0930-1600-frozen-before1930-v1');
 }
});
test('bounded payload with maximum token and large finite numeric fields',()=>{
 const overrides=Object.fromEntries(['open1930','runningHigh','runningLow','frozenPriorHigh','frozenPriorLow','nightAvr','asiaHigh','asiaLow','asiaClose','londonHigh','londonLow','londonClose','reference'].map((key,i)=>[key,999999999.12345678+i]));
 const snapshots=['03:00','05:00','08:30'].map(c=>renderSnapshot(c,overrides));
 const packet=renderPacket(snapshots,'NQ',{senderToken:'Q'.repeat(128),sourceClose:999999999.12345678});
 assert.ok(Buffer.byteLength(packet)<8192);assert.equal(JSON.parse(packet).snapshots.length,3);
});
test('sender gates real confirmed closes and does not request bar confirmation in security',()=>{
 assert.match(pine,/sourceConfirmed = sourceAligned and barstate\.isconfirmed/);
 assert.match(pine,/sourceConfirmed and barstate\.isrealtime and transportFresh/);
 assert.match(pine,/alert\(packet, alert\.freq_once_per_bar_close\)/);
 assert.match(pine,/timenow - sourceCloseTime <= 120000/);
 assert.match(pine,/lookahead = barmerge\.lookahead_off/);
 assert.doesNotMatch(pine,/request\.security\([^\n]*barstate\.isconfirmed/);
});
test('missing latest NY and overnight candles cannot silently reuse an older valid BBOX',()=>{
 assert.match(pine,/latestNyAttemptComplete := false/);
 assert.match(pine,/sourceTime != nyExpectedOpen\n\s+nyComplete := false/);
 assert.match(pine,/latestNyAttemptComplete := nyComplete and nyCount == 78/);
 assert.match(pine,/frozenPriorComplete := latestNyAttemptComplete and not na\(priorNyDate\) and priorNyDate == nyActiveDay/);
 assert.match(pine,/priorNyDate == expectedPriorDay/);
 assert.match(pine,/priorWeekdayOffset = dayofweek\(targetDay, TZ\) == dayofweek\.monday \? 3 : dayofweek\(targetDay, TZ\) == dayofweek\.sunday \? 2 : 1/);
 assert.match(pine,/sourceTime != expectedOvernightOpen\n\s+complete := false/);
});
test('cached checkpoints reset on target session change and cannot be overwritten later',()=>{
 assert.match(pine,/snapshotsDay != targetDay[\s\S]*?snapshot0300 := ""[\s\S]*?snapshot0500 := ""[\s\S]*?snapshot0830 := ""/);
 for(const [minute,name]of [[180,'0300'],[300,'0500'],[510,'0830']])assert.match(pine,new RegExp('clockMinute == '+minute+' and snapshot'+name+' == ""\\n\\s+snapshot'+name+' := frozenSnapshot'));
});
test('secrets and destination remain private configuration with no paid endpoint reuse',()=>{
 assert.match(pine,/senderEnabled = input\.bool\(false/);assert.match(pine,/senderToken = input\.string\(""/);
 assert.doesNotMatch(pine,/https?:\/\/|model-forecast-webhook|log\.(info|warning|error)|syminfo\.current_contract/);
 assert.match(pine,/sessionpath\.personal\.tradingview\.v1/);
});
test('actual receiver accepts the exact serialized sender fields for all four markets and strips token',()=>{
 for(const market of ['CL','NQ','ES','GC']){
  const packet=JSON.parse(renderPacket(['03:00','05:00','08:30'].map(c=>renderSnapshot(c)),market));
  const clean=normalizePacket(packet,{now:Date.parse(packet.sent_at)});
  assert.equal(clean.snapshots.length,3);assert.equal(clean.market,market);assert.equal(Object.hasOwn(clean,'token'),false);
 }
});
test('19:30 closing old-session heartbeat and19:35 new-session heartbeat match receiver boundary',()=>{
 for(const [close,target]of [['2026-11-04T00:30:00Z','2026-11-03'],['2026-11-04T00:35:00Z','2026-11-04']]){
  const closeMs=Date.parse(close),packet=JSON.parse(renderPacket([],'CL',{sourceCloseTime:closeMs,timenow:closeMs+1000,targetDay:Date.parse(target+'T05:00:00Z')}));
  const clean=normalizePacket(packet,{now:closeMs+1500});
  assert.equal(clean.session_date,target);assert.equal(clean.snapshots.length,0);
 }
});
test('receiver rejects missing-whole-prior-weekday and preserves display quote separately',()=>{
 const packet=JSON.parse(renderPacket([renderSnapshot('03:00')],'CL',{sourceClose:999}));
 const clean=normalizePacket(packet,{now:Date.parse(packet.sent_at)});
 assert.equal(clean.last_price,999);assert.equal(clean.snapshots[0].reference_price,101);
 packet.snapshots[0].prior_ny_date='2026-10-30';
 assert.throws(()=>normalizePacket(packet,{now:Date.parse(packet.sent_at)}),error=>error.code==='INVALID_PRIOR_SESSION');
});
