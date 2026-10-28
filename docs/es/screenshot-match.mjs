import {deriveRows} from './window-engine.mjs';
import {buildNYRows,nySummary} from './ny-reference-v5.mjs';
import {bin,bins} from './research-core.mjs';

export function matchScreenshotRows(rows,{printed=null,bbox='any',date,year=''}={}) {
 return rows.filter(({day,row})=>day.date<date&&(!year||String(day.year)===String(year))
  &&(printed===null||bin(row.rangeAvr)===bin(printed))
  &&(bbox==='any'||Number.isFinite(row.bboxPosition)&&(bbox==='outside'?(row.bboxPosition<0||row.bboxPosition>1):(row.bboxPosition>=0&&row.bboxPosition<=1))));
}
export function mountScreenshotMatching(dialog,research,refresh){
 const $=id=>document.getElementById(id),value=id=>$(id)?.value||'',num=id=>value(id)===''?null:Number(value(id));
 const panel=document.createElement('section');panel.className='review-match-panel';
 panel.innerHTML=`<div class="review-controls"><label>Historical filters<select id="review-match-window"><option value="">All screenshot dates</option><option value="180">03:00–05:00</option><option value="300">05:00–08:30</option><option value="510">08:30–16:00 · NY outlook</option></select></label><label id="review-match-bbox-label">Close vs prior NY BBOX at cutoff<select id="review-match-bbox"><option value="">Choose inside or outside</option><option value="inside">Inside BBOX (including edge)</option><option value="outside">Outside BBOX · either side</option></select></label><button type="button" class="quiet" id="review-match-sync">Read current panel inputs</button></div><p id="review-match-summary" role="status" class="compact-note">Choose a session to view matching historical days.</p>`;
 dialog.querySelector('.review-controls').after(panel);
 const cache=new Map();let daysRef=null,timelineRef=null;
 function printed(prefix){const h=num(prefix+'range-high'),l=num(prefix+'range-low'),a=num(prefix+'avr');if(h!==null||l!==null){if(!(h!==null&&l!==null&&h>=l&&a>0))throw Error('Enter both high/low and a positive AVR in the source panel.');return (h-l)/a;}const n=num(prefix+'printed');if(n!==null&&(!Number.isFinite(n)||n<0))throw Error('Enter a valid printed AVR percentage.');return n===null?null:n/100;}
 function filter(items){
  const minute=Number(value('review-match-window'));$('review-match-bbox-label').hidden=!minute||minute===510;
  if(!minute){$('review-match-summary').textContent='All screenshot dates. Select a session to inherit its filters.';return items;}
  try{
   if(!research.ready)throw Error('Research data is still loading. Select Read current panel inputs when ready.');
   const date=value('trading-date');if(!date)throw Error('Select a trading date first.');
   if(daysRef!==research.days||timelineRef!==research.timeline){cache.clear();daysRef=research.days;timelineRef=research.timeline;}
   let cohort,pr,description;
   if(minute===510){
    const basis=value('ny-basis')||'bbox',end=Number(value('ny-end')||960),key='ny'+basis+end;
    if(!cache.has(key))cache.set(key,buildNYRows(research.days,research.timeline,end,basis));
    const filters={year:value('ny-year'),asiaShape:value('ny-asia-shape'),londonShape:value('ny-london-shape')};
    for(const s of ['asia','london'])filters[s]=[...document.querySelectorAll(`[data-ny-session="${s}"]:checked`)].map(x=>x.value);
    pr=printed('ny-');cohort=matchScreenshotRows(nySummary(cache.get(key),filters).cohort,{date,printed:pr});
    description=`NY outlook · ${basis==='own'?'Own range':'Prior NY BBOX'} · Asia ${filters.asia.join('/')||'any'} / London ${filters.london.join('/')||'any'} · shapes ${filters.asiaShape||'any'} / ${filters.londonShape||'any'} · ${filters.year||'all years'} · through ${end===960?'16:00':'10:30'}`;
   }else{
    if(value('asof')!==(minute===180?'03:00':'05:00'))throw Error('Switch the main forecast to '+(minute===180?'03:00':'05:00')+' first, so its AVR inputs match this cutoff.');
    const bbox=value('review-match-bbox');if(!bbox)throw Error('Choose inside or outside BBOX explicitly.');
    pr=printed('');if(pr===null)throw Error('Enter printed % AVR, or high/low and AVR, in the session inputs.');
    const key='cutoff'+minute;if(!cache.has(key)){const byID=new Map(research.days.map(d=>[d.index,d]));cache.set(key,deriveRows(research.days,research.timeline,minute,minute).map(row=>({row,day:byID.get(row.dayIndex)})));}
    cohort=matchScreenshotRows(cache.get(key),{date,printed:pr,bbox,year:value('year')});description=(minute===180?'03:00':'05:00')+' completed close · '+bbox+' BBOX · '+(value('year')||'all years');
   }
   const dates=new Set(cohort.map(x=>x.day.date)),result=items.filter(x=>dates.has(x.date));
   const available=new Set(result.map(x=>x.date));
   $('review-match-summary').textContent=`${description} · AVR ${pr===null?'not filtered':bins[bin(pr)]} · before ${date}. ${dates.size} matching days; ${available.size} have screenshots in this source (${result.length} images). ${dates.size-available.size} matching days have no screenshot here.`;
   return result;
  }catch(e){$('review-match-summary').textContent=e.message;return [];}
 }
 for(const id of ['review-match-window','review-match-bbox'])$(id).addEventListener('change',()=>refresh());
 $('review-match-sync').onclick=()=>refresh();
 return filter;
}
