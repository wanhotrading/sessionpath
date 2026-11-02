export const clockMinute = value => { const [h,m]=value.split(':').map(Number); const n=h*60+m; return n>=1170?n-1440:n; };
export const clockLabel = n => { const m=((n%1440)+1440)%1440; return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`; };
export const bucket = q => q<0?'BELOW':q<.25?'Q1':q<.5?'Q2':q<.75?'Q3':q<=1?'Q4':'ABOVE';
export function quantile(values,p){if(!values.length)return null;const a=[...values].sort((x,y)=>x-y),i=(a.length-1)*p,l=Math.floor(i);return a[l]+(a[Math.ceil(i)]-a[l])*(i-l);}
export function hasTags(day,tags,mode,minute,library=false){if(!tags.length)return true;const set=new Set(library?day.tags:day.knownTags.filter(t=>Number.isFinite(t.minute)&&t.minute<=minute).map(t=>t.tag));return mode==='any'?tags.some(t=>set.has(t)):tags.every(t=>set.has(t));}
export function selectMatches(days,rows,query,pastRows=[]){
 const past=new Map(pastRows.map(row=>[row[0],row]));
 const fields=[['printed',1,.25],['up',2,.25],['down',3,.25],['q',4,.25]].filter(([k])=>query[k]!=null);
 const pool=[];
 for(const row of rows){const d=days[row[0]];if(!d||query.year&&!d.date.startsWith(query.year)||!hasTags(d,query.tags,query.tagMode,query.minute))continue;
  if(query.location&&bucket(row[4])!==query.location)continue;
  if(query.behavior&&(!past.has(row[0])||pathClass(past.get(row[0])[7])!==query.behavior))continue;
  if(fields.some(([,i])=>!Number.isFinite(row[i])))continue;
  const distance=fields.length?fields.reduce((sum,[key,index,scale])=>sum+Math.abs(row[index]-query[key])/scale,0)/fields.length:0;
  pool.push({day:d,row,distance});
 }
 pool.sort((a,b)=>a.distance-b.distance||b.day.date.localeCompare(a.day.date));
 return {pool,matches:fields.length?pool.slice(0,query.limit):pool,numericCount:fields.length};
}
// Mutually exclusive close-path labels. These are new one-hour descriptors, not workbook session tags.
export function pathClass(path){
 const p=[0,...path],end=p.at(-1),lo=Math.min(...p),hi=Math.max(...p),li=p.indexOf(lo),hiIndex=p.indexOf(hi);
 const dip=lo<=-.08&&end-lo>=.08&&li<12,fade=hi>=.08&&hi-end>=.08&&hiIndex<12;
 if(dip&&fade)return li<hiIndex?'Rally then fade':'Dip then recovery';
 if(dip)return 'Dip then recovery';if(fade)return 'Rally then fade';
 if(end>=.05)return 'Higher finish';if(end<=-.05)return 'Lower finish';return 'Little net change';
}
export function summarize(matches){
 const n=matches.length;if(!n)return null;
 const categories=['Higher finish','Lower finish','Dip then recovery','Rally then fade','Little net change'];
 const groups=categories.map(label=>({label,count:matches.filter(m=>pathClass(m.row[7])===label).length})).sort((a,b)=>b.count-a.count);
 const endpoints=matches.map(m=>m.row[7].at(-1));
 return {n,groups,median:quantile(endpoints,.5),low:quantile(endpoints,.25),high:quantile(endpoints,.75),up:quantile(matches.map(m=>m.row[8]),.5),down:quantile(matches.map(m=>m.row[9]),.5),points:Array.from({length:13},(_,i)=>{const a=i?matches.map(m=>m.row[7][i-1]):[0];return [quantile(a,.1),quantile(a,.25),quantile(a,.5),quantile(a,.75),quantile(a,.9)];}),years:Object.fromEntries(['2022','2023','2024','2025','2026'].map(y=>[y,matches.filter(m=>m.day.date.startsWith(y)).length]))};
}
export function wilson(k,n){if(!n)return [0,1];const z=1.96,p=k/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return [Math.max(0,c-h),Math.min(1,c+h)];}
