// Keep module/network failures visible instead of leaving an empty dashboard.
const root=document.documentElement;
root.dataset.startup='loading';
const syncVisibility=()=>{root.dataset.pageHidden=String(document.hidden);};
syncVisibility();document.addEventListener('visibilitychange',syncVisibility);
function recovery(message){
 const status=document.getElementById('startup-recovery');if(status)return;
 const box=document.createElement('div');box.id='startup-recovery';box.className='notice';box.setAttribute('role','status');
 const text=document.createElement('p');text.textContent=message;
 const retry=document.createElement('button');retry.type='button';retry.className='quiet';retry.textContent='Retry loading';retry.onclick=()=>location.reload();
 box.append(text,retry);document.getElementById('dataset-status').after(box);
}
const timer=setTimeout(()=>{if(root.dataset.startup!=='ready')recovery('Loading is taking longer than usual. Your saved inputs are safe.');},45000);
try{await import('./app-v5.js?v=fast-switch-20261126');}
catch(error){
 console.error('SessionPath startup:',error);
 const key='sessionpath-module-retry:'+location.pathname;
 let retry=false;
 if(navigator.onLine && /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i.test(error.message)){
  try{
   if(Date.now()-Number(sessionStorage.getItem(key)||0)>90000){
    sessionStorage.setItem(key,String(Date.now()));retry=true;
   }
  }catch{}
 }
 if(retry)location.reload();
 else{
  root.dataset.startupError='A dashboard component could not load. Please retry.';
  root.dataset.startup='failed';
  recovery(root.dataset.startupError);
 }
}
finally{clearTimeout(timer);}
