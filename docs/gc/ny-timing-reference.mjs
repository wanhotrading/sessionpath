// Immutable descriptive historical references. These are not validated conditional forecasts.
export const NY_TIMING_METHODS = Object.freeze(['nyOwnExact','nyOwnWide','nyPriorExact','nyPriorWide']);
export const NY_TIMING_FITS = Object.freeze([50,1]);
export const NY_TIMING_LEVELS = Object.freeze([1.2,1.3,1.4,1.5,1.75,2]);
export const NY_TIMING_SIDES = Object.freeze(['U','D']);
export const NY_TIMING_TYPES = Object.freeze(['WICK_ONLY','CLOSE_OUTSIDE']);
const finite = Number.isFinite;
export function strengthBucket(value) {
  if (!finite(value)) return null;
  const raw = Math.max(0,value)*10, nearest = Math.round(raw);
  return Math.floor(Math.abs(raw-nearest)<1e-10?nearest:raw);
}
export function timingBucket(minute) {
  if (!Number.isInteger(minute)||minute<515||minute>960||minute%5!==0) return null;
  return Math.floor((minute-510)/30);
}
export function referenceKey(methodIndex,fitIndex,sideIndex,typeIndex,bucket) {
  return ((((methodIndex*2+fitIndex)*2+sideIndex)*2+typeIndex)*16+bucket);
}
export function decodeReferenceRow(row,feature,bucket) {
  if (!row) return null;
  const n=row[1],laterN=row[4],inside=row[2],same=row[3],opposite=n-inside-same;
  const medianOvershoot=row[5]<0?null:row[5]/1e6,p75Overshoot=row[6]<0?null:row[6]/1e6;
  return {feature,bucket,n,laterN,eod:{inside,same,opposite},
    eodPct:{inside:100*inside/n,same:100*same/n,opposite:100*opposite/n},
    medianOvershoot,p75Overshoot,
    medianMultiple:medianOvershoot==null?null:1+medianOvershoot,
    p75Multiple:p75Overshoot==null?null:1+p75Overshoot,
    levels:NY_TIMING_LEVELS.map((multiple,i)=>({multiple,hits:row[7+2*i],n:row[8+2*i],pct:row[8+2*i]?100*row[7+2*i]/row[8+2*i]:null}))};
}
export function lookupNYTiming(payload,input={}) {
  const empty=reason=>({timing:null,strength:null,observation:null,reason});
  if (!payload||payload.version!==1||payload.eventKind!=='WICK_FIRST') return empty('Historical reference unavailable.');
  if (input.market&&input.market!==payload.market) return empty('Reference market does not match.');
  const m=NY_TIMING_METHODS.indexOf(input.method),f=NY_TIMING_FITS.indexOf(input.minFit),s=NY_TIMING_SIDES.indexOf(input.side),t=NY_TIMING_TYPES.indexOf(input.type);
  if ([m,f,s,t].some(i=>i<0)) return empty('Choose a named NY method, fit threshold, direction and first-breach type.');
  const tb=timingBucket(input.signalCloseMinute),sb=strengthBucket(input.closeOvershoot);
  if (tb==null||sb==null) return empty('Enter a completed five-minute confirmation from 08:35 through 16:00 and its closing overshoot.');
  if(input.type==='CLOSE_OUTSIDE'&&!(input.closeOvershoot>0)) return empty('A close outside must have a positive closing overshoot.');
  if(input.type==='WICK_ONLY'&&input.closeOvershoot>0) return empty('A wick-only first breach must close inside or on the Mean boundary.');
  const timeKey=referenceKey(m,f,s,t,tb),strengthKey=sb<16?referenceKey(m,f,s,t,sb):null;
  const timing=decodeReferenceRow(payload.timing.find(r=>r[0]===timeKey),'timing',tb);
  const strength=sb<16?decodeReferenceRow(payload.strength.find(r=>r[0]===strengthKey),'strength',sb):null;
  return {timing,strength,observation:{method:input.method,minFit:input.minFit,side:input.side,type:input.type,
    signalCloseMinute:input.signalCloseMinute,timeBlock:510+30*tb,closeOvershoot:input.closeOvershoot,strengthBucket:sb},
    reason:!timing&&!strength?'No historical observations match these separate references.':null};
}
