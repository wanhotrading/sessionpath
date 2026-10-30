import {instrument} from './instrument.mjs';
import {computeNYDirectionAutofill,computeNYCloseArchiveAutofill} from './ny-direction-autofill-core.mjs';

let research=null;
let clHistory;
let lastFill=null,watching=false;
export const directionFieldIDs=['util-three-up','util-three-down','util-five-up','util-five-down','ny-strength-three','ny-strength-five'];
const $=id=>document.getElementById(id);

export function configureNYDirectionAutoFill(days,timeline){research={days,timeline};}

export function mountNYDirectionAutoFillStatus(){
 for(const id of ['ny-strength-three','ny-strength-five']){
  const select=$(id);
  if(select&&!select.querySelector('option[value="TIE"]')){
   const option=document.createElement('option');option.value='TIE';option.textContent='Tie';select.append(option);
  }
 }
 for(const [id,parent,text]of [
  ['ny-util-autofill-status','util-direction-context','08:30 Auto-fill also calculates these completed windows. Enter the same frozen AVR used for their Mean forecasts.'],
  ['ny-close-autofill-status','ny-close-archive','08:30 Auto-fill also counts each completed five-minute close.']
 ]){
  if($(id)||!$(parent))continue;
  const note=document.createElement('p');note.id=id;note.className='compact-note ny-direction-autofill-status';note.setAttribute('role','status');note.textContent=text;
  $(parent).querySelector('summary').after(note);
 }
 if(!watching&&$('ny-avr')){
  watching=true;
  const check=()=>{
   if(!lastFill)return;
   const date=$('trading-date')?.value||$('ny-date')?.value,changedDate=date!==lastFill.date,changedAVR=Number($('ny-avr')?.value)!==lastFill.avr;
   if(!changedDate&&!changedAVR)return;
   for(const id of changedDate?directionFieldIDs:directionFieldIDs.slice(0,4)){
    if($(id)&&$(id).value===lastFill.values[id])$(id).value='';
   }
   if($('ny-util-autofill-status'))$('ny-util-autofill-status').textContent=(changedDate?'Date':'Frozen AVR')+' changed. Auto-fill again to recalculate U/D usage.';
   if(changedDate&&$('ny-close-autofill-status'))$('ny-close-autofill-status').textContent='Date changed. Auto-fill again for this date’s completed closes.';
   if(changedDate)lastFill=null;
   for(const id of directionFieldIDs.slice(0,4))$(id)?.dispatchEvent(new Event('input',{bubbles:true}));
   $('ny-strength-five')?.dispatchEvent(new Event('change',{bubbles:true}));
  };
  for(const id of ['ny-avr','ny-date','trading-date','replay-date','replay-toggle'])for(const event of ['input','change'])$(id)?.addEventListener(event,check);
 }
}

export async function directionFillPlan(result,{date,avr}){
 if(result.nyDirection?.contract!==result.contract)throw Error('The direction observations do not identify the same front-month contract.');
 const archive=computeNYCloseArchiveAutofill({market:instrument.id,date,nyDirection:result.nyDirection});
 if(!(Number.isFinite(avr)&&avr>0))return {...archive,complete:false,utilizationError:'Candle counts filled. Enter a positive frozen AVR in New York outlook, then Auto-fill again for U/D usage.'};
 if(!research)return {...archive,complete:false,utilizationError:'Candle counts filled. The forecast history is still loading; try Auto-fill again for U/D usage.'};
 try{
  if(instrument.id==='CL')clHistory??=fetch(new URL('./ny-direction-cl-history.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('The CL utilization reference could not be loaded.');return r.json();}).catch(e=>{clHistory=null;throw e;});
  return {...computeNYDirectionAutofill({market:instrument.id,date,avr,nyDirection:result.nyDirection,...research,clHistory:instrument.id==='CL'?await clHistory:undefined}),complete:true};
 }
 catch(error){return {...archive,complete:false,utilizationError:'Candle counts filled. U/D usage unavailable: '+error.message};}
}

export function applyDirectionFill(plan,{date,contract,avr}){
 mountNYDirectionAutoFillStatus();
 const targets=[];
 for(const id of Object.keys(plan.updates))if(!directionFieldIDs.includes(id)||!$(id))throw Error('The NY direction fields are not ready. Reload and try again.');
 for(const [id,value]of Object.entries(plan.updates)){
  $(id).value=String(value);targets.push($(id));
 }
 const source=`${contract} · ${date} · completed windows only.`;
 $('ny-close-autofill-status').textContent=source+' '+['three','five'].map((key,i)=>{
  const w=plan.windows[key],c=w.counts;
  return `${i?'05:00–08:30':'03:00–05:00'}: ${c.up} U / ${c.down} D / ${c.equal} unchanged.`;
 }).join(' ');
 $('ny-util-autofill-status').textContent=plan.complete?
  source+` Frozen AVR ${avr}. Earlier-date Mean forecasts; 03:00 ${plan.windows.three.cases} matches, 05:00 ${plan.windows.five.cases} matches. Manual custom boxes can use different widths.`:
  plan.utilizationError;
 if(!plan.complete){
  // Invalidate previous generated usage, without erasing the user's manual box.
  for(const id of directionFieldIDs.slice(0,4))if($(id)&&lastFill?.values[id]===$(id).value)$(id).value='';
  $('ny-util-autofill-status').textContent+=' Existing manual usage entries were kept.';
 }
 for(const id of ['util-three-up','util-three-down','util-five-up','util-five-down'])if($(id))$(id).dispatchEvent(new Event('input',{bubbles:true}));
 lastFill={date,avr,values:Object.fromEntries(Object.keys(plan.updates).map(id=>[id,$(id)?.value]))};
 return targets;
}

export function directionFillUnavailable(message){
 mountNYDirectionAutoFillStatus();
 for(const id of ['ny-util-autofill-status','ny-close-autofill-status'])if($(id))$(id).textContent='Not filled: '+message+' Existing entries were kept.';
}
