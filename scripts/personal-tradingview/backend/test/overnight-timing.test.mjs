import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeOvernightTiming } from '../overnight-timing.mjs';

const open = {
  cutoff:'03:00', reference_price:95, prior_low:90, prior_high:100,
  prior_ny_date:'2026-11-18', bbox_history:{phases:[1,2,null,null]},
};
const normal = [9800,9400,9700];
const returnBar = [10100,9400,9700];
const wickOutside = [10200,9400,10100];
const packet = (time, bars, snapshots=[open]) => ({
  market:'CL', session_date:'2026-11-19', observed_at:'2026-11-19T'+time+':00Z',
  last_price:bars.at(-1)?.[2]/100 || 95, research_bars:bars.flat(), snapshots,
});

test('completed wicks and inside returns use different steps, with an unverified evening reopen', () => {
  const context = summarizeOvernightTiming(packet('08:05',[returnBar]));
  assert.equal(context.window,2);
  assert.equal(context.step,109);
  assert.equal(context.activeMask,1);
  assert.equal(context.activeComplete,true);
  assert.deepEqual(context.past,[null,3]);
  assert.deepEqual(context.observedPaths[0],{returnConfirmed:true,freshWindow:null});
  assert.deepEqual(context.observedPaths[1],{returnConfirmed:true,freshWindow:null});
  const repeated = summarizeOvernightTiming(packet('08:10',[returnBar,wickOutside]));
  assert.equal(repeated.observedPaths[0].freshWindow,2);
});

test('prior fresh wick applies at the next verified decision open without using the new window', () => {
  const recent = {...open,cutoff:'05:00',reference_price:92};
  const bars = [returnBar,wickOutside,...Array.from({length:22},()=>normal)];
  const context = summarizeOvernightTiming(packet('10:00',bars,[open,recent]));
  assert.equal(context.window,3);
  assert.equal(context.price,92);
  assert.equal(context.position,0);
  assert.equal(context.activeMask,0);
  assert.equal(context.activeComplete,true);
  assert.deepEqual(context.past,[null,3,1]);
  assert.equal(context.priorPaths[0].freshWindow,2);
});

test('gaps prevent a pending or fresh-break assertion without contiguous observations', () => {
  const context = summarizeOvernightTiming(packet('08:15',[returnBar,[null,null,null],wickOutside]));
  assert.equal(context.activeComplete,false);
  assert.equal(context.activeMask,1);
  assert.equal(context.observedPaths[0].freshWindow,null);
  const waiting = summarizeOvernightTiming(packet('10:00',[]));
  assert.equal(waiting.openingSide,null);
  assert.equal(waiting.activeComplete,false);
  assert.equal(waiting.price,null);
});
