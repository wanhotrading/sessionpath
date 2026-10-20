import {instrument} from './instrument.mjs';

const endpoint='https://raw.githubusercontent.com/wanhotrading/sessionpath/live-data/context.json';
const $=id=>document.getElementById(id);
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});
const value=id=>$(id)?.value??'';
export function validateAutoFill(result,{date,cutoff,market,now=Date.now()}){
 if(!result||result.status!=='ready')throw Error(result?.error||'Delayed data is not ready. Try again later.');
 if(result.date!==date||result.cutoff!==cutoff||result.market!==market)throw Error('The feed does not match this market, date and cutoff.');
 if(result.source!=='Yahoo Finance'||result.continuous!==false||!new RegExp('^'+market+'[FGHJKMNQUVXZ]\\d{4}$').test(result.contract||''))throw Error('The front-month contract could not be verified.');
 if(!Number.isFinite(Date.parse(result.generatedAt))||Date.parse(result.generatedAt)>now+60000||now-Date.parse(result.generatedAt)>24*3600000)throw Error('The delayed-data snapshot is stale.');
 const data=result.values;
 if(!data||!['priorLow','priorHigh','open1930','rangeHigh','rangeLow','up','down'].every(k=>typeof data[k]==='number'&&Number.isFinite(data[k])))throw Error('The source returned incomplete prices.');
 if(!(data.priorHigh>data.priorLow&&data.rangeHigh>=data.open1930&&data.rangeLow<=data.open1930&&data.rangeHigh>=data.rangeLow&&data.up>=0&&data.down>=0))throw Error('The source returned inconsistent session prices.');
 if(Math.abs(data.up-(data.rangeHigh-data.open1930))>1e-6||Math.abs(data.down-(data.open1930-data.rangeLow))>1e-6)throw Error('The 19:30 excursions could not be verified.');
 return data;
}

export function mountAutoFill(){
 const panel=document.querySelector('.input-more');
 if(!panel||$('context-auto-fill'))return;
 const row=document.createElement('div');row.className='context-auto-fill-row';
 const button=document.createElement('button');button.type='button';button.id='context-auto-fill';button.className='quiet';button.textContent='auto-fill';
 button.title='Yahoo Finance delayed front-month futures · prior NY 09:30–16:00 and 19:30 to the selected cutoff. Requires complete five-minute candles.';
 row.append(button);panel.querySelector('fieldset').before(row);
 const popup=document.createElement('div');popup.id='auto-fill-popup';popup.className='auto-fill-popup';popup.hidden=true;popup.setAttribute('aria-live','polite');document.body.append(popup);
 let fade,hide,reading=false;
 function notify(message,error=false){
  clearTimeout(fade);clearTimeout(hide);popup.textContent=message;popup.dataset.error=String(error);popup.setAttribute('role',error?'alert':'status');popup.hidden=false;popup.classList.remove('auto-fill-fade');
  fade=setTimeout(()=>popup.classList.add('auto-fill-fade'),1300);hide=setTimeout(()=>{popup.hidden=true;popup.textContent='';},1500);
 }
 button.addEventListener('click',async()=>{
  if(reading)return;
  const date=value('trading-date'),cutoff=value('asof'),units=value('ud-units'),avr=value('avr');
  if(date!==today()||$('replay-toggle')?.checked){notify('Auto-fill uses today’s front-month contract. Turn Replay off.',true);return;}
  if(units==='percent'&&!(Number(avr)>0)){notify('Enter a positive AVR before filling U/D percentages.',true);return;}
  reading=true;button.disabled=true;button.textContent='Reading…';
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{
   const response=await fetch(endpoint+'?v='+Date.now(),{signal:controller.signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
   if(!response.ok)throw Error('Could not read the delayed-data source. Try again later.');
   const snapshot=await response.json();
   if(snapshot.schema!=='sessionpath.autofill.v1')throw Error('The delayed-data source is unavailable.');
   const result=snapshot.markets?.[instrument.id]?.[cutoff];
   const data=validateAutoFill(result,{date,cutoff,market:instrument.id});
   if(value('trading-date')!==date||value('asof')!==cutoff||value('ud-units')!==units||value('avr')!==avr||$('replay-toggle')?.checked)throw Error('Inputs changed while reading. Click auto-fill again.');
   const multiplier=units==='percent'?100/Number(avr):1;
   const updates={'prior-low':data.priorLow,'prior-high':data.priorHigh,open1930:data.open1930,'range-high':data.rangeHigh,'range-low':data.rangeLow,up:data.up*multiplier,down:data.down*multiplier};
   const targets=Object.keys(updates).map(id=>$(id));if(targets.some(e=>!e))throw Error('The session inputs are not ready. Reload and try again.');
   for(const [id,number]of Object.entries(updates))$(id).value=String(Number(number.toFixed(6)));
   $('open1930').dispatchEvent(new Event('change',{bubbles:true}));
   button.title=`Yahoo Finance · ${result.contract} · ${date} · through ${cutoff} New York · delayed data`;
   notify(`Done! ${result.contract} · ${cutoff} NY`);
  }catch(error){notify(error.name==='AbortError'?'The delayed-data source timed out. Try again.':error.message||'Auto-fill failed. Try again.',true);}
  finally{clearTimeout(timeout);reading=false;button.disabled=false;button.textContent='auto-fill';}
 });
}

if(typeof document!=='undefined')mountAutoFill();
