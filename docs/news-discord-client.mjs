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

export function discordConnectionView({state='disconnected',hasKey=false}={}) {
  if(!hasKey)return {label:'Connect Discord',detail:'Discord listener required',help:'Connect the listener on this PC using its private connection key. FinancialJuice RSS stays paused.',stale:false,canRetry:false};
  if(state==='connected')return {label:'Connected · Discord',detail:'Push from your PC',help:'FinancialJuice headlines arrive through your Discord bot. RSS requests stay paused.',stale:false,canRetry:false};
  if(state==='connecting')return {label:'Connecting to listener…',detail:'Discord push · RSS paused',help:'Allow this site to connect to your local listener if your browser asks.',stale:false,canRetry:false};
  if(state==='unauthorized')return {label:'Connection key rejected',detail:'Discord push · RSS paused',help:'Disconnect Discord and enter the listener’s private connection key again. Do not enter the Discord bot token.',stale:true,canRetry:false};
  if(state==='forbidden')return {label:'Local connection denied',detail:'Discord push · RSS paused',help:'The listener denied this website. Check its allowed website origins, then retry Discord.',stale:true,canRetry:true};
  if(state==='invalid')return {label:'Listener update required',detail:'Discord push · RSS paused',help:'Restart the current SessionPath listener; its feed could not be read.',stale:true,canRetry:true};
  if(state==='waiting')return {label:'Discord reconnecting',detail:'Discord push · RSS paused',help:'The local listener is reachable, but its Discord bot is reconnecting. Check the listener status.',stale:true,canRetry:true};
  return {label:'Listener unavailable · retrying',detail:'Discord push · RSS paused',help:'Start the SessionPath listener on this PC and allow local network access in your browser. Reconnection is automatic.',stale:true,canRetry:true};
}

export function connectPrivateNews({baseURL='http://127.0.0.1:4186',accessKey,onFeed,onStatus=()=>{},fetchImpl=fetch,setTimer=setTimeout,clearTimer=clearTimeout,connectTimeoutMs=8_000,streamTimeoutMs=60_000}) {
  const url=new URL(baseURL);
  if(url.protocol!=='http:' || !['127.0.0.1','localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname!=='/')throw Error('The prepared listener only connects to your own PC.');
  if(typeof accessKey!=='string' || accessKey.length<32)throw Error('A private relay read key is required.');
  let stopped=false,controller,timer,attempt=0,generation=0;
  async function connect(requestGeneration=generation){
    const active=()=>!stopped && generation===requestGeneration;
    const requestController=new AbortController();controller=requestController;let watchdog;
    const keepAlive=(timeout=streamTimeoutMs)=>{clearTimer(watchdog);watchdog=setTimer(()=>requestController.abort(),timeout);};
    try{
      if(!active())return;
      onStatus('connecting');keepAlive(connectTimeoutMs);
      const response=await fetchImpl(new URL('/v1/financialjuice/events',url),{headers:{Authorization:`Bearer ${accessKey}`},signal:requestController.signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
      if(!active())return;
      if(response.status===401 || response.status===403){stopped=true;onStatus(response.status===401?'unauthorized':'forbidden');return;}
      if(!response.ok || !response.body)throw Error('Relay unavailable.');
      // HTTP success alone does not establish that the Discord bot is ready.
      for await(const message of readEvents(response.body)){
        if(!active())break;keepAlive();attempt=0;
        if(message.event==='feed' && message.data?.version===1 && Array.isArray(message.data.records) && message.data.records.length<=400){
          onFeed(message.data);onStatus(message.data.status?.connected===true?'connected':'waiting');
        }
        if(message.event==='heartbeat')onStatus(message.data.connected===true?'connected':'waiting');
      }
    }catch{if(active())onStatus('reconnecting');}
    finally{clearTimer(watchdog);if(active()){onStatus('reconnecting');timer=setTimer(()=>connect(requestGeneration),Math.min(30_000,1000*2**Math.min(attempt++,5)));}}
  }
  function cancel(){generation+=1;clearTimer(timer);controller?.abort();}
  void connect();
  return {
    stop(){stopped=true;cancel();onStatus('disconnected');},
    reconnect(){cancel();stopped=false;attempt=0;void connect();}
  };
}
