// Staged client for SessionPath. No Discord bot credential enters the browser.
// The separate read key is provided by the owner at runtime, never hardcoded.
export async function* readEvents(body) {
  const reader=body.getReader();const decoder=new TextDecoder();let buffer='';
  try {
    while(true){
      const {done,value}=await reader.read();if(done)break;
      buffer+=decoder.decode(value,{stream:true});
      if(buffer.length>1024*1024)throw Error('Relay message too large.');
      let end;
      while((end=buffer.indexOf('\n\n'))>=0){
        const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);
        const lines=frame.split('\n');
        const event=lines.find(v=>v.startsWith('event:'))?.slice(6).trim();
        const data=lines.filter(v=>v.startsWith('data:')).map(v=>v.slice(5).trim()).join('\n');
        if(event && data)yield {event,data:JSON.parse(data)};
      }
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

export function connectPrivateNews({baseURL='http://127.0.0.1:4186',accessKey,onFeed,onStatus=()=>{},fetchImpl=fetch}) {
  const url=new URL(baseURL);
  if(url.protocol!=='http:' || !['127.0.0.1','localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname!=='/')throw Error('The prepared listener only connects to your own PC.');
  if(typeof accessKey!=='string' || accessKey.length<32)throw Error('A private relay read key is required.');
  let stopped=false,controller,timer,attempt=0;
  async function connect(){
    controller=new AbortController();let watchdog;
    const keepAlive=()=>{clearTimeout(watchdog);watchdog=setTimeout(()=>controller.abort(),60_000);};
    try{
      onStatus('connecting');keepAlive();
      const response=await fetchImpl(new URL('/v1/financialjuice/events',url),{headers:{Authorization:`Bearer ${accessKey}`},signal:controller.signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
      if(response.status===401 || response.status===403){stopped=true;throw Error('Relay access denied.');}
      if(!response.ok || !response.body)throw Error('Relay unavailable.');
      attempt=0;onStatus('connected');
      for await(const message of readEvents(response.body)){
        if(stopped)break;keepAlive();
        if(message.event==='feed' && message.data?.version===1 && Array.isArray(message.data.records) && message.data.records.length<=400)onFeed(message.data);
        if(message.event==='heartbeat')onStatus(message.data.connected?'connected':'reconnecting');
      }
    }catch{if(!stopped)onStatus('reconnecting');else onStatus('disconnected');}
    finally{clearTimeout(watchdog);if(!stopped){onStatus('reconnecting');timer=setTimeout(connect,Math.min(30_000,1000*2**Math.min(attempt++,5)));}}
  }
  void connect();
  return {stop(){stopped=true;clearTimeout(timer);controller?.abort();onStatus('disconnected');}};
}
