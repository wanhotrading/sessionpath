import {loadAsset,yieldToBrowser} from './startup-load.mjs';
import {probabilityMarkup as raised} from './probability-finish.mjs';
import {flashCopyStatus} from './copy-feedback.mjs';
import {instrument,dataPath,storageKey as marketStorageKey,mountInstrumentSelector,restoreMarketInputs} from './instrument.mjs?v=coin-cover-20261023';
import {setupDeviceView} from './device-view.mjs';
import {mountBBoxReturn,renderBBoxReturn} from './bbox-return.mjs?v=three-states-20261023';
import {mountForecastContext,renderForecastContext,clearForecastContext} from './forecast-context.mjs';
import {mountLocalImporter} from './local-import-ui.mjs';
import {mountScreenshotReview} from './screenshot-review.mjs?v=matched-days-20261023';
import {renderOutlook,renderComparison,mountDictionary,mountValidation} from './dashboard-v7.mjs';
import {setupWorkspace,mountReader} from './workspace-v7.mjs?v=tools-slide-20261022';
import {mountReplayTools} from './replay-tools.mjs';
import {mountNYReference,fillNYPositionHelper} from './ny-reference-v5.mjs';
import {observedUD,makeForecastCode,makeChartPine} from './indicator-v5.mjs';
import {sessions,shapes,shapeName,enrichResearch,sessionProbabilities,boxEstimate,makePine} from './planner-v3.mjs';
import {clockMinute,clockLabel,bucket,hasTags,deriveRows,selectMatches,summarize,rangeContext,pathClass,quantile} from './window-engine.mjs';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number.isFinite(v)?v.toFixed(2):'—',pct=v=>Number.isFinite(v)?`${Math.round(v*100)}%`:'—',pt=v=>Number.isFinite(v)?`${v.toFixed(2)} pt`:'Add AVR';
setupWorkspace();mountInstrumentSelector();setupDeviceView();
const windows={'1930-0500':[-270,300],'1930-0830':[-270,510]};
const fields=['open1930','ud-units','window','asof','trading-date','price','avr','printed','range-high','range-low','range-position','prior-high','prior-low','location','up','down','behavior','tag-mode','sample-size','year'];
const state={sessionChoices:{},box:null,pine:null,days:[],tags:[],timeline:[],galleryIndex:{},selected:new Set(),checkpoints:[],ready:false,library:false,query:null,matches:[],pool:[],summary:null,page:0,viewer:0,request:0,rowCache:new Map()};
mountScreenshotReview(state);
mountForecastContext();mountBBoxReturn();
const returnDetails=document.createElement('details');returnDetails.id='bbox-return-details';returnDetails.className='session-note bbox-return-details';returnDetails.innerHTML='<summary>Closed outside BBOX? Check % of return</summary>';
$('projection').querySelector('.forecast-main').append(returnDetails);returnDetails.append($('bbox-return'));
returnDetails.addEventListener('toggle',()=>{if(returnDetails.open)renderBBoxReturn();});
const storageKey=marketStorageKey('session-path-checkpoints-v2');
const val=id=>$(id).value===''?null:Number($(id).value);
const friendly=t=>String(t).replace(/RALLY_FADE/g,'TREND UP → FADE').replace(/DROP_RECOVERY/g,'TREND DOWN → RECOVER');
const shape=s=>s;
const engineShape=s=>({'Trending up':'Higher finish','Trending down':'Lower finish'}[s]||s);
const getJSON=url=>loadAsset(url);
function toast(text){$('toast').textContent=text;$('toast').style.display='block';setTimeout(()=>$('toast').style.display='none',3300);}
function selectedWindow(){return windows[$('window').value]||windows['1930-0500'];}
function syncInputs(){ $('window').value=$('asof').value==='05:00'?'1930-0830':'1930-0500';const rh=val('range-high'),rl=val('range-low'),price=val('price'),avr=val('avr'),rangeValid=rh!=null&&rl!=null&&rh>rl;
 const unit=$('ud-units').value,opening=val('open1930'),automatic=opening!=null&&rangeValid;
 $('up-label').textContent='Up from 19:30 · '+(unit==='points'?'points':'% AVR');$('down-label').textContent='Down from 19:30 · '+(unit==='points'?'points':'% AVR');
 for(const id of ['up','down'])$(id).disabled=automatic;
 if(automatic){const scale=unit==='points'?1:avr>0?100/avr:null;$('up').value=scale==null?'':((rh-opening)*scale).toFixed(3);$('down').value=scale==null?'':((opening-rl)*scale).toFixed(3);}
 $('ud-help').textContent=automatic?'Current U/D are calculated from the 19:30 open and running extremes. These are observed excursions, not forecasts.':'Enter the U/D points shown by TradingView, or add the 19:30 open plus running high/low to calculate them here.';
 $('printed').disabled=rangeValid&&avr>0;if($('printed').disabled)$('printed').value=((rh-rl)/avr*100).toFixed(1);
 $('range-position').disabled=rangeValid&&price!=null;
 if(rangeValid&&price!=null){$('range-help').textContent=`Current range ${num(rh-rl)} points. Price is ${pct((price-rl)/(rh-rl))} of the way from low to high; the exact position is used in matching.`;}else $('range-help').textContent='High and low calculate printed AVR and exact range position. Otherwise enter the percentage and choose a position.';
 const ph=val('prior-high'),pl=val('prior-low'),priorValid=ph!=null&&pl!=null&&ph>pl&&price!=null;
 $('location').disabled=priorValid;if(priorValid)$('location').value=bucket((price-pl)/(ph-pl));
 const [start,end]=selectedWindow();const m=clockMinute($('asof').value);
 $('window-help').textContent=`Context starts at 19:30. Forecast starts at ${clockLabel(m)} and ends at ${clockLabel(end)}. ${m>=start&&m<=end?`${end-m} minute outlook.`:''}`;
 previousUdUnits=$('ud-units').value;
}
function readQuery(){const [start,end]=selectedWindow(),raw=clockMinute($('asof').value),minute=Math.floor(raw/5)*5;
 if(![start,end,minute].every(Number.isFinite)||start< -270||end>960||end<=start)throw new Error('Choose a window within previous-evening 19:30 through 16:00, with the end after the start.');
 
 if(minute<start||minute>end)throw new Error(`The as-of time must be between previous-evening 19:30 and ${clockLabel(end)}. Choose the 08:30 plan to continue after 05:00.`);
 const price=val('price'),avr=val('avr'),rh=val('range-high'),rl=val('range-low'),ph=val('prior-high'),pl=val('prior-low');
 if((rh==null)!==(rl==null))throw new Error('Enter both current high and low, or leave both blank and use printed AVR plus range position.');
 if(avr!=null&&(!(avr>0)||!Number.isFinite(avr)))throw new Error('Enter a positive AVR in price points.');
 if(price!=null&&!Number.isFinite(price))throw new Error('Enter a valid current price.');
 if(rh!=null&&rl!=null&&rh<=rl)throw new Error('Current high must be above current low.');
 if(rh!=null&&rl!=null&&price!=null&&(price<rl-.001||price>rh+.001))throw new Error('Current price is outside the high/low you entered. Update the current range.');
 if(ph!=null&&pl!=null&&ph<=pl)throw new Error('Prior NY high must be above prior NY low.');
 for(const id of ['printed'])if(val(id)!=null&&(!Number.isFinite(val(id))||val(id)<0||val(id)>2000))throw new Error('AVR percentages must be between 0 and 2,000.');
 let printed=val('printed')==null?null:val('printed')/100;if(rh!=null&&rl!=null&&avr>0)printed=(rh-rl)/avr;
 const {up,down}=observedUD({open:val('open1930'),high:rh,low:rl,avr,up:val('up'),down:val('down'),units:$('ud-units').value});
 if(printed!=null&&up!=null&&down!=null&&Math.abs(up+down-printed)>.03)throw new Error('Up plus down from the 19:30 open should equal the total printed range. Check those inputs.');
 const rangePosition=rh!=null&&rl!=null&&price!=null?(price-rl)/(rh-rl):val('range-position');
 if(printed===0&&rangePosition!=null)throw new Error('With zero range printed, choose “Any / unknown” for position inside the current range.');
 const q=ph!=null&&pl!=null&&price!=null?(price-pl)/(ph-pl):null;
 const date=$('trading-date').value;if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Choose the trading date.');
 const observations=$('use-checkpoints').checked?state.checkpoints.filter(c=>c.date===date&&c.minute<minute).sort((a,b)=>a.minute-b.minute).slice(-8).map(c=>c.condition):[];
 return {startMinute:start,endMinute:end,minute,raw,date,beforeDate:date,price,avr,printed,up,down,rangePosition,q,rangeHigh:rh,rangeLow:rl,open1930:val('open1930'),location:q!=null?bucket(q):$('location').value,behavior:engineShape($('behavior').value),tags:[...state.selected],tagMode:$('tag-mode').value,limit:$('sample-size').value==='ALL'?'ALL':Number($('sample-size').value),year:$('year').value,observations};
}
function renderTags(){if(!state.ready)return;const focus=document.activeElement?.id;const minute=Math.floor(clockMinute($('asof').value)/5)*5,search=$('tag-search').value.toLowerCase().trim();
 const groups=new Map();for(const tag of state.tags){if(!state.library&&(tag.earliestMinute==null||tag.earliestMinute>minute))continue;if(search&&!`${tag.id} ${friendly(tag.id)} ${tag.definition}`.toLowerCase().includes(search))continue;if(!groups.has(tag.group))groups.set(tag.group,[]);groups.get(tag.group).push(tag);}
 $('tag-count').textContent=`${state.selected.size} selected`;$('selected-count').textContent=state.selected.size;
 $('selected-tags').innerHTML=[...state.selected].map(id=>`<button type="button" class="chip" data-remove="${esc(id)}" aria-label="Remove ${esc(id)}">${esc(friendly(id))} ×</button>`).join('');
 $('tag-options').innerHTML=[...groups].map(([group,tags])=>`<section class="tag-group"><h3>${esc(group)} · ${tags.length}</h3><div class="checkbox-grid">${tags.map(t=>{const locked=!state.library&&(t.earliestMinute==null||t.earliestMinute>minute),checked=state.selected.has(t.id);return `<label class="tag-choice ${locked?'locked':''} ${checked?'checked':''}" title="${esc(t.id+' — '+t.definition+' Known: '+t.knownWhen)}"><input type="checkbox" id="tag-${esc(t.id)}" data-tag="${esc(t.id)}" aria-label="${esc(t.id)}" ${checked?'checked':''} ${locked?'disabled':''}><span>${esc(t.label||friendly(t.id))}</span>${locked?'<small class="lock">later</small>':''}</label>`;}).join('')}</div></section>`).join('')||'<div class="empty">No tags match this search.</div>';
 if(focus?.startsWith('tag-'))document.getElementById(focus)?.focus({preventScroll:true});
 $('mode-btn').textContent=state.library?'Return to planning':'Browse completed-day tags';$('mode-btn').classList.toggle('active',state.library);
}
function renderCheckpoints(){const date=$('trading-date').value,list=state.checkpoints.filter(c=>c.date===date).sort((a,b)=>a.minute-b.minute);$('checkpoints').innerHTML=list.map(c=>`<div class="checkpoint-item"><button type="button" class="checkpoint" data-checkpoint="${esc(c.key)}" title="Load this saved checkpoint">${clockLabel(c.minute)} · ${c.condition.printed==null?'range unknown':pct(c.condition.printed)+' AVR'}<small>${c.condition.tags.length} tags · ${esc((c.inputs.notes||'Load this checkpoint').slice(0,48))}</small></button><button type="button" class="remove-checkpoint" data-delete-checkpoint="${esc(c.key)}" aria-label="Remove ${clockLabel(c.minute)} checkpoint">×</button></div>`).join('')||'<span class="subtle" style="font-size:13px">No checkpoints saved for this date.</span>';}
function saveCheckpoint(){let q;try{syncInputs();q=readQuery();}catch(e){$('form-error').textContent=e.message;return;}if(state.library){toast('Return to planning before saving a checkpoint.');return;}
 const unavailable=q.tags.filter(id=>{const t=state.tags.find(t=>t.id===id);return !t||t.earliestMinute==null||t.earliestMinute>q.minute;});if(unavailable.length){$('form-error').textContent=`Cannot save: these tags are not known at ${clockLabel(q.minute)}: ${unavailable.map(friendly).join(', ')}.`;return;}if(q.behavior&&q.minute< -210){$('form-error').textContent='A last-hour behavior checkpoint requires 20:30 ET or later.';return;}
 const inputs=Object.fromEntries(fields.map(id=>[id,$(id).value]));const {observations,...condition}=q;const key=`${q.date}:${q.minute}`;
 const estimate=q.price!=null&&q.avr>0?boxEstimate(state.days,state.timeline,q,q.endMinute):null;
 const forecast=estimate?{version:'v8 actual-open',generatedAt:new Date().toISOString(),code:makeForecastCode(estimate,q),upPoints:estimate.upPoints,downPoints:estimate.downPoints,medianUp:estimate.upMedianPoints,medianDown:estimate.downMedianPoints,endMinute:estimate.endMinute,n:estimate.n,matchingDates:estimate.dates,observations:q.observations}:null;
 const checkpoint={key,date:q.date,minute:q.minute,inputs,tags:[...state.selected],sessionChoices:{...state.sessionChoices},condition,forecast};
 state.checkpoints=state.checkpoints.filter(c=>c.key!==key);state.checkpoints.push(checkpoint);state.checkpoints=state.checkpoints.slice(-5000);
 try{localStorage.setItem(storageKey,JSON.stringify(state.checkpoints));toast(`Saved ${clockLabel(q.minute)} checkpoint on this browser.`);}catch{toast('Checkpoint saved for this page only; browser storage is unavailable.');}
 renderCheckpoints();analyze();
}
function loadCheckpoint(key){const c=state.checkpoints.find(c=>c.key===key);if(!c)return;$('open1930').value='';for(const [id,value] of Object.entries(c.inputs))if($(id))$(id).value=value;state.selected=new Set(c.tags);state.sessionChoices={...(c.sessionChoices||{})};state.library=false;$('asof').value=c.minute===300?'05:00':'03:00';$('trading-date').value=c.date;$('replay-date').value=c.date;$('replay-toggle').checked=c.date!==new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});syncDate();syncInputs();renderCheckpoints();analyze();document.getElementById('conditions').scrollIntoView({behavior:'smooth'});}

function applyReplaySnapshot(data,{includeBehavior=false}={}){
 state.library=false;state.selected.clear();state.sessionChoices={};$('sequence-explore').checked=false;$('use-checkpoints').checked=false;
 for(const id of ['price','avr','open1930','range-high','range-low','prior-high','prior-low','printed','up','down','range-position','location','behavior'])$(id).value='';
 $('replay-toggle').checked=true;$('replay-date').value=data.date;syncDate();
 $('ud-units').value='points';$('year').value='';
 for(const id of ['ny-range-high','ny-range-low','ny-printed','ny-strength-three','ny-strength-five'])if($(id))$(id).value='';
 if(data.minute===510){$('ny-price').value=data.price;$('ny-avr').value=data.avr;$('ny-range-high').value=data.rangeHigh;$('ny-range-low').value=data.rangeLow;}
 else{
  $('asof').value=data.minute===300?'05:00':'03:00';
  for(const [id,key]of [['price','price'],['avr','avr'],['open1930','open1930'],['range-high','rangeHigh'],['range-low','rangeLow'],['prior-high','priorHigh'],['prior-low','priorLow']])$(id).value=data[key];
  $('behavior').value=includeBehavior?data.behavior:'';$('ny-price').value='';$('ny-avr').value='';
 }
 for(const input of document.querySelectorAll('[data-ny-session]'))input.checked=false;
 for(const id of ['ny-year','ny-asia-shape','ny-london-shape'])$(id).value='';
 if(instrument.id==='NQ'&&data.minute===510){const day=state.days.find(d=>d.date===data.date&&d.contract===data.contract.replace(/^.*:/,''));if(day)fillNYPositionHelper(day,state.timeline,510);}
 $('trading-date').dispatchEvent(new Event('change'));$('asof').dispatchEvent(new Event('change'));
 syncInputs();renderCheckpoints();analyze();
}
function resultHeader(q,selection){const n=selection.matches.length;const label=state.library?'HISTORICAL BROWSER':n<20?'SMALL SAMPLE':selection.numericCount||q.tags.length||q.behavior?'MATCHED CONTEXT':'CLOCK-TIME BASELINE';
 $('result-header').innerHTML=`<div class="result-head"><div><div class="eyebrow">${state.library?'COMPLETED DAYS · ALL TAGS AVAILABLE':'Forecasting'}</div><h2>${state.library?'Explore the full-day evidence':`${clockLabel(q.minute)} → ${clockLabel(q.endMinute)} ET`}</h2><p>${n.toLocaleString()} ${selection.numericCount?'closest cases':'historical cases'}${selection.numericCount?` from ${selection.pool.length.toLocaleString()} eligible days`:''}${selection.observationCount?` · ${selection.observationCount} earlier checkpoint${selection.observationCount===1?'':'s'} included`:''}${q.raw!==q.minute?` · using completed bars as of ${clockLabel(q.minute)}`:''}</p></div><span class="status-pill ${state.library||n<20?'amber':''}">${label}</span></div>`;
}
function metricCard(title,m,color,description){return `<div class="metric"><div class="metric-title">${title}</div><div class="metric-value ${color}">${m.meanPoints==null?'—':num(m.meanPoints)} <small>points</small></div><div class="metric-sub">${description}<br>Median <b>${pt(m.medianPoints)}</b> · middle 50% <b>${num(m.p25Points)}–${num(m.p75Points)}</b></div></div>`;}
function renderProjection(q,selection){renderForecastContext($('forecast-context'),q);resultHeader(q,selection);state.summary=renderOutlook(q,selection);renderComparison(state);}
function eligibleTags(day,q){return state.library?day.tags:day.knownTags.filter(t=>Number.isFinite(t.minute)&&t.minute<=q.minute).map(t=>t.tag);}
function renderGallery(){const size=Number($('gallery-size').value),total=state.matches.length,pages=Math.max(1,Math.ceil(total/size));state.page=Math.min(state.page,pages-1);const start=state.page*size,items=state.matches.slice(start,start+size);
 let coverage=$('gallery-coverage');
 if(!coverage){
  coverage=document.createElement('div');coverage.id='gallery-coverage';coverage.className='compact-note';coverage.setAttribute('role','status');
  const text=document.createElement('p');text.id='gallery-coverage-text';
  const browse=document.createElement('button');browse.id='gallery-browse-uploaded';browse.type='button';browse.className='quiet';browse.textContent='Browse uploaded screenshots';
  browse.onclick=()=>{const source=$('review-source');if(source)source.value='archive';if($('review-search'))$('review-search').value='';if($('review-filter'))$('review-filter').value='';$('open-screenshot-review')?.click();};
  coverage.append(text,browse);$('gallery').before(coverage);
 }
 const available=state.matches.filter(({day})=>Boolean(state.galleryIndex[day.index]?.src)).length,pending=total-available;
 $('gallery-coverage-text').textContent=`${available.toLocaleString()} of ${total.toLocaleString()} matched dates have uploaded screenshots.${pending?` Screenshots for the other ${pending.toLocaleString()} dates have not been uploaded yet.`:''}`;
 $('gallery-browse-uploaded').hidden=!Object.values(state.galleryIndex).some(asset=>asset?.src);
 coverage.hidden=!total;
 $('gallery-page').textContent=total?`${start+1}–${Math.min(total,start+size)} / ${total}`:'0 matches';$('gallery-prev').disabled=state.page===0;$('gallery-next').disabled=state.page>=pages-1;
 $('gallery').innerHTML=items.map((m,j)=>{const {day:d,row}=m,img=state.galleryIndex[d.index],visible=eligibleTags(d,state.query),tagList=[...new Set([...state.selected].filter(t=>visible.includes(t)).concat(visible))].slice(0,3);
 const moves=row?`Upside ${pt(row.nextHighAvr*(state.query.avr||d.avr))} · downside ${pt(-row.nextLowAvr*(state.query.avr||d.avr))} · extra range ${pt(row.additionalRangeAvr*(state.query.avr||d.avr))}`:'';
 return `<article class="chart-card"><header><b>${esc(d.date)}</b><span>${esc(d.contract)}${row?` · ${pct(row.rangeAvr)} printed`:''}</span></header>${img?.src?`<button type="button" class="chart-image-button" data-view="${start+j}" aria-label="Enlarge chart for ${esc(d.date)}"><img src="${esc(img.src)}" alt="Full-day chart for ${esc(d.date)} ${esc(d.contract)}" loading="lazy" width="${img.width}" height="${img.height}"><span class="enlarge">Enlarge ↗</span></button>`:`<div class="chart-image-button"><div class="missing-chart">Screenshot not uploaded for this date yet${d.screen?`<br><a href="${esc(d.screen)}" target="_blank" rel="noopener noreferrer">Workbook source · access may be required</a>`:''}</div></div>`}<div class="card-detail">${row?`<p>${moves}<br>${state.query.avr?'Moves rescaled to your AVR.':'Moves in that historical day’s own points.'} ${bucket(row.bboxPosition)} at cutoff${m.distance?` · distance ${num(m.distance)}`:''}.</p>`:`<p>${esc(d.sequence).slice(0,230)}${d.sequence?.length>230?'…':''}</p>`}<div class="card-tags">${tagList.map(t=>`<span class="card-tag">${esc(friendly(t))}</span>`).join('')}</div>${d.screenNote?'<p class="amber">Source chart has a verification note — see enlarged view.</p>':''}</div></article>`;
 }).join('')||'<div class="empty"><b>No charts in this selection</b>Broaden the selected tags or current location to find more cases.</div>';
}
function showViewer(index){if(!state.matches.length)return;state.viewer=(index+state.matches.length)%state.matches.length;const {day:d,row}=state.matches[state.viewer],asset=state.galleryIndex[d.index];$('viewer-title').textContent=`${d.date} · ${d.contract}`;$('viewer-subtitle').textContent=`${state.viewer+1} / ${state.matches.length} matched days · full-day chart includes later outcomes`;
 $('viewer-image-area').classList.remove('zoom');$('viewer-zoom').textContent='Actual size';$('viewer-image').src=asset?.src||'';$('viewer-image').hidden=!asset?.src;$('viewer-image').alt=`Historical chart ${d.date} ${d.contract}`;$('viewer-source').href=asset?.src||d.screen||'#';$('viewer-source').hidden=!d.screen&&!asset?.src;$('viewer-source').textContent=asset?.src?'Open public screenshot ↗':'Workbook source ↗';
 let detail=$('viewer-detail-source');if(!detail){detail=document.createElement('a');detail.id='viewer-detail-source';detail.className='quiet';detail.target='_blank';detail.rel='noopener noreferrer';detail.textContent='Detail view ↗';detail.style.fontSize='12px';$('viewer-source').after(detail);}
 detail.hidden=!asset?.detailSrc;if(asset?.detailSrc)detail.href=asset.detailSrc;else detail.removeAttribute('href');
 $('viewer-prev').disabled=state.viewer===0;$('viewer-next').disabled=state.viewer>=state.matches.length-1;
 $('viewer-details').innerHTML=`${row?`<p><b>At ${clockLabel(state.query.minute)}:</b> ${pct(row.rangeAvr)} AVR printed · ${bucket(row.bboxPosition)} relative to prior NY. Remaining upside ${pt(row.nextHighAvr*(state.query.avr||d.avr))}, downside ${pt(-row.nextLowAvr*(state.query.avr||d.avr))}, external expansion ${pt(row.additionalRangeAvr*(state.query.avr||d.avr))}${state.query.avr?' using your AVR':' in historical points'}.</p>`:''}<p><b>Completed-day sequence:</b> ${esc(d.sequence||'No written sequence in the source.')}</p><p><b>Data notes:</b> ${esc((d.flags||[]).join(' · ')||'No additional source quality flags.')}</p><p><b>Source status:</b> ${esc(d.evidenceStatus||'Not individually verified')}${d.screenNote?` · ${esc(d.screenNote)}`:''}</p>`;
 if(!$('chart-dialog').open)$('chart-dialog').showModal();
}
function clearResults(message){clearForecastContext($('forecast-context'),undefined,!(val('avr')>0)||val('range-high')===null&&val('range-low')===null&&val('printed')===null);state.box=null;state.pine=null;renderBoxEmpty('Update valid planning inputs to estimate the box.');state.matches=[];state.pool=[];state.summary=null;$('comparison-results').innerHTML='<p class="notice">Update valid planning inputs to compare cases.</p>';$('result-header').innerHTML='';$('forecast').innerHTML=`<div class="panel empty">${message}</div>`;$('range-assessment').innerHTML='';$('cohort-note').textContent='';renderGallery();}
function analyze(){if(!state.ready)return;renderBBoxReturn();state.request++;$('form-error').textContent='';syncInputs();renderTags();renderCheckpoints();renderSessions();state.page=0;let q;try{q=state.library?{minute:clockMinute($('asof').value),date:$('trading-date').value,tags:[...state.selected],tagMode:$('tag-mode').value,year:$('year').value,observations:[]}:readQuery();}catch(e){$('form-error').textContent=e.message;state.query=null;clearResults('<b>Update your inputs</b>Correct the input message above to calculate a new estimate.');return;}state.query=q;
 if(state.library){clearForecastContext($('forecast-context'),'Return to planning for compression and expansion.');state.box=null;state.pine=null;renderBoxEmpty('Return to planning to estimate future movement.');const matches=state.days.filter(d=>(!q.year||d.date.startsWith(q.year))&&hasTags(d,q.tags,q.tagMode,q.minute,true)).sort((a,b)=>b.date.localeCompare(a.date)).map(day=>({day}));state.matches=matches;state.pool=matches;state.summary=null;resultHeader(q,{matches,pool:matches,numericCount:0,observationCount:0});$('forecast').innerHTML='<div class="panel"><h2>Completed-day chart research</h2><div class="notice">All dictionary tags are enabled. This mode reveals outcomes and does not produce movement estimates. Only the selected tags and year filter apply.</div></div>';$('range-assessment').innerHTML='';$('cohort-note').textContent=`${matches.length} dates · ${q.tagMode.toUpperCase()} tag matching · full-day hindsight`;renderGallery();renderComparison(state);return;}
 const blocked=q.tags.filter(id=>{const tag=state.tags.find(t=>t.id===id);return !tag||tag.earliestMinute==null||tag.earliestMinute>q.minute;});if(blocked.length){clearResults(`<b>Some tags are only known later</b>Remove ${blocked.map(t=>esc(friendly(t))).join(', ')} or browse completed-day tags. These cannot be used at ${clockLabel(q.minute)}.`);return;}
 if(q.behavior&&q.minute< -210){clearResults('<b>The last-hour condition needs a full prior hour</b>Clear that condition or choose 20:30 ET or later.');return;}
 try{const key=`${q.minute}:${q.endMinute}`;let rows=state.rowCache.get(key);if(!rows){rows=deriveRows(state.days,state.timeline,q.minute,q.endMinute);state.rowCache.set(key,rows);if(state.rowCache.size>12)state.rowCache.delete(state.rowCache.keys().next().value);}const selection=selectMatches(state.days,rows,q);state.matches=selection.matches;state.pool=selection.pool;renderProjection(q,selection);renderBox();$('cohort-note').textContent=`${rows.length} complete historical windows before your filters. ${selection.numericCount?'Sorted by numeric similarity; lower distance means closer.':q.limit==='ALL'?'All eligible days contribute equally.':'No numeric ranking: most recent eligible days selected.'} ${q.observations.length?`${q.observations.length} earlier checkpoints were matched at their own times.`:''} Same explicit-contract research through ${instrument.id==='NQ'?'2026-10-15':'2026-09-25'}.`;renderGallery();}catch(e){clearResults(`<b>Unable to calculate this window</b>${esc(e.message)}`);}
}
async function method(){ $('method-body').innerHTML=await fetch('method-v6.html').then(r=>r.text());$('method-dialog').showModal();}
function registerTools(){const context=document.modelContext;if(!context?.registerTool)return;const controller=new AbortController();const register=t=>Promise.resolve(context.registerTool(t,{signal:controller.signal})).catch(()=>{});
 register({name:'read_planning_estimate',title:'Read session movement estimate',description:'Read applied window, empirical movement in points, range context and matched dates without changing inputs.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>({mode:state.library?'library':'planning',query:state.query,summary:state.summary,count:state.matches.length,dates:state.matches.slice(0,10).map(m=>m.day.date),error:$('form-error').textContent})});
 register({name:'configure_planning_window',title:'Update session planning inputs',description:'Update the visible as-of time, planning window, price, AVR, printed percentage and dictionary tags, then calculate remaining historical movement. Does not save a checkpoint or execute trades.',inputSchema:{type:'object',properties:{window:{type:'string',enum:Object.keys(windows)},time:{type:'string'},price:{type:'number'},avr:{type:'number',exclusiveMinimum:0},printedPercent:{type:'number',minimum:0,maximum:2000},tags:{type:'array',items:{type:'string'}}},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:input=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['window','time','price','avr','printedPercent','tags'].includes(k)))throw new Error('Invalid planning fields.');if(input.window&&!windows[input.window])throw new Error('Unknown planning window.');if(input.time!=null&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))throw new Error('Time must be HH:MM.');for(const k of ['price','avr','printedPercent'])if(input[k]!=null&&!Number.isFinite(input[k]))throw new Error('Numeric inputs must be finite.');if(input.avr!=null&&input.avr<=0||input.printedPercent!=null&&(input.printedPercent<0||input.printedPercent>2000))throw new Error('Invalid AVR input.');if(input.tags!=null&&(!Array.isArray(input.tags)||input.tags.some(t=>!state.tags.some(x=>x.id===t))))throw new Error('Unknown dictionary tag.');if(input.window){$('window').value=input.window;const m=clockMinute($('asof').value);if(m>windows[input.window][1])$('asof').value=clockLabel(windows[input.window][1]);}if(input.time)$('asof').value=input.time;if(input.price!=null)$('price').value=input.price;if(input.avr!=null)$('avr').value=input.avr;if(input.printedPercent!=null){$('range-high').value='';$('range-low').value='';$('printed').value=input.printedPercent;}if(input.tags)state.selected=new Set(input.tags);state.library=false;analyze();return {query:state.query,count:state.matches.length,summary:state.summary,error:$('form-error').textContent};}});window.addEventListener('pagehide',()=>controller.abort(),{once:true});}
$('scenario-form').addEventListener('input',()=>clearForecastContext($('forecast-context'),'Inputs changed. Update the forecast to refresh this reading.'));
$('scenario-form').addEventListener('submit',e=>{e.preventDefault();analyze();});
$('window').addEventListener('change',()=>{const [start,end]=selectedWindow(),current=clockMinute($('asof').value);if(current<start||current>end||!Number.isFinite(current))$('asof').value=clockLabel(start);analyze();});
let previousUdUnits=$('ud-units').value;
$('ud-units').addEventListener('change',()=>{
 const next=$('ud-units').value,avr=val('avr');
 if(!Number.isFinite(val('open1930'))&&next!==previousUdUnits&&['up','down'].some(id=>val(id)!=null)){
  if(!(avr>0)){$('ud-units').value=previousUdUnits;$('form-error').textContent='Enter AVR before converting U/D between points and percent.';return;}
  for(const id of ['up','down'])if(val(id)!=null)$(id).value=(val(id)*(next==='percent'?100/avr:avr/100)).toFixed(6);
 }
 previousUdUnits=next;analyze();
});
for(const id of fields.filter(id=>!['window','notes','ud-units'].includes(id)))$(id).addEventListener('change',analyze);
for(const id of ['price','avr','range-high','range-low','prior-high','prior-low','open1930'])$(id).addEventListener('input',syncInputs);
$('use-checkpoints').addEventListener('change',analyze);$('save-checkpoint').addEventListener('click',saveCheckpoint);$('checkpoints').addEventListener('click',e=>{const remove=e.target.closest('[data-delete-checkpoint]');if(remove){state.checkpoints=state.checkpoints.filter(c=>c.key!==remove.dataset.deleteCheckpoint);try{localStorage.setItem(storageKey,JSON.stringify(state.checkpoints));}catch{}renderCheckpoints();analyze();return;}const b=e.target.closest('[data-checkpoint]');if(b)loadCheckpoint(b.dataset.checkpoint);});
$('tag-search').addEventListener('input',renderTags);$('tag-options').addEventListener('change',e=>{const box=e.target.closest('[data-tag]');if(!box)return;box.checked?state.selected.add(box.dataset.tag):state.selected.delete(box.dataset.tag);analyze();});$('selected-tags').addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(b){state.selected.delete(b.dataset.remove);analyze();}});$('clear-tags').addEventListener('click',()=>{state.selected.clear();analyze();});
$('mode-btn').addEventListener('click',()=>{state.library=!state.library;analyze();});$('reset-btn').addEventListener('click',()=>{$('scenario-form').reset();$('trading-date').value=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});state.selected.clear();state.sessionChoices={};$('sequence-explore').checked=false;state.library=false;$('use-checkpoints').checked=false;analyze();});
$('gallery-size').addEventListener('change',()=>{state.page=0;renderGallery();});$('gallery-prev').addEventListener('click',()=>{state.page--;renderGallery();});$('gallery-next').addEventListener('click',()=>{state.page++;renderGallery();});$('gallery').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)showViewer(Number(b.dataset.view));});
$('viewer-prev').addEventListener('click',()=>{if(state.viewer>0)showViewer(state.viewer-1);});$('viewer-next').addEventListener('click',()=>{if(state.viewer<state.matches.length-1)showViewer(state.viewer+1);});$('viewer-zoom').addEventListener('click',()=>{const zoom=$('viewer-image-area').classList.toggle('zoom');$('viewer-zoom').textContent=zoom?'Fit chart':'Actual size';});$('chart-dialog').addEventListener('keydown',e=>{if(e.key==='ArrowRight'&&state.viewer<state.matches.length-1){e.preventDefault();showViewer(state.viewer+1);}if(e.key==='ArrowLeft'&&state.viewer>0){e.preventDefault();showViewer(state.viewer-1);}});
document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));$('method-btn').addEventListener('click',method);$('forecast').addEventListener('click',e=>{if(e.target.closest('.explain'))method();});
$('trading-date').value=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});
try{const saved=JSON.parse(localStorage.getItem(storageKey)||'[]');if(Array.isArray(saved))state.checkpoints=saved.filter(c=>c&&typeof c.key==='string'&&Number.isFinite(c.minute)&&c.condition&&c.inputs&&Array.isArray(c.tags));}catch{}
function migrateCheckpoints(){
 const allowed=new Set(state.tags.map(t=>t.id));
 const convert=id=>{const m=/^GAP_FILLED_(\d\d):(\d\d)$/.exec(id);return m?`GAP_30_${Math.floor((+m[1]*60 + +m[2])/30)*30}`:id;};
 state.checkpoints=state.checkpoints.map(c=>{const tags=[...new Set(c.tags.map(convert))].filter(t=>allowed.has(t));return {...c,tags,inputs:{...c.inputs,'ud-units':c.inputs['ud-units']||'percent',window:c.condition.endMinute<=300?'1930-0500':'1930-0830'},condition:{...c.condition,tags,observations:[]}};});
}
function renderSessions(){
 if(!state.ready)return;
 const minute=clockMinute($('asof').value),explore=$('sequence-explore').checked;
 for(const s of sessions)if(!explore&&s.end>minute)delete state.sessionChoices[s.id];
 const results=sessionProbabilities(state.days.filter(d=>d.date<$('trading-date').value),state.sessionChoices,$('year').value);
 $('session-cards').innerHTML=results.map((r,i)=>{const s=r.session,locked=!explore&&s.end>minute,chosen=state.sessionChoices[s.id]||'',conditions=r.conditions.map(p=>`${p.id}: ${shapeName(p.value)}`).join(' + ');
  return `<article class="session-card"><div class="session-time">${esc(s.time)} ET</div><h3>${esc(s.name)}</h3><p class="session-denominator">${r.n.toLocaleString()} complete cases${r.n<20?' · small sample':''}</p><p class="session-conditioning">${conditions?`Given ${esc(conditions)}`:'Unconditional baseline'}${explore&&r.conditions.some(p=>sessions.find(s=>s.id===p.id).end>minute)?' · hypothetical':''}</p><div class="probability-bars">${r.bins.map(b=>{const definition=state.shapeDictionary.find(t=>t.id===`${s.id}:${b.id}`)?.definition||shapeName(b.id);return `<div class="probability-row ${chosen===b.id?'observed':''}" title="${esc(definition)}"><div><span>${esc(b.label)}</span><b>${b.p==null?'—':(b.p*100).toFixed(1)+'%'}</b></div><div class="probability-track" role="img" aria-label="${esc(b.label)}: ${b.count} of ${r.n} cases"><span style="width:${(b.p||0)*100}%"></span></div><small>${b.count} / ${r.n}</small></div>`;}).join('')}</div>${i<sessions.length-1?`<label class="observed-select">${explore?'Assume this outcome':'Observed outcome'}<select data-session="${s.id}" aria-label="${s.id} observed outcome" ${locked?'disabled':''}><option value="">Not selected</option>${shapes.map(([id,label])=>`<option value="${id}" ${chosen===id?'selected':''}>${label}</option>`).join('')}</select></label><p class="session-select-note">${locked?`Available after ${clockLabel(s.end)}. Use hypothetical mode to explore.`:'Selecting an outcome updates the sessions to the right.'}</p>`:'<p class="session-select-note">Final session in the sequence.</p>'}</article>`;
 }).join('');
}
function renderBoxEmpty(message){$('box-result').innerHTML=`<p class="field-help">${esc(message)}</p>`;state.pine=null;$('pine-source').value='';$('download-pine').disabled=true;$('copy-pine').disabled=true;$('pine-status').textContent='';$('forecast-code').value='';$('copy-forecast-code').disabled=true;}
function renderBox(){
 state.box=null;state.pine=null;const q=state.query;
 if(state.library||!q||!Number.isFinite(q.minute)){renderBoxEmpty('Return to valid planning inputs to estimate the box.');return;}
 const end=q.endMinute;
 if(end<=q.minute){renderBoxEmpty('The 08:30 forecasting deadline has passed. The standalone range indicator remains available below.');return;}
 const b=boxEstimate(state.days,state.timeline,q,end,state.rowCache.get(`${q.minute}:${end}`));state.box=b;
 if(!b){renderBoxEmpty('No complete matches for this box. Broaden your conditions.');return;}
 const ready=q.price!=null&&q.avr>0,minutes=end-q.minute;
 
 $('box-result').innerHTML=`<p class="compact-note">${clockLabel(q.minute)}–${clockLabel(end)} ET · ${raised(pct(b.coverage))} in-sample containment</p>`;
 $('download-pine').disabled=!ready||!state.pineTemplate;$('copy-pine').disabled=!ready||!state.pineTemplate;$('pine-status').textContent='';
 if(ready){state.pine=state.pineTemplate?makeChartPine(state.pineTemplate,b,q):null;$('forecast-code').value=makeForecastCode(b,q);}else $('forecast-code').value='';$('copy-forecast-code').disabled=!ready;$('pine-source').value=state.pine||'';
}
$('session-cards').addEventListener('change',e=>{const select=e.target.closest('[data-session]');if(!select)return;const i=sessions.findIndex(s=>s.id===select.dataset.session);state.sessionChoices[select.dataset.session]=select.value;for(const s of sessions.slice(i+1))delete state.sessionChoices[s.id];renderSessions();});
$('clear-sequence').addEventListener('click',()=>{state.sessionChoices={};renderSessions();});
$('sequence-explore').addEventListener('change',renderSessions);
$('box-horizon').addEventListener('change',renderBox);
$('copy-forecast-code').addEventListener('click',async()=>{const field=$('forecast-code');if(!field.value)return;try{await navigator.clipboard.writeText(field.value);flashCopyStatus($('pine-status'),'Code copied!');}catch{field.focus();field.select();flashCopyStatus($('pine-status'),'Code selected. Press Ctrl+C.',0);}});
$('download-pine').addEventListener('click',()=>{if(!state.pine)return;const url=URL.createObjectURL(new Blob([state.pine],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`SessionPath-${instrument.id}-${state.query.date}-${clockLabel(state.query.minute).replace(':','')}.pine`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('pine-status').textContent='Indicator exported for these inputs.';});
$('copy-pine').addEventListener('click',async()=>{if(!state.pine)return;try{await navigator.clipboard.writeText(state.pine);flashCopyStatus($('pine-status'),'Script copied!');}catch{$('pine-code-details').style.display='block';$('pine-code-details').open=true;$('pine-source').focus();$('pine-source').select();flashCopyStatus($('pine-status'),'Code selected below. Press Ctrl+C or download.',0);}});

function syncDate(){const replay=$('replay-toggle').checked,today=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});$('replay-date-wrap').hidden=!replay;if(replay){$('replay-date').value||=today;$('trading-date').value=$('replay-date').value;}else $('trading-date').value=today;$('date-label').textContent=replay?'Earlier cases only':'Today · '+today;}
$('replay-toggle').addEventListener('change',()=>{syncDate();analyze();});$('replay-date').addEventListener('change',()=>{syncDate();analyze();});syncDate();syncInputs();$('analyze-btn').disabled=true;
async function startResearch(){
 try{
  $('dataset-status').textContent='Loading '+instrument.id+' research…';
  [state.days,state.tags,state.timeline,state.extra]=await Promise.all(['days.json','tags.json','timeline.json','planner-extra.json'].map(file=>getJSON(dataPath(file))));
  await yieldToBrowser();
  state.shapeDictionary=state.tags;Object.assign(state,enrichResearch(state.days,state.tags,state.extra));migrateCheckpoints();
  await yieldToBrowser();
  mountNYReference(state.days,state.timeline);
  restoreMarketInputs();syncDate();syncInputs();
  state.ready=true;$('analyze-btn').disabled=false;
  await yieldToBrowser();
  // Date change already renders the initial forecast; do not calculate twice.
  $('trading-date').dispatchEvent(new Event('change'));
  $('dataset-status').textContent=`${instrument.id} · ${state.days.length.toLocaleString()} research dates · 2022–2026`;
  document.documentElement.dataset.startup='ready';$('startup-recovery')?.remove();registerTools();
 }catch(error){
  state.ready=false;document.documentElement.dataset.startup='failed';
  $('dataset-status').textContent='Research could not be loaded';
  $('forecast').innerHTML=`<div class="panel empty"><p>${esc(error.message)}</p><button type="button" id="retry-research" class="quiet">Retry loading</button></div>`;
  $('retry-research').onclick=()=>location.reload();return;
 }
 // An optional download must never block the forecast.
 async function optionalAsset(file,apply,target){
  try{apply(await loadAsset(file,{format:file.endsWith('.pine')?'text':'json'}));}
  catch(error){
   const note=document.createElement('p');note.className='compact-note';note.textContent=error.message+' ';
   const retry=document.createElement('button');retry.type='button';retry.className='quiet';retry.textContent='Retry';
   retry.onclick=()=>{note.remove();optionalAsset(file,apply,target);};note.append(retry);target.append(note);
  }
 }
 void optionalAsset(dataPath('gallery-index.json')+'?v=public-captures-20261020',value=>{state.galleryIndex=value;renderGallery();},$('evidence'));
 void optionalAsset(instrument.indicatorFile,value=>{state.pineTemplate=value;renderBox();},$('indicator-section'));
 const applyReaderChoices=choices=>{for(const c of choices){if(c.kind==='tag')state.selected.add(c.value);if(c.kind==='behavior')$('behavior').value=c.value;if(c.kind==='value'){const [id,value]=c.value.split('=');if($(id))$(id).value=value;}}state.library=false;analyze();};
 for(const mount of [()=>mountReplayTools(state,applyReplaySnapshot),()=>mountDictionary(state),()=>mountValidation(),()=>mountReader(state,applyReaderChoices),()=>mountLocalImporter(state,applyReaderChoices)]){
  await yieldToBrowser();try{Promise.resolve(mount()).catch(error=>console.warn('Optional tool unavailable:',error));}catch(error){console.warn('Optional tool unavailable:',error);}
 }
 for(const id of ['compare-a','compare-b'])$(id).addEventListener('change',()=>renderComparison(state));
}
await startResearch();
