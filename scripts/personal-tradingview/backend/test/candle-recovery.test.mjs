import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {normalizePacket,nyEpoch} from '../validation.mjs';
import {validatePersonalRead} from '../../../../docs/tradingview-live-core.mjs';
import {createCheckpointRecovery} from '../../../../docs/checkpoint-recovery.mjs';
function setup(market='CL'){
 const {now,packet}=fixture({market,clock:'08:40'}),s=packet.snapshots[0];
 packet.snapshots=[];
 const reference=Object.fromEntries(['prior_ny_date','prior_ny_count','prior_high','prior_low','avr','avr_dates'].map(k=>[k,s[k]]));
 const tick={CL:.01,ES:.25,NQ:.25,GC:.1}[market];
 packet.recovery={v:1,base:Math.round(100/tick),from:nyEpoch('2026-11-02','19:30'),reference,bars:Array.from({length:157},()=>[0,1,-1,0])};
 packet.recovery.bars[114]=[2,200,-180,0];
 return {now,packet,tick};
}
for(const market of ['CL','ES','NQ','GC'])test(market+' reconstructs all past decisions and excludes price moves after the cutoff',()=>{
 const {packet,now,tick}=setup(market);
 const read=normalizePacket(packet,{now});
 assert.deepEqual(read.snapshots.map(s=>s.cutoff),['03:00','05:00','08:30']);
 assert.equal(read.snapshots[1].reference_price,100+2*tick);
 assert.equal(read.snapshots[1].range_high,100+2*tick);
 assert.equal(read.snapshots[1].range_low,100-tick);
 assert.equal(read.snapshots[2].range_high,100+200*tick);
});
test('exchange-marked contiguous short session supplies BBOX but is excluded from the ten full-session AVR dates',()=>{
 const {packet,now}=setup();
 Object.assign(packet.recovery.reference,{prior_ny_count:42,prior_exchange_close:'2026-11-02T18:00:00Z'});
 packet.recovery.reference.avr_dates=['2026-10-19',...packet.recovery.reference.avr_dates.slice(0,9)];
 const p=normalizePacket(packet,{now});assert.equal(p.snapshots.length,3);
 assert.equal(validatePersonalRead({schema:'sessionpath.tradingview.read.v1',status:'ready',packet:p,receivedAt:p.sent_at},{market:'CL',now}).snapshots.length,3);
 packet.recovery.reference.prior_ny_count=41;
 assert.equal(normalizePacket(packet,{now}).snapshots.length,0);
});
test('partial history recovers only completed cutoffs and invalid evidence leaves the incoming quote usable',()=>{
 const {packet,now}=setup();packet.recovery.bars.length=114;
 assert.deepEqual(normalizePacket(packet,{now}).snapshots.map(s=>s.cutoff),['03:00']);
 packet.recovery.bars[8]=null;assert.equal(normalizePacket(packet,{now}).last_price,100);
 assert.equal(normalizePacket(packet,{now}).snapshots.length,0);
});
test('retries share one refresh and back off, then reset on good data',()=>{
 let time=0,count=0;const r=createCheckpointRecovery({now:()=>time,notify:()=>count++});
 assert.equal(r.missing(),5000);assert.equal(r.missing(),5000);assert.equal(count,1);
 time=5000;assert.equal(r.missing(),15000);r.success();assert.equal(r.missing(),5000);assert.equal(count,3);
});
