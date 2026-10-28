export const UTIL_BANDS=['0–<25%','25–<50%','50–<75%','75–<100%','100%+'];
export const NY_METHODS=['nyOwnWide','nyOwnExact','nyPriorWide','nyPriorExact'];
export const METHOD_LABELS={nyOwnWide:'Own Wide',nyOwnExact:'Own Exact',nyPriorWide:'Prior Wide',nyPriorExact:'Prior Exact'};
export function usageBand(x){if(!Number.isFinite(x)||x<0)return null;return x<.25-1e-10?0:x<.5-1e-10?1:x<.75-1e-10?2:x<1-1e-10?3:4;}
export function dominantUsage(up,down){if(![up,down].every(Number.isFinite)||up<0||down<0)return null;return Math.abs(up-down)<=1e-10*Math.max(1,up,down)?'TIE':up>down?'U':'D';}
export function utilization({actualUp,actualDown,forecastUp,forecastDown}){
 if(![actualUp,actualDown,forecastUp,forecastDown].every(Number.isFinite)||actualUp<0||actualDown<0||forecastUp<=0||forecastDown<=0)return null;
 const up=actualUp/forecastUp,down=actualDown/forecastDown;
 return {up,down,upBand:usageBand(up),downBand:usageBand(down),tilt:dominantUsage(up,down)};
}
export function proportion(k,n){if(!n)return {k,n,p:null,lo:null,hi:null};const z=1.95996398454,p=k/n,a=1+z*z/n,c=(p+z*z/(2*n))/a,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/a;return {k,n,p,lo:k===0?0:Math.max(0,c-h),hi:k===n?1:Math.min(1,c+h)};}
const average=xs=>xs.length?xs.reduce((s,x)=>s+x,0)/xs.length:null;
export function summarizeDirection(rows,window='ny',method='nyOwnWide'){
 const metric=r=>window==='ny'?r.ny?.[method]:r[window],rs=rows.filter(r=>metric(r));
 return {n:rs.length,U:proportion(rs.filter(r=>metric(r).tilt==='U').length,rs.length),D:proportion(rs.filter(r=>metric(r).tilt==='D').length,rs.length),tie:proportion(rs.filter(r=>metric(r).tilt==='TIE').length,rs.length),meanUp:average(rs.map(r=>metric(r).up)),meanDown:average(rs.map(r=>metric(r).down)),finalUp:proportion(rs.filter(r=>metric(r).finalDirection==='U').length,rs.length),thin:rs.filter(r=>r.three?.cases<50||r.five?.cases<50||metric(r).cases<50).length};
}
export function selectUtilizationRows(rows,{date,year='',method='nyOwnWide',bands=[],directions=[],minimumCases=0}={}){
 if(!NY_METHODS.includes(method))throw Error('Choose a supported NY forecast method.');
 const base=rows.filter(r=>(!date||r.date<date)&&(!year||r.year===String(year))&&r.three&&r.five&&r.ny?.[method]&&[r.three,r.five,r.ny[method]].every(w=>w.cases>=minimumCases));
 const matched=base.filter(r=>[r.three.upBand,r.three.downBand,r.five.upBand,r.five.downBand].every((b,i)=>bands[i]==null||b===Number(bands[i]))&&[r.three.tilt,r.five.tilt].every((d,i)=>!directions[i]||d===directions[i]));
 return {base,matched,baseline:summarizeDirection(base,'ny',method),selected:summarizeDirection(matched,'ny',method)};
}
