export const bins=['0–<25%','25–<50%','50–<75%','75–<100%','100%+'];
export const finite=x=>typeof x==='number'&&Number.isFinite(x);
export const inputNumber=x=>String(x??'').trim()===''?null:Number.isFinite(Number(x))?Number(x):null;
export const bin=x=>!finite(x)||x<0?null:Math.min(4,Math.floor((x+1e-9)/.25));
export function rate(k,n){if(!n)return {n:0,k:0,p:null,lo:null,hi:null};const z=1.95996398454,p=k/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return {n,k,p,lo:Math.max(0,c-h),hi:Math.min(1,c+h)};}
export function quantile(v,p){if(!v.length)return null;const a=[...v].sort((a,b)=>a-b),i=(a.length-1)*p,j=Math.floor(i);return a[j]+(a[Math.min(j+1,a.length-1)]-a[j])*(i-j);}
export const average=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
export const past=(rows,date)=>rows.filter(r=>r.date<date);
export function regime(rows,{date,cutoff,printed,avr,p03=null,p05=null,target=.75}){
 const to={p03:'p05',p05:'p0830',p0830:'p16'}[cutoff];
 if(!to||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!finite(printed)||printed<0||!finite(avr)||avr<=0)throw Error('Enter a date, a positive frozen AVR and a non-negative printed percentage.');
 if([p03,p05].some(v=>v!==null&&(!finite(v)||v<0)))throw Error('Earlier printed ranges must be non-negative.');
 if(cutoff==='p05'&&p03!==null&&p03>printed+1e-8||cutoff==='p0830'&&(p05!==null&&p05>printed+1e-8||p03!==null&&p03>printed+1e-8||p03!==null&&p05!==null&&p03>p05+1e-8))throw Error('Cumulative range cannot shrink: 03:00 ≤ 05:00 ≤ 08:30.');
 const known=past(rows,date).filter(r=>finite(r[cutoff]));
 const eligible=known.filter(r=>finite(r[to])&&r[to]>=r[cutoff]-1e-8);
 const matched=eligible.filter(r=>bin(r[cutoff])===bin(printed)&&(cutoff==='p03'||p03===null||finite(r.p03)&&bin(r.p03)===bin(p03))&&(cutoff!=='p0830'||p05===null||finite(r.p05)&&bin(r.p05)===bin(p05)));
 const expansion=matched.map(r=>Math.max(0,r[to]-r[cutoff])),reach=matched.filter(r=>r[cutoff]<target-1e-8);
 return {n:matched.length,total:eligible.length,bin:bins[bin(printed)],to,percentile:known.length?known.filter(r=>r[cutoff]<=printed+1e-8).length/known.length:null,mean:average(expansion),median:quantile(expansion,.5),p25:quantile(expansion,.25),p75:quantile(expansion,.75),zero:rate(expansion.filter(x=>x<=1e-8).length,matched.length),extra25:rate(expansion.filter(x=>x>=.25-1e-8).length,matched.length),target:rate(reach.filter(r=>r[to]>=target-1e-8).length,reach.length),already:printed>=target-1e-8,meanFinal:average(matched.map(r=>r[to])),matched};
}
export function outcome({breach,lower,upper,final},buffer=.1){if(!(upper>lower)||!finite(final))return null;if(!breach)return 'A';const outside=Math.max(0,final-upper,lower-final);return outside<=1e-8?'B':outside<=(upper-lower)*buffer+1e-8?'C':'D';}
