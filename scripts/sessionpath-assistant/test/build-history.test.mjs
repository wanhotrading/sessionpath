import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildHistoricalInputs,parseNativeCSV,historicalSnapshot,verifyPreparedAudit,DEFAULT_CSV,DEFAULT_AUDIT,DEFAULT_OUTPUT,EXPLICIT_AVR_PROFILE} from '../build-history.mjs';
import {nyTimeToEpoch} from '../../data-service/full-context/lib/context-calculations.mjs';

const [bytes,auditText]=await Promise.all([readFile(DEFAULT_CSV),readFile(DEFAULT_AUDIT,'utf8')]);
const audit=JSON.parse(auditText),bars=parseNativeCSV(bytes),asset=buildHistoricalInputs(bytes,{audit});

test('all twelve audited journal checkpoints reproduce their original native inputs',()=>{
 assert.equal(verifyPreparedAudit(asset,audit,bytes),12);assert.ok(asset.records.length>=12);assert.equal(parseNativeCSV(bytes).length,audit.source.barCount);const nov=asset.records.filter(record=>record.date==='2026-11-02');assert.deepEqual(nov.map(record=>record.snapshot.reference_price),[100.72,99.7,99.78]);for(const {snapshot:s}of nov){assert.ok(Math.abs(s.avr-2.628)<1e-12);assert.equal(s.prior_high,104.98);assert.equal(s.prior_low,102.93);}assert.equal(nov[0].snapshot.range_high,102.52);assert.equal(nov[0].snapshot.range_low,100.15);
});
test('published inputs are reproducible and include provenance, not raw future candles or absolute paths',async()=>{
 const published=JSON.parse(await readFile(DEFAULT_OUTPUT,'utf8'));assert.deepEqual(published,asset);const serialized=JSON.stringify(published);assert.doesNotMatch(serialized,/C:\\\\|Administrator|matchingDates|forecast|closes|raw_bars|future|Volume/);for(const record of asset.records){assert.equal(record.source.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(record.source.avrProfile,EXPLICIT_AVR_PROFILE);assert.equal(record.contract,'NYMEX:CLZ2026');}
});
test('each checkpoint uses only complete earlier reference sessions and the preceding calendar-night freeze',()=>{
 const keys=new Set();for(const {date,snapshot:s}of asset.records){const key=date+'|'+s.cutoff;assert.equal(keys.has(key),false);keys.add(key);assert.equal(s.avr_count,10);assert.equal(s.prior_ny_count,78);assert.equal(s.avr_dates.length,10);assert.deepEqual(s.avr_dates,[...new Set(s.avr_dates)].sort());assert.equal(s.avr_dates.at(-1),s.prior_ny_date);const prev=new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);assert.equal(Date.parse(s.avr_frozen_at)/1000,nyTimeToEpoch(prev,'19:30'));for(const day of s.avr_dates)assert.ok(nyTimeToEpoch(day,'16:00')<Date.parse(s.avr_frozen_at)/1000);assert.equal(s.asia_complete,true);assert.equal(s.london_complete,s.cutoff==='08:30');if(s.cutoff!=='08:30')assert.deepEqual([s.london_high,s.london_low,s.london_close],[null,null,null]);}
});
test('decision-bar future extremes and every later candle cannot change a frozen snapshot',()=>{
 const time=nyTimeToEpoch('2026-11-02','03:00'),baseline=historicalSnapshot(bars,'2026-11-02','03:00');const mutated=bars.map(bar=>bar.time>=time?{...bar,high:10000,low:-10000,close:5000}:bar);assert.deepEqual(historicalSnapshot(mutated,'2026-11-02','03:00'),baseline);assert.deepEqual(historicalSnapshot(bars.filter(bar=>bar.time<=time),'2026-11-02','03:00'),baseline);
});
test('missing input candles are never interpolated; duplicate or malformed CSV candles fail',()=>{
 const missing=bars.filter(bar=>bar.time!==nyTimeToEpoch('2026-11-02','02:55'));assert.throws(()=>historicalSnapshot(missing,'2026-11-02','03:00'),error=>error.code==='INCOMPLETE_OVERNIGHT');assert.throws(()=>parseNativeCSV('time,open,high,low,close\n300,1,2,0,1\n300,1,2,0,1'),/Duplicate/);assert.throws(()=>parseNativeCSV('time,open,high,low,close\n300,1,0,2,1'),/Invalid CL/);assert.throws(()=>verifyPreparedAudit(asset,{...audit,source:{...audit.source,sha256:'0'.repeat(64)}},bytes),/provenance/);
});
test('NY daylight-saving conversion changes offsets without moving the local checkpoints',()=>{
 const before=asset.records.find(record=>record.date==='2026-10-30'&&record.snapshot.cutoff==='03:00').snapshot,after=asset.records.find(record=>record.date==='2026-11-02'&&record.snapshot.cutoff==='03:00').snapshot;assert.equal(before.as_of,'2026-10-30T07:00:00.000Z');assert.equal(after.as_of,'2026-11-02T08:00:00.000Z');
});
