import fs from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const [, , site, clCsv, output] = process.argv;
if (!site || !clCsv || !output) throw Error('Usage: node build-avr-deadlines.mjs SITE_DOCS CL_NATIVE_CSV OUTPUT_DIR');
const markets = {
  CL: ['data', '', '6e44ecbaf351f7c8c4074555aad9f9091996f117', '9c465c3d83886f1486a536f323c4d994410aaa84', '6bcfffddb17168e769e22b5ff43a47b4dd69449e'],
  NQ: ['data/nq', 'data/nq', '039d30c682cf556be607766f3308e1029eebdfb5', 'a3238987594730702ac18d16059325f6da9e9ee7', '49744e7079b95c6c5161cf969a0320ea39a66808'],
  ES: ['es/data/es', 'es/data/es', 'db90ee682fc1ca1d53487851fdf391b697d45e07', '2e62ace1ca88cf4a57f66f317441851a5dc47e11', 'f18368b370fd9c02e9873eead833282c9cf62042'], 
  GC: ['gc/data/gc', 'gc/data/gc', 'b65d15a5592decb7f7eaf4a58f3510b3725e5f6f', '73d85489b4f64c24078d60618a44321a03315fb8', '7824ce34d2d481c8d1eb2a268738ac7bb42b4f4e'],
};
const read = async (p, pin) => {
  const bytes = await fs.readFile(resolve(site, p));
  const digest = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  assert.equal(digest, pin, 'Input version changed: ' + p);
  return JSON.parse(bytes);
};
const write = async (path, contents) => {
  const file = resolve(output, path);
  await fs.mkdir(dirname(file), {recursive:true});
  await fs.writeFile(file, contents);
};
const clock = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const raw = await fs.readFile(clCsv, 'utf8');
const native = new Map();
const start = -270, step = 5;
const checkpoints = [510, 630, 690, 960];
const EPS = 1e-8;
const reference = ['0–<25%','25–<50%','50–<75%','75–<100%','100%+'];
const dateMinusOne = date => new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
const finite = Number.isFinite;
const index = minute => (minute-start)/step;
for (const [i, line] of raw.trim().split(/\r?\n/).entries()) {
  if (!i) {assert.equal(line.replace(/^\uFEFF/,''), 'time,open,high,low,close'); continue;}
  const values = line.split(',');
  assert(values.length >= 5 && values.slice(0,5).every(v=>v.trim()!==''), 'Native CL row missing a number');
  const [stamp,open,high,low,close] = values.map(Number);
  const parts = Object.fromEntries(clock.formatToParts(stamp*1000).map(p=>[p.type,p.value]));
  const day = parts.year+'-'+parts.month+'-'+parts.day, minute = +parts.hour*60+ +parts.minute;
  const bars = native.get(day) || new Map();
  const previous = bars.get(minute);
  const row = [stamp,open,high,low,close];
  if(previous)assert.deepEqual(previous,row,'Conflicting native five-minute candle');
  bars.set(minute,row);
  native.set(day,bars);
}
function nativeDay(date) {
  const prior = native.get(dateMinusOne(date)), today = native.get(date);
  const values=[], opens=[];
  let previous;
  for(let m=start; m<960; m+=step){
    const bar = m<0 ? prior?.get(m+1440) : today?.get(m);
    if(!bar||previous!==undefined&&bar[0]-previous!==300)return null;
    values.push(bar[2],bar[3],bar[4]);
    opens.push(bar[1]);
    previous=bar[0];
  }
  return {row:[null,null,values,opens],scale:1};
}
function measure(row, scale, obs) {
  let high=-Infinity, low=Infinity;
  const widths = [];
  for(let i=0;i<index(960);i++){
    const h=row[2][i*3],l=row[2][i*3+1],c=row[2][i*3+2];
    if(![h,l,c].every(finite)||h<l||c<l||c>h)return null;
    high=Math.max(high,h);
    low=Math.min(low,l);
    if(checkpoints.includes(start+step*(i+1)))widths.push((high-low)/(scale*obs.avr));
  }
  let [p0830,p1030,p1130,p16]=widths;
  if(Math.abs(p0830-obs.p0830)>1e-7){
    const initOpen=row[3]?.[index(510)];
    if(!finite(initOpen))return null;
    const early=row[2].slice(0,index(510)*3);
    const hi=Math.max(initOpen,...early.filter((_,i)=>i%3===0));
    const lo=Math.min(initOpen,...early.filter((_,i)=>i%3===1));
    p0830=(hi-lo)/(scale*obs.avr);
  }
  assert(Math.abs(p0830-obs.p0830)<1e-7&&Math.abs(p16-obs.p16)<1e-7,'Published endpoints disagree: '+obs.date);
  assert(p0830<=p1030+EPS&&p1030<=p1130+EPS&&p1130<=p16+EPS,'Cumulative range shrank: '+obs.date);
  return {p1030,p1130};
}
function stats(rows,target){
  const eligible=rows.filter(r=>r.p0830<target-EPS);
  const hits=['p1030','p1130','p16'].map(key=>eligible.filter(r=>r[key]>=target-EPS).length);
  return {n:eligible.length,hits};
}
const results={};
const lines=['market,date,avr,printed_0830,printed_1030,printed_1130,printed_1600,source'];
for (const [market,[dataDir,assets,dayPin,timelinePin,obsPin]] of Object.entries(markets)) {
  const [days,timeline,{avr}] = await Promise.all([
    read(dataDir+'/days.json',dayPin),read(dataDir+'/timeline.json',timelinePin),
    read((assets?assets+'/':'')+'research-observations.json',obsPin),
  ]);
  const rows = Array.isArray(timeline)?timeline:timeline.rows;
  assert.equal(timeline.startMinute??start,start);assert.equal(timeline.stepMinutes??step,step);
  const scale=timeline.priceScale??100;
  const dates=new Map(days.map(d=>[d.date,d]));
  const candles=new Map(rows.map(r=>[r[0],r]));
  const eligible=avr.filter(r=>finite(r.avr)&&r.avr>0&&finite(r.p0830)&&finite(r.p16)&&r.p16>=r.p0830-EPS).sort((a,b)=>a.date.localeCompare(b.date));
  assert.equal(new Set(eligible.map(r=>r.date)).size,eligible.length,'Duplicate dates');
  let clNative=0, encoded='';
  const measured=eligible.map(o=>{
    const timelineRow=candles.get(dates.get(o.date)?.index);
    let values = timelineRow ? measure(timelineRow,scale,o) : null;
    let source='published timeline';
    if(!values&&market==='CL'){
      const other=nativeDay(o.date);
      if(other){values=measure(other.row,other.scale,o);clNative++;source='TradingView CLX2026 five-minute export';}
    }
    assert(values,'No verified timing for '+market+' '+o.date);
    const row={...o,...values};
    encoded+=o.date.replaceAll('-','')+[.75,1].map(t=>row.p1030>=t-EPS?'1':row.p1130>=t-EPS?'2':'0').join('');
    lines.push([market,row.date,row.avr,row.p0830,row.p1030,row.p1130,row.p16,source].join(','));
    return row;
  });
  results[market]={n:measured.length,from:measured[0].date,to:measured.at(-1).date,clNative,
    overall:[.75,1].map(target=>({target,...stats(measured,target)})),
    regimes:reference.map((band,i)=>({band,targets:[.75,1].map(target=>({target,...stats(measured.filter(r=>Math.min(4,Math.floor((r.p0830+1e-9)/.25))===i),target)}))})),
    recent:[.75,1].map(target=>({target,...stats(measured.filter(r=>r.date>='2025-01-01'),target)})),
  };
  await write('docs/'+(assets?assets+'/':'')+'avr-deadlines-v1.json',JSON.stringify({version:1,market,days:encoded})+'\n');
}
await write('audit.json',JSON.stringify(results,null,2)+'\n');
await write('AVR-target-deadline-observations.csv',lines.join('\n')+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([market,{n,clNative,overall}])=>[market,{n,clNative,overall}])),null,2));
