import {mountMarketEmblem} from './market-emblem.mjs';
// Market configuration is resolved once per page load; switching reloads isolated state.
export const instruments = Object.freeze({
 CL: Object.freeze({id:'CL',name:'Crude oil',roots:['CL','MCL'],tickSize:.01,forecastPrefix:'SP5',expansionPrefix:'SP6',snapshotPrefix:'SPI1',returnPrefix:'BPR1',indicatorLabel:'CL / MCL v6.9',indicatorFile:'session-path-cl-v6.9.pine',indicatorDownload:'SessionPath-CL-v6.9.pine'}),
 NQ: Object.freeze({id:'NQ',name:'Nasdaq-100',roots:['NQ','MNQ'],tickSize:.25,forecastPrefix:'SPNQ1',expansionPrefix:'SPNQ2',snapshotPrefix:'NSPI1',returnPrefix:'NBPR1',indicatorLabel:'NQ / MNQ v1.3',indicatorFile:'data/nq/session-path-nq-v1.3.pine',indicatorDownload:'SessionPath-NQ-v1.3.pine'})
});
export function resolveInstrument(value){return Object.hasOwn(instruments,value)?instruments[value]:instruments.CL;}
const selected=typeof location==='undefined'?'CL':new URL(location.href).searchParams.get('instrument');
export const instrument=resolveInstrument(selected);
export const dataPath=file=>instrument.id==='NQ'?'data/nq/'+file:'data/'+file;
export const assetPath=file=>instrument.id==='NQ'?'data/nq/'+file:file;
export const storageKey=base=>instrument.id==='NQ'?base+':NQ':base;
export const indicatorFile=()=>instrument.indicatorFile;
export function mountInstrumentSelector(){
 document.body.dataset.instrument=instrument.id;
 mountMarketEmblem(instrument.id);
 const label=document.createElement('label');label.className='market-selector';label.textContent='Market';
 const select=document.createElement('select');select.id='instrument-select';select.setAttribute('aria-label','Market');
 for(const c of Object.values(instruments)){const option=document.createElement('option');option.value=c.id;option.textContent=c.id+' · '+c.name;select.append(option);}select.value=instrument.id;label.append(select);
 document.querySelector('.top-actions').prepend(label);
 select.addEventListener('change',()=>{saveMarketInputs();const url=new URL(location.href);url.searchParams.set('instrument',select.value);location.assign(url.href);});
 document.querySelector('.ambient-footer span').textContent=instrument.id+' / RESEARCH WORKSPACE';
 document.querySelector('.page-heading h1').textContent=instrument.id;
 document.querySelector('meta[name="description"]').content='SessionPath '+instrument.id+' futures: AVR-normalized forecasts and historical compression, expansion and BBOX returns.';
 for(const a of document.querySelectorAll('a[href="session-path-v5.pine"]')){a.href=instrument.indicatorFile;a.download=instrument.indicatorDownload;a.textContent='Indicator '+instrument.indicatorLabel;}
 if(instrument.id==='NQ'){
  for(const text of document.querySelectorAll('#indicator-section .compact-note'))text.textContent=text.textContent.replaceAll('v6.6',instrument.indicatorLabel);
  for(const input of document.querySelectorAll('input[type="number"][step="0.01"]'))input.step='.25';
  document.getElementById('price').placeholder='25000.00';document.getElementById('avr').placeholder='320.00';
  const note=document.createElement('p');note.className='market-note compact-note';note.textContent='NQ database · 2022-01-03–2026-10-15 · quarterly contracts · 0.25-point tick. Forecasts use earlier dates only. Daily indicator screenshots are still pending.';document.querySelector('.page-heading').append(note);
 }
 window.addEventListener('pagehide',saveMarketInputs);
}
const fieldSelector='main input[id]:not([type="file"]):not([type="hidden"]), main select[id], dialog input[id]:not([type="file"]), dialog select[id]';
export function saveMarketInputs(){try{const fields={};for(const el of document.querySelectorAll(fieldSelector)){if(el.readOnly||el.disabled)continue;fields[el.id]=el.type==='checkbox'?el.checked:el.value;}localStorage.setItem(storageKey('sessionpath-market-inputs-v1'),JSON.stringify(fields));}catch{}}
export function restoreMarketInputs(){try{const fields=JSON.parse(localStorage.getItem(storageKey('sessionpath-market-inputs-v1'))||'{}');for(const [id,value]of Object.entries(fields)){const el=document.getElementById(id);if(!el||el.type==='file'||el.readOnly)continue;if(el.type==='checkbox')el.checked=Boolean(value);else el.value=value;}}catch{}}
