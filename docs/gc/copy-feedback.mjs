const timers=new WeakMap();
export function flashCopyStatus(element,message,duration=2000){
 if(!element)return;
 const old=timers.get(element);if(old){clearTimeout(old.fade);clearTimeout(old.clear);}
 element.classList.remove('copy-faded');element.classList.add('copy-feedback');element.textContent=message;
 if(duration<=0){timers.delete(element);return;}
 const current={};timers.set(element,current);
 current.fade=setTimeout(()=>{if(timers.get(element)!==current)return;element.classList.add('copy-faded');current.clear=setTimeout(()=>{if(timers.get(element)!==current)return;element.textContent='';element.classList.remove('copy-faded');timers.delete(element);},200);},duration);
}
