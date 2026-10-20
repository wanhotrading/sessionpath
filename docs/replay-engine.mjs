import {readSnapshot, deriveRows, selectMatches, summarize, clockLabel, mean, bucket} from './window-engine.mjs';
import {instrument} from './instrument.mjs';

export const MODEL_VERSION = 'actual-open-v8 / numeric matching + prior-BBOX bucket / equal weights';
export const WINDOWS = [[180,300],[300,510]];
export const behaviors = ['', 'Higher finish', 'Lower finish', 'Trend down then recover', 'Trend up then fade', 'Little net change'];

export function archiveInputs(days,timeline,date,minute) {
  if (![180,300,510].includes(minute)) throw Error('Choose 03:00, 05:00 or 08:30.');
  const day=days.find(d=>d.date===date), s=day && readSnapshot(day,timeline,minute);
  if (!s) throw Error('This archive has no complete decision snapshot for that date and time. Use the chart table instead.');
  return {date,minute,contract:day.contract,price:s.closePrice,avr:day.avr,open1930:day.open1930,rangeHigh:s.runningHigh,rangeLow:s.runningLow,priorHigh:day.priorHigh,priorLow:day.priorLow,behavior:s.behavior};
}

// Only this explicit, versioned payload is accepted; no prose or arbitrary field names.
export function parseSnapshot(text,market=instrument.id) {
  if(!['CL','NQ'].includes(market))throw Error('Choose CL or NQ before importing a snapshot.');
  const prefix=market==='NQ'?'NSPI1':'SPI1',match=String(text).match(/(?:^|[^A-Z0-9])(N?SPI1\|[^\r\n]+)/);
  if (!match) throw Error(`Paste the ${prefix} snapshot line from Pine Logs.`);
  const a=match[1].trim().split('|');
  if(a[0]!==prefix)throw Error(`This snapshot belongs to another market. Select ${market} and use its ${prefix} code.`);
  if(a.length!==14 || !/^\d{4}-\d{2}-\d{2}$/.test(a[1]) || new Date(a[1]+'T12:00:00Z').toISOString().slice(0,10)!==a[1] || !['03:00','05:00','08:30'].includes(a[2])) throw Error('Invalid snapshot date, time or format.');
  const v=a.slice(4,11).map(x=>x.trim()===''?NaN:Number(x)), [price,avr,open1930,rangeHigh,rangeLow,priorHigh,priorLow]=v;
  if(v.some(x=>!Number.isFinite(x)) || avr<=0 || rangeHigh<=rangeLow || priorHigh<=priorLow || [price,open1930].some(x=>x<rangeLow-1e-8||x>rangeHigh+1e-8) || a[12]!=='1' || !['manual','10NY'].includes(a[13])) throw Error('Snapshot is incomplete or has invalid prices/AVR. Load full chart history or enter the correct AVR override.');
  const symbolPattern=market==='NQ'?/^([A-Z0-9_]+:)?(MNQ|NQ)[A-Z0-9!]+$/:/^([A-Z0-9_]+:)?(MCL|CL)[A-Z0-9!]+$/;
  if(!symbolPattern.test(a[3]) || !/^\d$/.test(a[11]) || !behaviors[Number(a[11])]) throw Error('Snapshot symbol or behavior is invalid for '+market+'.');
  const [h,m]=a[2].split(':').map(Number);
  return {date:a[1],minute:h*60+m,contract:a[3],price,avr,open1930,rangeHigh,rangeLow,priorHigh,priorLow,behavior:behaviors[Number(a[11])]};
}

export function touchOrder(row,upPoints,downPoints) {
  const {start,step,scale}=row._layout, bars=row._source[2], from=(row.minute-start)/step,to=(row.endMinute-start)/step;
  let upper=null,lower=null;
  for(let i=from;i<to;i++) {
    if(upper===null && bars[i*3]/scale >= row.closePrice+upPoints-1e-9) upper=start+i*step;
    if(lower===null && bars[i*3+1]/scale <= row.closePrice-downPoints+1e-9) lower=start+i*step;
  }
  return {upperTouch:upper===null?'':clockLabel(upper),lowerTouch:lower===null?'':clockLabel(lower),firstTouch:upper===null&&lower===null?'neither':upper===lower?'same 5m bar - unresolved':lower===null||upper!==null&&upper<lower?'upper':'lower'};
}

export function scoreWindow({days,timeline,day,minute,end,rows,limit=50,minCases=50,includeBehavior=false}) {
  // Construct the query without looking at this day's outcome or future completeness.
  const s=readSnapshot(day,timeline,minute);
  if(!s) return {date:day.date,window:clockLabel(minute)+'-'+clockLabel(end),status:'missing snapshot'};
  const q={minute,endMinute:end,beforeDate:day.date,date:day.date,price:s.closePrice,avr:day.avr,printed:s.rangeAvr,up:s.upAvr,down:s.downAvr,q:s.bboxPosition,rangePosition:s.closeInRunningRange,location:bucket(s.bboxPosition),tags:[],observations:[],behavior:includeBehavior?s.behavior:'',limit};
  const eligible=rows.filter(r=>r.minute===minute&&r.endMinute===end);
  const selection=selectMatches(days,eligible,q), baseline=selectMatches(days,eligible,{minute,beforeDate:day.date,limit:'ALL',tags:[]});
  const base={date:day.date,contract:day.contract,window:clockLabel(minute)+'-'+clockLabel(end),model:MODEL_VERSION,caseLimit:limit,behaviorFilter:includeBehavior,matchedCases:selection.matches.length,baselineCases:baseline.matches.length,avr:day.avr,decisionOpen:s.closePrice,printedAVR:s.rangeAvr};
  if(selection.matches.length<minCases) return {...base,status:'insufficient earlier cases'};
  const forecast=summarize(selection.matches,{avr:day.avr,price:s.closePrice}), plain=summarize(baseline.matches,{avr:day.avr,price:s.closePrice});
  const f={...base,latestMatch:selection.matches.map(m=>m.day.date).sort().at(-1),forecastUp:forecast.up.meanPoints,forecastDown:forecast.down.meanPoints,medianUp:forecast.up.medianPoints,medianDown:forecast.down.medianPoints,forecastExpansionUp:forecast.extensionUp.meanPoints,forecastExpansionDown:forecast.extensionDown.meanPoints,forecastFinalRangeAVR:s.rangeAvr+forecast.additionalRange.mean,baselineUp:plain.up.meanPoints,baselineDown:plain.down.meanPoints,baselineExpansionUp:plain.extensionUp.meanPoints,baselineExpansionDown:plain.extensionDown.meanPoints};
  const actual=eligible.find(r=>r.dayIndex===day.index);
  if(!actual) return {...f,status:'missing outcome'};
  const u=actual.nextHighAvr*day.avr,d=-actual.nextLowAvr*day.avr;
  return {...f,status:'scored',actualUp:u,actualDown:d,upError:f.forecastUp-u,downError:f.forecastDown-d,upAbsoluteError:Math.abs(f.forecastUp-u),downAbsoluteError:Math.abs(f.forecastDown-d),medianUpAbsoluteError:Math.abs(f.medianUp-u),medianDownAbsoluteError:Math.abs(f.medianDown-d),upErrorAVR:(f.forecastUp-u)/day.avr,downErrorAVR:(f.forecastDown-d)/day.avr,baselineUpAbsoluteError:Math.abs(f.baselineUp-u),baselineDownAbsoluteError:Math.abs(f.baselineDown-d),actualExpansionUp:actual.extensionUpAvr*day.avr,actualExpansionDown:actual.extensionDownAvr*day.avr,expansionUpAbsoluteError:Math.abs(f.forecastExpansionUp-actual.extensionUpAvr*day.avr),expansionDownAbsoluteError:Math.abs(f.forecastExpansionDown-actual.extensionDownAvr*day.avr),baselineExpansionUpAbsoluteError:Math.abs(f.baselineExpansionUp-actual.extensionUpAvr*day.avr),baselineExpansionDownAbsoluteError:Math.abs(f.baselineExpansionDown-actual.extensionDownAvr*day.avr),upperOvershoot:Math.max(0,u-f.forecastUp),lowerOvershoot:Math.max(0,d-f.forecastDown),unusedUpper:Math.max(0,f.forecastUp-u),unusedLower:Math.max(0,f.forecastDown-d),contained:u<=f.forecastUp+1e-9&&d<=f.forecastDown+1e-9,actualFinalRangeAVR:actual.totalRangeAvr,...touchOrder(actual,f.forecastUp,f.forecastDown)};
}

export async function runReplay(days,timeline,{from,to,limit=50,minCases=50,includeBehavior=false,onProgress=()=>{}}={}) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from||'') || !/^\d{4}-\d{2}-\d{2}$/.test(to||'') || from>to || !(minCases>=20) || (limit!=='ALL'&&![20,50,100,200].includes(Number(limit)))) throw Error('Choose a valid date range and sample settings.');
  const candidates=days.filter(d=>d.date>=from&&d.date<=to).sort((a,b)=>a.date.localeCompare(b.date));
  const sets=WINDOWS.map(([minute,end])=>deriveRows(days,timeline,minute,end));
  const output=[];
  for(let i=0;i<candidates.length;i++) {
    for(let j=0;j<WINDOWS.length;j++){const [minute,end]=WINDOWS[j];output.push(scoreWindow({days,timeline,day:candidates[i],minute,end,rows:sets[j],limit,minCases,includeBehavior}));}
    if(i%20===0){onProgress(i+1,candidates.length);await new Promise(resolve=>setTimeout(resolve,0));}
  }
  onProgress(candidates.length,candidates.length);
  return output;
}

export function replaySummary(rows) {
  return WINDOWS.map(([m,e])=>{const window=clockLabel(m)+'-'+clockLabel(e), scored=rows.filter(r=>r.window===window&&r.status==='scored');return {window,n:scored.length,upMAE:mean(scored.map(r=>r.upAbsoluteError)),downMAE:mean(scored.map(r=>r.downAbsoluteError)),baselineUpMAE:mean(scored.map(r=>r.baselineUpAbsoluteError)),baselineDownMAE:mean(scored.map(r=>r.baselineDownAbsoluteError)),upMAEAVR:mean(scored.map(r=>Math.abs(r.upErrorAVR))),downMAEAVR:mean(scored.map(r=>Math.abs(r.downErrorAVR)))};});
}

export function csv(rows) {
  const keys=[...new Set(rows.flatMap(Object.keys))], cell=x=>'"'+String(typeof x==='number'?Number(x.toFixed(6)):x??'').replace(/^[=+@]/,"'").replaceAll('"','""')+'"';
  return [keys.map(cell).join(','),...rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\r\n');
}
