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
try{await import('./app-v5.js?v=startup-20261023');}
catch(error){console.error('SessionPath startup:',error);root.dataset.startup='failed';recovery('SessionPath could not finish loading. Please retry.');}
finally{clearTimeout(timer);}
