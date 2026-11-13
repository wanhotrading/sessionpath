import {gcAutofillConvention} from './gc-convention.mjs';
// GC-only development staging. Unknown markets fail closed.
export const instruments=Object.freeze({GC:Object.freeze({id:'GC',name:'Gold',roots:['GC','MGC'],tickSize:.1,pointValue:100,tickValue:10,microPointValue:10,microTickValue:1,forecastPrefix:'SPGC1',expansionPrefix:'SPGC2',snapshotPrefix:'GCPI1',returnPrefix:'GBPR1',indicatorLabel:'GC / MGC v1.2',indicatorFile:'data/gc/session-path-gc-v1.2.pine',indicatorDownload:'SessionPath-GC-v1.2.pine',dataDirectory:'data/gc/',autofillConvention:gcAutofillConvention})});
export function resolveInstrument(value){if(value==null||value==='')value='GC';if(!Object.hasOwn(instruments,value))throw Error('Use the market selector to open this instrument’s own SessionPath workflow.');return instruments[value];}
export const instrument=resolveInstrument(typeof location==='undefined'?'GC':new URL(location.href).searchParams.get('instrument'));
export const dataPath=file=>instrument.dataDirectory+file;
export const assetPath=file=>instrument.dataDirectory+file;
export const storageKey=base=>base+':GC';
export const indicatorFile=()=>instrument.indicatorFile;
export function mountInstrumentSelector(){document.body.dataset.instrument='GC';const label=document.createElement('label');label.className='market-selector';label.textContent='Market';const select=document.createElement('select');select.id='instrument-select';select.setAttribute('aria-label','Market');for(const[id,name]of[['CL','Crude oil'],['NQ','Nasdaq-100'],['ES','S&P 500'],['GC','Gold']]){const option=document.createElement('option');option.value=id;option.textContent=id+' · '+name;select.append(option);}select.value='GC';select.addEventListener('change',()=>{
  const nextMarket=select.value;
  if(nextMarket==='GC')return;
  const target=new URL(nextMarket==='ES'?'../es/':'../',location.href);
  target.searchParams.set('instrument',nextMarket);
  const transition={instrument:nextMarket};
  document.dispatchEvent(new CustomEvent('sessionpath:instrument-change',{detail:transition}));
  saveMarketInputs();
  Promise.resolve(transition.finished).finally(()=>location.assign(target.href));
 });label.append(select);document.querySelector('.top-actions')?.prepend(label);const heading=document.querySelector('.page-heading h1');if(heading)heading.textContent='GC';for(const input of document.querySelectorAll('input[type="number"][step="0.01"]'))input.step='0.1';for(const a of document.querySelectorAll('a[data-indicator-installer],a[href="session-path-v5.pine"]')){a.href=instrument.indicatorFile;a.download=instrument.indicatorDownload;a.textContent='Indicator '+instrument.indicatorLabel;}window.addEventListener('pagehide',saveMarketInputs);}
const fieldSelector='main input[id]:not([type="file"]):not([type="hidden"]),main select[id],dialog input[id]:not([type="file"]),dialog select[id]';
export function saveMarketInputs(){try{const fields={};for(const el of document.querySelectorAll(fieldSelector)){if(el.readOnly||el.disabled)continue;fields[el.id]=el.type==='checkbox'?el.checked:el.value;}localStorage.setItem(storageKey('sessionpath-market-inputs-v1'),JSON.stringify(fields));}catch{}}
export function restoreMarketInputs(){try{const fields=JSON.parse(localStorage.getItem(storageKey('sessionpath-market-inputs-v1'))||'{}');for(const[id,value]of Object.entries(fields)){const el=document.getElementById(id);if(!el||el.type==='file'||el.readOnly)continue;if(el.type==='checkbox')el.checked=Boolean(value);else el.value=value;}}catch{}}
