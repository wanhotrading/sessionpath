export const EPS=1e-9;
export const WINDOWS={three:[180,300],five:[300,510],nyOwnWide:[510,960],nyOwnExact:[510,960],nyPriorWide:[510,960],nyPriorExact:[510,960]};
const idx=m=>(m+270)/5,good=b=>b&&[b.open,b.high,b.low,b.close].every(Number.isFinite)&&b.high>=b.low&&b.open>=b.low-EPS&&b.open<=b.high+EPS&&b.close>=b.low-EPS&&b.close<=b.high+EPS;
export function windowObservation(day,start,end){
 if(!(day.avr>0))return null;
 const past=day.bars.slice(0,idx(start)),future=day.bars.slice(idx(start),idx(end)),open=day.bars[idx(start)]?.open;
 if(past.length!==idx(start)||!past.every(good)||future.length!==(end-start)/5||!future.every(good)||!Number.isFinite(open))return null;
 const H=Math.max(open,...past.map(b=>b.high)),L=Math.min(open,...past.map(b=>b.low)),h=Math.max(...future.map(b=>b.high)),l=Math.min(...future.map(b=>b.low));
 return {date:day.date,contract:day.contract,avr:day.avr,start,end,open,H,L,h,l,printed:(H-L)/day.avr,eU:Math.max(0,h-H)/day.avr,eD:Math.max(0,L-l)/day.avr,nextU:Math.max(0,h-open)/day.avr,nextD:Math.max(0,open-l)/day.avr,future};
}
export function fitOrange(current,history){
 if(!history.length)return null;
 if(history.some(r=>!r||r.date>=current.date||r.start!==current.start||r.end!==current.end))throw Error('Orange fit requires complete earlier rows from the same window');
 const average=k=>history.reduce((s,r)=>s+r[k],0)/history.length;
 // Production exports point distances and cutoff extrema to six decimals.
 const six=n=>Number(n.toFixed(6)),up=six(average('eU')*current.avr),down=six(average('eD')*current.avr),H=six(current.H),L=six(current.L);
 return {n:history.length,H,L,up,down,upper:H+up,lower:L-down};
}
export function scoreOrange(current,box){
 const visible=box.up>0&&box.down>0;
 const at=predicate=>{const i=current.future.findIndex(predicate);return i<0?null:current.start+i*5;};
 const touchU=at(b=>b.high>=box.upper-EPS),touchD=at(b=>b.low<=box.lower+EPS),exceedU=at(b=>b.high>box.upper+EPS),exceedD=at(b=>b.low<box.lower-EPS);
 const order=(u,d)=>u==null||d==null?'NOT BOTH':u===d?'SAME BAR':u<d?'U THEN D':'D THEN U';
 return {visible,touchU,touchD,exceedU,exceedD,bothTouch:visible?touchU!=null&&touchD!=null:null,bothExceed:visible?exceedU!=null&&exceedD!=null:null,newU:current.h>current.H+EPS,newD:current.l<current.L-EPS,touchOrder:visible?order(touchU,touchD):'NO TWO BOXES',exceedOrder:visible?order(exceedU,exceedD):'NO TWO BOXES',upUsage:box.up>0?Math.max(0,current.h-box.H)/box.up:null,downUsage:box.down>0?Math.max(0,box.L-current.l)/box.down:null};
}
export function rate(k,n){if(!n)return {k,n,p:null,lo:null,hi:null};const p=k/n,z=1.95996398454,a=1+z*z/n,c=(p+z*z/(2*n))/a,e=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/a;return {k,n,p,lo:Math.max(0,c-e),hi:Math.min(1,c+e)};}
export function summary(rows,min=50){
 const enough=rows.filter(r=>r.n>=min),valid=enough.filter(r=>r.visible),n=valid.length;
 return {forecasts:rows.length,minFit:min,sparse:rows.length-enough.length,zeroWidth:enough.length-n,n,bothTouch:rate(valid.filter(r=>r.bothTouch).length,n),bothExceed:rate(valid.filter(r=>r.bothExceed).length,n),bothNew:rate(valid.filter(r=>r.newU&&r.newD).length,n),upOnly:rate(valid.filter(r=>r.touchU!=null&&r.touchD==null).length,n),downOnly:rate(valid.filter(r=>r.touchD!=null&&r.touchU==null).length,n),neither:rate(valid.filter(r=>r.touchU==null&&r.touchD==null).length,n),sameBar:rate(valid.filter(r=>r.bothTouch&&r.touchOrder==='SAME BAR').length,n),touchWithoutStrict:rate(valid.filter(r=>r.bothTouch&&!r.bothExceed).length,n)};
}
