// Bounded recovery for static research assets. Never substitute missing research.
export async function loadAsset(url,{format='json',timeout=20000,attempts=2,fetcher=fetch}={}){
 let error;
 for(let attempt=0;attempt<attempts;attempt++){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
   const response=await fetcher(url,{signal:controller.signal,...(attempt?{cache:'reload'}:{})});
   if(!response.ok)throw Error(`Could not load ${String(url).split('/').pop()} (${response.status}).`);
   return await response[format]();
  }catch(e){error=e;}finally{clearTimeout(timer);}
 }
 throw Error(`Could not load ${String(url).split('/').pop()}. Check your connection and try again.`,{cause:error});
}
export const yieldToBrowser=()=>new Promise(resolve=>setTimeout(resolve,0));
