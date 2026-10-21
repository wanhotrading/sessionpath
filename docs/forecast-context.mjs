import {tint,revealContext,moveMarker} from './forecast-motion.mjs';
import {mountUtilizationDirection,renderUtilizationDirection} from './utilization-ui.mjs';
import {probabilityMarkup as raised} from './probability-finish.mjs';
import {instrument,assetPath} from './instrument.mjs';
import {regime,rate,average,quantile,finite,inputNumber} from './research-core.mjs';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pc=x=>finite(x)?(x*100).toFixed(1)+'%':'—',pp=x=>finite(x)?(x*100).toFixed(1)+' pp':'—',pt=x=>finite(x)?x.toFixed(2)+' pt':'—';
const clocks={p03:'03:00',p05:'05:00',p0830:'08:30',p16:'16:00'};
let dataPromise;
const data=()=>dataPromise??=(fetch(assetPath('research-observations.json')).then(r=>{if(!r.ok)throw Error('Historical observations could not be loaded.');return r.json();}).catch(e=>{dataPromise=null;throw e;}));
const metric=(title,value,detail)=>`<article class="context-metric"><span>${title}</span><strong>${raised(value)}</strong><small>${detail}</small></article>`;
const probability=r=>r.n?`${raised(pc(r.p))} <small>${r.k}/${r.n} · 95% interval ${raised(pc(r.lo))}–${raised(pc(r.hi))}</small>`:'— <small>No eligible dates</small>';
const revisions=new WeakMap();
const idleMeter='<div class="context-meter" aria-hidden="true"><i style="left:50%"></i></div><div class="context-meter-labels"><span>Compressed</span><span>Typical</span><span>Expanded</span></div>';
export function clearForecastContext(host,message='Update the session inputs to refresh this reading.',missing=false){
 if(!host)return;revisions.set(host,(revisions.get(host)||0)+1);host.classList.toggle('context-missing',missing);host.innerHTML=`<h3>Compression & expansion</h3><p class="compact-note">${missing?'<span class="missing-icon" role="img" aria-label="Missing inputs">⚠</span> Input 19:30 to cut-off and AVR to display.':esc(message)}</p>${idleMeter}`;
}
export function mountForecastContext(){
 const projection=$('projection'),grid=document.createElement('div'),left=document.createElement('div'),aside=document.createElement('aside');
 grid.className='forecast-context-grid';left.className='forecast-main';aside.id='forecast-context';aside.className='forecast-context';aside.setAttribute('aria-live','polite');
 projection.insertBefore(grid,$('forecast'));left.append($('forecast'));
 const details=document.createElement('details');details.className='session-note';details.innerHTML='<summary>Range details</summary>';details.append($('range-assessment'));left.append(details);grid.append(left,aside);
 clearForecastContext(aside,'Enter frozen AVR and printed range in Session inputs. This reading updates with your forecast.');
 
}
export async function renderForecastContext(host,q,{endMinute=q?.endMinute,year=q?.year||''}={}){
 if(!host)return;
 const rev=(revisions.get(host)||0)+1;revisions.set(host,rev);
 const cutoff={180:'p03',300:'p05',510:'p0830'}[q?.minute];
 host.classList.remove('context-missing');host.innerHTML='<h3>Compression & expansion</h3><p class="compact-note">Reading the current session inputs…</p>';
 const fail=(message,missing=false)=>{if(revisions.get(host)!==rev)return;host.classList.toggle('context-missing',missing);host.innerHTML=`<h3>Compression & expansion</h3><p class="compact-note">${missing?'<span class="missing-icon" role="img" aria-label="Missing inputs">⚠</span> ':''}${esc(message)}</p>${missing?idleMeter:''}`;};
 if(!cutoff||endMinute!==({p03:300,p05:510,p0830:960}[cutoff])){fail('Available for 03:00–05:00, 05:00–08:30 and 08:30–16:00. Choose the corresponding forecast window.');return;}
 if(!(q.avr>0)||!finite(q.printed)){fail('Input 19:30 to cut-off and AVR to display.',true);return;}
 try{
  const observations=await data();if(revisions.get(host)!==rev)return;
  const previous=q.observations||[],at=m=>previous.find(x=>x.minute===m&&finite(x.printed))?.printed??null;
  const input={date:q.date,cutoff,avr:q.avr,printed:q.printed,p03:at(180),p05:at(300),target:.75};
  const rows=observations.avr.filter(r=>!year||r.year===String(year)),s=regime(rows,input);
  const baseline=rows.filter(r=>r.date<q.date&&finite(r[cutoff])&&finite(r[s.to])&&r[s.to]>=r[cutoff]-1e-8),expansion=baseline.map(r=>Math.max(0,r[s.to]-r[cutoff]));
  const label=s.percentile==null?'No comparison':s.percentile<=.25?'Compressed':s.percentile>=.75?'Expanded':'Typical';
  const compression=s.percentile==null?'No earlier cutoff observations.':`${pc(s.percentile)} of earlier ranges at this time were no larger.`;
  const targetRows=[.75,1].map(target=>{const eligible=s.matched.filter(r=>r[cutoff]<target-1e-8),r=rate(eligible.filter(r=>r[s.to]>=target-1e-8).length,eligible.length);return `<div class="context-target"><span>Reach ${pc(target)} AVR by ${clocks[s.to]}</span><b>${q.printed>=target-1e-8?'Already reached':probability(r)}</b></div>`;}).join('');
  host.innerHTML=`<div class="context-heading"><div class="eyebrow">SAME SESSION INPUTS</div><h3>Compression & expansion</h3></div><div class="context-state"><strong>${label}</strong><span>${pc(q.printed)} AVR printed</span></div><p class="compact-note">${clocks[cutoff]} → ${clocks[s.to]} NY · ${esc(q.date)}<br>${compression}</p><div class="context-meter" aria-hidden="true"><i style="left:${Math.max(0,Math.min(100,100*(s.percentile||0)))}%"></i></div><div class="context-meter-labels"><span>Compressed</span><span>Typical</span><span>Expanded</span></div><p class="compact-note"><b>${s.n} matched dates</b> · ${s.bin} already printed${year?' · '+esc(year):''}${input.p03!==null?' · 03:00 checkpoint matched':''}${cutoff==='p0830'&&input.p05!==null?' · 05:00 checkpoint matched':''}</p>${s.n<30?'<p class="notice">'+(s.n?'Small sample: fewer than 30 dates.':'No matching history; no substitute group used.')+'</p>':''}<div class="context-metrics">${metric('Mean added range',pp(s.mean),pt(s.mean==null?null:s.mean*q.avr)+' at your AVR')}${metric('Median added range',pp(s.median),pt(s.median==null?null:s.median*q.avr)+' at your AVR')}${metric('No further expansion',pc(s.zero.p),s.zero.n?`${s.zero.k}/${s.zero.n} · 95% ${raised(pc(s.zero.lo))}–${raised(pc(s.zero.hi))}`:'No eligible dates')}${metric('Add ≥25 pp of AVR',pc(s.extra25.p),s.extra25.n?`${s.extra25.k}/${s.extra25.n} · 95% ${raised(pc(s.extra25.lo))}–${raised(pc(s.extra25.hi))}`:'No eligible dates')}</div>${targetRows}<details class="session-note"><summary>What these probabilities measure</summary><p>Expansion is the increase in the cumulative high–low from 19:30. Zero expansion is included. “25 pp of AVR” means another 25% of the fixed AVR, not a 25% increase in the existing range.</p><p>Comparison uses dates before ${esc(q.date)}, matching the printed-AVR bin and any applied earlier checkpoints. The year filter applies. Forecast tags, BBOX positions and nearest-case limits do not filter this separate expansion cohort.</p><p>Target rates count only historical cases still below that target at the cutoff. Cases within a bin start at different exact percentages. These historical frequencies have not been established as calibrated live probabilities or a trading edge.</p><p>Middle 50% of added range: ${pp(s.p25)}–${pp(s.p75)}. Frozen AVR normalizes volatility; it is not percentage of the instrument price.</p></details>`;
  const vals=[s.mean,s.median,s.zero.p,s.extra25.p],refs=[average(expansion),quantile(expansion,.5),rate(expansion.filter(x=>x<=1e-8).length,expansion.length).p,rate(expansion.filter(x=>x>=.25-1e-8).length,expansion.length).p];
  host.querySelectorAll('.context-metric>strong').forEach((el,i)=>tint(el,vals[i],refs[i],'Earlier same-window history; range values × AVR, probabilities 0–1'));
  [.75,1].forEach((target,i)=>{if(q.printed>=target-1e-8)return;const a=s.matched.filter(r=>r[cutoff]<target-1e-8),b=baseline.filter(r=>r[cutoff]<target-1e-8);tint(host.querySelectorAll('.context-target>b')[i],rate(a.filter(r=>r[s.to]>=target-1e-8).length,a.length).p,rate(b.filter(r=>r[s.to]>=target-1e-8).length,b.length).p,'Earlier same-window target probability, conditional on target not yet reached');});
  moveMarker(host,finite(s.percentile)?100*s.percentile:50);revealContext(host);
 }catch(e){fail(e.message);}
}

export function jointNY(rows,{date,three='',five='',year=''}={}){
 const base=rows.filter(r=>r.date<date&&(!year||r.year===String(year))&&r.three&&r.five&&r.ny);
 const summarize=rs=>({n:rs.length,U:rate(rs.filter(r=>r.ny.tilt==='U').length,rs.length),D:rate(rs.filter(r=>r.ny.tilt==='D').length,rs.length),tie:rate(rs.filter(r=>r.ny.tilt==='TIE').length,rs.length),share:average(rs.map(r=>r.ny.uShare)),finalUp:rate(rs.filter(r=>r.ny.finalDirection==='U').length,rs.length)});
 return {baseline:summarize(base),selected:summarize(base.filter(r=>(!three||r.three.strength===three)&&(!five||r.five.strength===five))),cells:['U90','U','D','D90'].flatMap(a=>['U90','U','D','D90'].map(b=>({three:a,five:b,...summarize(base.filter(r=>r.three.strength===a&&r.five.strength===b))})))};
}
export function mountNYContext(host){
 const inputs=document.createElement('div');inputs.className='ny-controls context-ny-inputs';inputs.innerHTML='<label>19:30–08:30 high<input id="ny-range-high" type="number" step="any" placeholder="High"></label><label>19:30–08:30 low<input id="ny-range-low" type="number" step="any" placeholder="Low"></label><label>Printed % AVR · at 08:30<input id="ny-printed" type="number" min="0" step="any" placeholder="Printed %"></label>';
 const original=host.querySelector('.ny-price-inputs'),numeric=document.createElement('div');numeric.className='ny-numeric-inputs';original.before(numeric);
 numeric.append(...original.querySelectorAll('label'),...inputs.children,$('ny-date'),$('ny-clear'));original.remove();
 const row=document.createElement('div');row.className='ny-forecast-context-grid';const main=document.createElement('div');main.className='forecast-main';const aside=document.createElement('aside');aside.id='ny-forecast-context';aside.className='forecast-context';aside.setAttribute('aria-live','polite');$('ny-results').before(row);main.append($('ny-results'));row.append(main,aside);
 const direction=document.createElement('details');direction.id='ny-close-archive';direction.className='session-note';direction.innerHTML=`<summary>Archive: five-minute candle-close dominance</summary><p>Uses completed 03:00–05:00 and 05:00–08:30 candles. U90/D90: ≥90% of all closes above/below that window’s own open. U/D: more closes on that side than the other, excluding the ≥90% groups.</p><div class="ny-controls">${[['three','03:00–05:00'],['five','05:00–08:30']].map(([id,label])=>`<label>${label}<select id="ny-strength-${id}"><option value="">Not entered</option>${['U90','U','D','D90'].map(s=>`<option>${s}</option>`).join('')}</select></label>`).join('')}</div><div id="ny-strength-result"></div>`;row.after(direction);mountUtilizationDirection(direction);direction.addEventListener('toggle',()=>{if(direction.open)renderNYStrength();});
 clearForecastContext(aside,'Enter the 08:30 cumulative range above. The same NY AVR and trading date are used.');
}
export function readNYPrinted(){
 const h=inputNumber($('ny-range-high').value),l=inputNumber($('ny-range-low').value),avr=inputNumber($('ny-avr').value),field=$('ny-printed');
 field.disabled=h!==null||l!==null;
 if(field.disabled){field.value=h!==null&&l!==null&&h>=l&&avr>0?((h-l)/avr*100).toFixed(3):'';}
 return inputNumber(field.value)===null?null:Number(field.value)/100;
}
export async function renderNYStrength(){renderUtilizationDirection();if(!$('ny-close-archive')?.open)return;
 const host=$('ny-strength-result');if(!host)return;
 const rev=(revisions.get(host)||0)+1;revisions.set(host,rev);
 const three=$('ny-strength-three').value,five=$('ny-strength-five').value,date=$('ny-date').value,year=$('ny-year').value;
 host.innerHTML='<p class="compact-note">Loading earlier completed sessions…</p>';
 try{const observations=await data();if(revisions.get(host)!==rev)return;const s=jointNY(observations.occupancy,{date,three,five,year}),b=s.baseline,x=s.selected;
  const delta=(a,c)=>finite(a)&&finite(c)?((a-c)*100>=0?'+':'')+((a-c)*100).toFixed(1)+' pp':'—';
  const row=x=>`<tr><td>${x.three} / ${x.five}</td><td>${x.n}</td><td class="mint">${probability(x.U)}</td><td class="red">${probability(x.D)}</td></tr>`;
  host.innerHTML=`${three&&five?`<h4>${three} → ${five}: NY outcome</h4><div class="context-metrics">${metric('NY U-dominant',pc(x.U.p),`${x.U.k}/${x.n} · ${delta(x.U.p,b.U.p)} vs baseline`)}${metric('NY D-dominant',pc(x.D.p),`${x.D.k}/${x.n} · ${delta(x.D.p,b.D.p)} vs baseline`)}</div><p class="compact-note">NY ties: ${x.tie.k}/${x.n}, retained in the denominator. ${x.n<30?'Small sample; unstable percentages.':''}</p><p>Average share of NY candles closing above the 08:30 open: <b>${raised(pc(x.share))}</b>.<br>NY final close above the 08:30 open: <b>${probability(x.finalUp)}</b>.</p>`:''}<details><summary>All 16 non-tie combinations · counts and 95% intervals</summary><div class="table-wrap"><table class="strength-table"><thead><tr><th>03–05 / 05–08:30</th><th>Dates</th><th>NY U-dominant</th><th>NY D-dominant</th></tr></thead><tbody>${s.cells.map(row).join('')}</tbody></table></div></details><details><summary>Read these three measures correctly</summary><p><b>NY U-dominant:</b> NY had more closes above its 08:30 open than below it. The percentage counts qualifying days.</p><p><b>Average U-close share:</b> calculate above-open candles ÷ all 90 NY candles for each day, then average those fractions. Example: 60/90 = 66.7% for one day.</p><p><b>Final close above open:</b> only the 15:55–16:00 candle’s close versus the 08:30 open. It can finish below even after most candles closed above.</p></details>`;
 }catch(e){if(revisions.get(host)===rev)host.textContent=e.message;}
}
