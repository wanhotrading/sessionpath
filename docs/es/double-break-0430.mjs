const $=id=>document.getElementById(id),EPS=1e-7;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pc=x=>Number.isFinite(x)?(100*x).toFixed(1)+'%':'—',num=x=>Number.isFinite(x)?x.toFixed(2):'—',multiple=x=>Number.isFinite(x)?(100*x).toFixed(1)+'%':'—';
const clock=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const quantile=(a,p)=>{if(!a.length)return null;const v=[...a].sort((x,y)=>x-y),k=(v.length-1)*p,l=Math.floor(k);return v[l]+(v[Math.ceil(k)]-v[l])*(k-l);};
function rate(k,n){if(!n)return {k,n,p:null,lo:null,hi:null};const p=k/n,z=1.95996398454,a=1+z*z/n,c=(p+z*z/(2*n))/a,e=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/a;return {k,n,p,lo:c-e,hi:c+e};}
const label=r=>`${pc(r.p)} <small>${r.k}/${r.n}</small>`;
const interval=r=>r.n?`${pc(r.lo)}–${pc(r.hi)}`:'No eligible dates';
const card=(title,value,sub)=>`<article class="card"><span>${title}</span><strong>${value}</strong><small>${sub}</small></article>`;
let study,selected=[],recordRows=[],page=0;
const initial='ES';
$('market').value=initial;
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
if(/^\d{4}-\d{2}-\d{2}$/.test(today))$('before').value=today;
for(let m=270;m<510;m+=30){const option=document.createElement('option');option.value=m;option.textContent=clock(m)+'–'+clock(m+29);$('bucket').append(option);}
function targetRates(rows,i){const pending=rows.filter(r=>!r.targets[i].already);return {pending:rate(pending.filter(r=>r.targets[i].hit).length,pending.length),after:rate(rows.filter(r=>r.targets[i].hit).length,rows.length),already:rows.length-pending.length};}
function stats(rows){const values=rows.map(r=>r.secondSideMultiple);return {median:quantile(values,.5),mean:mean(values),p75:quantile(values,.75),zero:rate(rows.filter(r=>r.addedBeyondKnownWidth<=EPS).length,rows.length)};}
function drawCurve(rows){
 if(!rows.length){$('curve').innerHTML='<p class="empty">No matching complete outcomes. Broaden your filters.</p>';return;}
 const W=950,H=275,left=52,right=26,top=25,bottom=44,x=i=>left+i*(W-left-right)/(study.levels.length-1),y=p=>top+(1-p)*(H-top-bottom);
 const rates=study.levels.map((_,i)=>targetRates(rows,i));
 const dots=rates.map((r,i)=>r.pending.n?`<circle cx="${x(i)}" cy="${y(r.pending.p)}" r="4" fill="#f4b66f"><title>${Math.round(study.levels[i]*100)}% new target: ${pc(r.pending.p)} (${r.pending.k}/${r.pending.n})</title></circle>`:'').join('');
 const path=rates.map((r,i)=>r.pending.n?`${i===0||!rates[i-1].pending.n?'M':'L'}${x(i)},${y(r.pending.p)}`:'').join(' ');
 $('curve').innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Probability of a new second-side target by 09:30, among targets still pending at confirmation">${[0,.25,.5,.75,1].map(p=>`<line x1="${left}" x2="${W-right}" y1="${y(p)}" y2="${y(p)}" stroke="#99b3dc25"/><text x="${left-8}" y="${y(p)+4}" text-anchor="end" fill="#b3c3da" font-size="12">${Math.round(p*100)}%</text>`).join('')}<path d="${path}" fill="none" stroke="#f4b66f" stroke-width="2.5"/>${dots}${study.levels.map((m,i)=>i%2===0?`<text x="${x(i)}" y="${H-15}" text-anchor="middle" fill="#b3c3da" font-size="12">${Math.round(m*100)}%</text>`:'').join('')}<text x="${left}" y="13" fill="#f4b66f" font-size="12">New target · each point has its own pending sample</text></svg>`;
}
function renderTargets(){
 const h=$('box-high').value.trim(),l=$('box-low').value.trim(),H=Number(h),L=Number(l),valid=h!==''&&l!==''&&Number.isFinite(H)&&Number.isFinite(L)&&H>L;
 $('level-note').textContent=valid?`Width ${num(H-L)} points ·120% extends20% beyond each edge.`:h||l?'Enter a valid high above the low.':'Enter both to show price levels.';
 $('targets').querySelector('tbody').innerHTML=study.levels.map((m,i)=>{const r=targetRates(selected,i);return `<tr><td>${Math.round(m*100)}%</td><td>${valid?num(L+m*(H-L))+' / '+num(H-m*(H-L)):'—'}</td><td><strong>${label(r.pending)}</strong></td><td>${interval(r.pending)}</td><td>${r.already}/${selected.length}</td><td>${label(r.after)}</td></tr>`;}).join('');
}
function validation(all,match){
 const rows=all.filter(r=>r.outcomeEligible&&!r.ambiguous).sort((a,b)=>a.date.localeCompare(b.date));
 return [1.2,1.5,2].map(m=>{const i=study.levels.indexOf(m);let a=[],b=[];
  for(let n=0;n<rows.length;n++){const r=rows[n];if(!match(r)||r.targets[i].already)continue;const prior=rows.slice(0,n).filter(x=>!x.targets[i].already),cohort=prior.filter(match);if(prior.length<20||cohort.length<20)continue;const p=prior.filter(x=>x.targets[i].hit).length/prior.length,q=cohort.filter(x=>x.targets[i].hit).length/cohort.length,y=Number(r.targets[i].hit);a.push((p-y)**2);b.push((q-y)**2);}
  const x=mean(a),y=mean(b);return `<tr><td>${Math.round(m*100)}%</td><td>${a.length}</td><td>${x==null?'—':x.toFixed(4)}</td><td>${y==null?'—':y.toFixed(4)}</td><td>${x==null?'—':(y-x).toFixed(4)}</td></tr>`;
 }).join('');
}
function renderDaily(){
 const pages=Math.max(1,Math.ceil(recordRows.length/25));page=Math.min(page,pages-1);
 $('record-note').textContent=`${recordRows.length} matching double-break dates. Missing outcomes remain visible and never count as zero. 120%=20% beyond the box edge.`;
 $('days').querySelector('tbody').innerHTML=recordRows.slice(page*25,(page+1)*25).map(r=>`<tr><td>${r.date}<small>${esc(r.contract)}</small></td><td>${num(r.H)} / ${num(r.L)}<small>W ${num(r.W)}</small></td><td>${r.first}<small>${clock(r.first==='U'?r.firstU:r.firstD)}</small></td><td>${r.second}<small>${clock(r.secondBar)}–${clock(r.confirmed)}</small></td><td>${clock(r.confirmed)}</td><td>${r.outcomeEligible?multiple(r.secondSideMultiple):'Excluded'}<small>${r.outcomeEligible?'Second-break direction':esc(r.outcomeExclusion)}</small></td><td>${r.outcomeEligible?multiple(r.addedBeyondKnownWidth):'—'}<small>of box width</small></td><td>${num(r.nyOpen)}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">No matching records.</td></tr>';
 $('page').textContent=`${recordRows.length?'Page '+(page+1)+' / '+pages:'No records'}`;$('prev').disabled=page===0;$('next').disabled=page>=pages-1;
}
function render(){
 if(!study)return;
 const market=$('market').value,side=$('side').value,bucket=$('bucket').value,year=$('year').value,before=$('before').value,m=study.markets[market];
 if(!/^\d{4}-\d{2}-\d{2}$/.test(before)){$('error').hidden=false;$('error').textContent='Choose a valid history cutoff date.';$('results').hidden=true;return;}
 $('error').hidden=true;$('results').hidden=false;const inBase=r=>r.date<before&&(year==='ANY'||r.year===year),direction=r=>side==='ANY'||r.second===side,match=r=>direction(r)&&(bucket==='ANY'||r.bucket===Number(bucket));
 const base=m.records.filter(inBase);recordRows=base.filter(match).sort((a,b)=>b.date.localeCompare(a.date));selected=recordRows.filter(r=>r.outcomeEligible&&!r.ambiguous);
 const url=new URL(location.href);url.searchParams.set('instrument',market);history.replaceState(null,'',url);$('back').href='./?instrument='+market;if($('orange-link'))$('orange-link').href='orange-box-fill.html?instrument='+market;$('download-all').href=`data/es/${market}-double-break-daily.csv`;
 $('incidence').innerHTML=Object.entries(study.markets).map(([k,v])=>card(k+' · both sides by 08:30',pc(v.incidence.p),`${v.both}/${v.eligible} eligible dates · ${v.from}–${v.to}<br>${v.scored} complete 09:30 outcomes`)).join('');
 const s=stats(selected);$('sample').textContent=`${market} · ${selected.length} complete matching outcomes · ${recordRows.length-selected.length} excluded outcomes · history before ${before} · target 09:30 open`;
 $('stats').innerHTML=card('Median second-side maximum',multiple(s.median),'Measured from the opposite box extreme')+card('Mean second-side maximum',multiple(s.mean),'Same rule; sensitive to extreme days')+card('75th percentile maximum',multiple(s.p75),'25% of this sample moved farther')+card('No added extreme after signal',pc(s.zero.p),`${s.zero.k}/${s.zero.n} · beyond the known second-side extreme`);
 const old=$('results').querySelector('.warning');old?.remove();if(selected.length<30){const warning=document.createElement('p');warning.className='warning';warning.textContent=selected.length?'Small sample: fewer than 30 complete dates. Read counts and intervals before comparing percentages.':'No complete matching outcomes. Try all time blocks, either direction or a later history cutoff.';$('stats').before(warning);}
 drawCurve(selected);renderTargets();
 const timing=Array.from({length:8},(_,i)=>{const at=270+i*30;return {at,n:base.filter(r=>direction(r)&&r.bucket===at).length};}),max=Math.max(1,...timing.map(x=>x.n));
 $('timing').innerHTML=timing.map(x=>`<button type="button" data-block="${x.at}" class="${bucket===String(x.at)?'selected':''}" aria-label="Select${clock(x.at)} breakout block,${x.n} dates"><span>${clock(x.at)}</span><span style="height:75px;display:flex;align-items:end;width:100%;justify-content:center"><i style="height:${Math.max(2,75*x.n/max)}px"></i></span><b>${x.n} dates</b></button>`).join('');
 $('timing').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{$('bucket').value=b.dataset.block;page=0;render();}));
 $('annual').querySelector('tbody').innerHTML=['2022','2023','2024','2025','2026'].map(y=>{const r=selected.filter(r=>r.year===y),x=targetRates(r,0),z=targetRates(r,3);return `<tr><td>${y}</td><td>${r.length}</td><td>${label(x.pending)}</td><td>${label(z.pending)}</td><td>${multiple(stats(r).median)}</td></tr>`;}).join('');
 $('validation').querySelector('tbody').innerHTML=validation(base,match);renderDaily();
 $('coverage').innerHTML=`<p>${market}: ${m.eligible}/${m.dates} dates have a complete box and qualification window; ${m.excluded.length} dates excluded. ${m.both} double breaks; ${m.ambiguous} ambiguous same-bar dual breaks; ${m.scored} complete directional outcomes.</p>${m.outcomeExcluded.length?'<p class="warning">Outcome exclusions: '+m.outcomeExcluded.map(r=>esc(r.date)+' · '+esc(r.reason)).join('; ')+'</p>':''}<details><summary>All excluded qualification dates (${m.excluded.length})</summary><ul>${m.excluded.map(r=>'<li>'+r.date+' · '+esc(r.exclusion)+'</li>').join('')}</ul></details>`;
}
$('filters').addEventListener('change',e=>{if(e.target.id==='market'){$('box-high').value='';$('box-low').value='';}page=0;render();});$('filters').addEventListener('submit',e=>e.preventDefault());$('filters').addEventListener('reset',()=>setTimeout(()=>{$('market').value=initial;$('before').value=today;page=0;render();},0));
for(const id of ['box-high','box-low'])$(id).addEventListener('input',()=>{if(study)renderTargets();});
$('prev').onclick=()=>{page--;renderDaily();};$('next').onclick=()=>{page++;renderDaily();};
$('export').onclick=()=>{const fields=['date','contract','H','L','W','first','firstU','firstD','second','secondBar','confirmed','outcomeEligible','outcomeExclusion','signalClose','nyOpen','knownSecondSideMultiple','secondSideMultiple','firstSideMultiple','postMaxEitherMultiple','addedBeyondKnownWidth'];const rows=recordRows.map(r=>({...r,firstU:r.firstU==null?'':clock(r.firstU),firstD:r.firstD==null?'':clock(r.firstD),secondBar:clock(r.secondBar),confirmed:clock(r.confirmed)}));const content=[fields.join(','),...rows.map(r=>fields.map(f=>JSON.stringify(r[f]??'')).join(','))].join('\n'),url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`SessionPath-${$('market').value}-double-break-filtered.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
try{const r=await fetch('data/es/double-break-0430-data.json');if(!r.ok)throw Error('Research measurements could not be loaded.');study=await r.json();render();}catch(e){$('incidence').textContent=e.message+' Please reload the page.';$('error').hidden=false;$('error').textContent=e.message;}
