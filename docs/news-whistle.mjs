// Plays the downloaded classic Twitter clip. No oscillators or generated whistle.
export function createNewsWhistle({AudioContextClass=globalThis.AudioContext||globalThis.webkitAudioContext, fetchImpl=globalThis.fetch}={}) {
  let context=null, buffer=null, pending=null, playingUntil=0, error='';
  async function unlock() {
    try {
      if (!AudioContextClass) return false;
      context ??= new AudioContextClass();
      // Resume immediately in the click handler, before waiting for the download.
      const resumed=context.resume();
      if (!buffer && !pending) pending=(async()=>{
        const response=await fetchImpl(new URL('./assets/audio/twitter-notification.mp3',import.meta.url));
        if(!response.ok) throw Error('The notification sound could not be downloaded.');
        buffer=await context.decodeAudioData(await response.arrayBuffer());
      })().finally(()=>{pending=null;});
      await Promise.all([resumed,pending]); error='';
      return context.state==='running' && !!buffer;
    } catch {error='Sound unavailable — click Test alert to retry.';return false;}
  }
  function play() {
    if (!context || context.state!=='running' || !buffer || context.currentTime<playingUntil) return false;
    const nodes=[];
    try {
      const source=context.createBufferSource();nodes.push(source);
      const gain=context.createGain();nodes.push(gain);
      const limiter=context.createDynamicsCompressor();nodes.push(limiter);source.buffer=buffer;
      gain.gain.value=1.5; // Requested 50% gain, limited to avoid digital clipping.
      limiter.threshold.value=-3;limiter.knee.value=0;limiter.ratio.value=20;limiter.attack.value=.003;limiter.release.value=.12;
      source.connect(gain);gain.connect(limiter);limiter.connect(context.destination);
      let cleaned=false;source.onended=()=>{if(cleaned)return;cleaned=true;nodes.forEach(node=>node.disconnect());};
      source.start();playingUntil=context.currentTime+buffer.duration;return true;
    } catch {nodes.forEach(node=>{try{node.disconnect();}catch{}});error='Sound could not play — click Test alert to retry.';return false;}
  }
  return {unlock,play,get ready(){return context?.state==='running'&&!!buffer;},get error(){return error;}};
}
