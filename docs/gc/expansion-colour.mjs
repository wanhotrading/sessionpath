import {bin,finite} from './research-core.mjs';

// Rank the displayed cohort rate against historical cohort rates, weighted by dates.
// A binary daily outcome itself is not a distribution of forecast probabilities.
export function expansionPercentile(rows,{date,cutoff,p03=null,p05=null},value){
 const to={p03:'p05',p05:'p0830',p0830:'p16'}[cutoff];
 if(!to||!finite(value)||value<0||value>1)return null;
 const fields=[cutoff];
 if(cutoff!=='p03'&&p03!==null)fields.push('p03');
 if(cutoff==='p0830'&&p05!==null)fields.push('p05');
 const groups=new Map();
 for(const r of rows){
  if(r.date>=date||!fields.every(f=>finite(r[f])&&r[f]>=0)||!finite(r[to])||r[to]<r[cutoff]-1e-8)continue;
  const key=fields.map(f=>bin(r[f])).join('|'),g=groups.get(key)||{n:0,k:0};
  g.n++;if(r[to]-r[cutoff]>=.25-1e-8)g.k++;groups.set(key,g);
 }
 let below=0,equal=0,total=0;
 for(const g of groups.values()){const p=g.k/g.n;total+=g.n;if(Math.abs(p-value)<1e-9)equal+=g.n;else if(p<value)below+=g.n;}
 return total?{rank:(below+.5*equal)/total,n:total,groups:groups.size}:null;
}
export function percentileColour(rank){
 if(!finite(rank)||rank<0||rank>1)return null;
 if(rank<=.25)return 'low';if(rank>=.75)return 'high';
 if(rank<.4)return 'lower-middle';if(rank>.6)return 'upper-middle';return 'middle';
}
export function tintExpansionPercentile(el,result){
 if(!el)return;
 el.removeAttribute('data-relative');el.removeAttribute('data-polarity');el.removeAttribute('data-expansion-percentile');
 const colour=percentileColour(result?.rank);if(!colour){el.title='Historical probability rank unavailable.';return;}
 el.dataset.expansionPercentile=colour;
 el.title=`${(result.rank*100).toFixed(1)}th percentile of historical Add ≥25 pp probabilities. Same market, window and year filter; dates before the selected date. ${result.groups} printed-AVR cohorts, weighted by ${result.n} dates; ties count half. Purple ≤25th; white 40th–60th; orange ≥75th. Colour changes only; the probability is unchanged.`;
}
