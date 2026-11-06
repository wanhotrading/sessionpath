import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {CHART_REFERENCE_VERSION,CHART_READING_SYSTEM,CHART_COMPARISON_PROMPT} from '../../../docs/chart-reading-reference.mjs';

const fixtureRoot=new URL('../../../../../outputs/sessionpath-chart-vision/',import.meta.url);
const truth=JSON.parse(await readFile(new URL('sessionpath-chart-test-ground-truth.json',fixtureRoot),'utf8'));
const manifest=JSON.parse(await readFile(new URL('manifest.json',fixtureRoot),'utf8'));
const inside=(price,lo,hi)=>price>=lo&&price<=hi;
const at=time=>truth.bars.find(bar=>bar.openTime===time);

test('the copied comparison prompt uses the exact same versioned chart instructions as the endpoint',()=>{
 assert.equal(CHART_REFERENCE_VERSION,'sessionpath-chart-v2');
 assert.equal(typeof CHART_READING_SYSTEM,'string');assert.equal(typeof CHART_COMPARISON_PROMPT,'string');
 assert.ok(CHART_COMPARISON_PROMPT.startsWith(CHART_READING_SYSTEM));assert.ok(CHART_COMPARISON_PROMPT.split(/\s+/).length<=1500);
 for(const required of ['03:00–05:00','05:00–08:30','08:30–16:00','19:30','09:30–16:00','current completed close','not verified image metadata','forecast window does not set the observation cutoff','not automatic buy/sell signals','not 1.2 statistical standard deviations','do not create a forecast','Answer in the user\'s language'])assert.ok(CHART_READING_SYSTEM.includes(required),required);
 for(const required of ['Lead Summary, BBOX and SessionPath with that CURRENT state','three complete sentences and 60 words','each at most 25 words','WHOLE visible path, not the first eight candles','Do not transcribe every candle','NEVER estimate it from axis ticks, pixels or neighbouring candles','Visible candles without numeric value cards are still visible'])assert.ok(CHART_READING_SYSTEM.includes(required),required);
});

test('the chart reference gives the archive classifier rules and separates evidence from labels',()=>{
 for(const term of ['W < 0.18 × B','Equality is not Narrow','W=0','earliest occurrence','p≤0.25 is DOWN_FINISH','p≥0.70 is DROP_RECOVERY','between is DOWN_THEN_BOUNCE','p≤0.30 is RALLY_FADE','p≥0.75 is UP_FINISH','between is UP_THEN_PULLBACK','not ORDER_UNRESOLVED','The server assigns codes']) assert.ok(CHART_READING_SYSTEM.includes(term),term);
 for(const term of ['12 five-minute bars','18 at 18:00–19:30','NY (09:30–16:00, not the 08:30 forecast start)','a capture timestamp alone does not establish the candle clock','provisional','a live candle countdown','flag the mismatch','shapeEvidence','high_first, low_first, same_bar']) assert.ok(CHART_READING_SYSTEM.toLowerCase().includes(term.toLowerCase()),term);
 assert.ok(CHART_READING_SYSTEM.indexOf('W < 0.18 × B')<CHART_READING_SYSTEM.indexOf('W=0'));
 assert.ok(CHART_COMPARISON_PROMPT.includes('Session Shape Evidence'));
});

test('the public fixture is labelled synthetic, omits the delivery contract and contains no future candle',()=>{
 assert.equal(truth.synthetic,true);assert.equal(truth.privateData,false);assert.equal(truth.metadata.contract,null);assert.equal(truth.metadata.timezone,'America/New_York');assert.equal(truth.metadata.observationCutoff,'04:00');assert.equal(truth.metadata.futureBarsVisible,false);
 assert.equal(truth.bars[0].openTime,'03:00');assert.equal(truth.bars.at(-1).openTime,'03:55');assert.equal(truth.bars.at(-1).completeTime,'04:00');assert.ok(truth.bars.every(bar=>bar.completeTime<='04:00'));
});

test('fixture ground truth distinguishes the first wick breach from a later close-outside event',()=>{
 const {sessionPathD:d,sessionPathU:u}=truth.levels,first=truth.bars.find(bar=>bar.high>u||bar.low<d);
 assert.equal(first.openTime,'03:10');assert.equal(first.completeTime,'03:15');assert.ok(first.high>u);assert.ok(inside(first.close,d,u));
 const firstOutside=truth.bars.find(bar=>!inside(bar.close,d,u));assert.equal(firstOutside.openTime,'03:15');assert.equal(firstOutside.completeTime,'03:20');assert.ok(firstOutside.close>u);
});

test('fixture current state differs from its earlier opposite-direction state and completed BBOX return',()=>{
 const {bboxLow:lo,bboxHigh:hi,sessionPathD:d,sessionPathU:u}=truth.levels,conflicting=at('03:25'),wick=at('03:30'),returned=at('03:35'),current=truth.bars.at(-1);
 assert.ok(conflicting.close>hi&&conflicting.close<d);assert.ok(inside(wick.low,lo,hi));assert.ok(wick.close>hi);
 assert.equal(returned.completeTime,'03:40');assert.ok(inside(returned.close,lo,hi));
 assert.ok(current.close>hi);assert.ok(inside(current.close,d,u));assert.equal(current.close,103);
});

test('the two orange features retain separate anchors and the fixture records actual visible reaches',()=>{
 const levels=truth.levels,w=levels.sessionPathU-levels.sessionPathD;
 assert.equal(w,4);assert.equal(levels.rangeMultiple120Up,levels.sessionPathD+1.2*w);assert.equal(levels.rangeMultiple120Down,levels.sessionPathU-1.2*w);
 assert.equal(levels.orangeAddedUp.target,levels.runningHighAt0300+levels.orangeAddedUp.distance);assert.equal(levels.orangeAddedDown.target,levels.runningLowAt0300-levels.orangeAddedDown.distance);
 assert.notEqual(levels.orangeAddedUp.target,levels.rangeMultiple120Up);
 assert.ok(truth.bars.some(bar=>bar.high>=levels.orangeAddedUp.target));assert.ok(truth.bars.every(bar=>bar.low>levels.orangeAddedDown.target));
 assert.equal(truth.bars.find(bar=>bar.high>=levels.rangeMultiple120Up).openTime,'03:20');assert.equal(truth.bars.find(bar=>bar.low<=levels.rangeMultiple120Down).openTime,'03:30');
});

test('PNG and JPEG evidence hashes and byte sizes match the reproducible fixture manifest',async()=>{
 for(const file of manifest.files){const bytes=await readFile(new URL(file.file,fixtureRoot));assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
 const png=await readFile(new URL('sessionpath-chart-test-fixture.png',fixtureRoot));assert.equal(png.readUInt32BE(16),1920);assert.equal(png.readUInt32BE(20),1280);
});
