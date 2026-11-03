import {webcrypto,timingSafeEqual} from 'node:crypto';
import {PERSONAL_SCHEMA,PERSONAL_AVR_PROFILE,nyEpoch,datePlus} from '../validation.mjs';
export const testCrypto={subtle:{digest:webcrypto.subtle.digest.bind(webcrypto.subtle),timingSafeEqual:(a,b)=>timingSafeEqual(new Uint8Array(a),new Uint8Array(b))}};
export const WRITE_TOKEN='write-token-test-00000000000000000000000000000000';
export const READ_TOKEN='read-token-test-000000000000000000000000000000000';
export function fixture({market='CL',date='2026-11-03',clock='08:35',cutoffs=['03:00','05:00','08:30']}={}){
  const observed=nyEpoch(date,clock),prior=datePlus(date,-1),avr_dates=['2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30',prior];
  const p={schema:PERSONAL_SCHEMA,token:WRITE_TOKEN,market,source_symbol:market+'1!',timeframe:'5',timezone:'America/New_York',confirmed:true,observed_at:new Date(observed).toISOString(),sent_at:new Date(observed+1000).toISOString(),session_date:date,avr_profile:PERSONAL_AVR_PROFILE,feed_type:'continuous_front_contract',backadjustment:'off',last_price:100,snapshots:cutoffs.map((cutoff,i)=>({cutoff,as_of:new Date(nyEpoch(date,cutoff)).toISOString(),reference_price:100,open_1930:100,range_high:102+i,range_low:98-i,prior_high:105,prior_low:95,prior_ny_date:prior,prior_ny_count:78,avr:5.123456,avr_count:10,avr_dates,avr_frozen_at:new Date(nyEpoch(prior,'19:30')).toISOString(),avr_override:false,last_hour_rule:1,asia_high:101,asia_low:99,asia_close:100,asia_complete:true,london_high:cutoff==='08:30'?103:null,london_low:cutoff==='08:30'?97:null,london_close:cutoff==='08:30'?100:null,london_complete:cutoff==='08:30',ready:true}))};
  return {packet:p,now:observed+2000};
}
export class FakeStorage{
  constructor(){this.values=new Map();this.queue=Promise.resolve();this.puts=0;}
  async get(k){return structuredClone(this.values.get(k));}
  async put(k,v){this.puts++;this.values.set(k,structuredClone(v));}
  transaction(fn){const run=this.queue.then(()=>fn(this));this.queue=run.catch(()=>{});return run;}
}
