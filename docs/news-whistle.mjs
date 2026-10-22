// A synthesized classic Twitter-style bird chirp, rather than a copied audio asset.
// Peak gain is 1.5 times the previous whistle, with soft edges and a quiet tail.
export function createNewsWhistle({AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext} = {}) {
  let context = null;
  let playingUntil = 0;
  async function unlock() {
    if (!AudioContextClass) return false;
    try {
      context ||= new AudioContextClass();
      if (context.state !== 'running') await context.resume();
      return context.state === 'running';
    } catch { return false; }
  }
  function play() {
    if (context?.state !== 'running' || context.currentTime < playingUntil) return false;
    const nodes = [];
    let disconnected = false;
    const cleanup = () => {
      if (disconnected) return;
      disconnected = true;
      for (const node of nodes) { try { node.disconnect(); } catch {} }
    };
    try {
      const start = context.currentTime;
      const duration = 1.15;
      const tone = context.createOscillator();
      nodes.push(tone);
      const envelope = context.createGain();
      nodes.push(envelope);
      const flutter = context.createOscillator();
      nodes.push(flutter);
      const flutterDepth = context.createGain();
      nodes.push(flutterDepth);
      tone.type = 'sine';
      // Two quick rising/falling syllables make a bird-like "tweet-tweet".
      tone.frequency.setValueAtTime(1650, start);
      tone.frequency.exponentialRampToValueAtTime(3050, start + .07);
      tone.frequency.exponentialRampToValueAtTime(2350, start + .22);
      tone.frequency.setValueAtTime(2050, start + .34);
      tone.frequency.exponentialRampToValueAtTime(3350, start + .41);
      tone.frequency.exponentialRampToValueAtTime(2650, start + .58);
      tone.frequency.exponentialRampToValueAtTime(2900, start + .72);
      tone.frequency.exponentialRampToValueAtTime(2150, start + duration);
      flutter.frequency.value = 32;
      flutterDepth.gain.value = 11;
      flutter.connect(flutterDepth).connect(tone.frequency);
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(.0675, start + .025);
      envelope.gain.exponentialRampToValueAtTime(.001, start + .22);
      envelope.gain.linearRampToValueAtTime(0, start + .25);
      envelope.gain.setValueAtTime(0, start + .34);
      envelope.gain.linearRampToValueAtTime(.0675, start + .365);
      envelope.gain.exponentialRampToValueAtTime(.012, start + .73);
      envelope.gain.exponentialRampToValueAtTime(.0001, start + duration - .025);
      envelope.gain.linearRampToValueAtTime(0, start + duration);
      tone.connect(envelope).connect(context.destination);
      tone.onended = cleanup;
      tone.start(start); flutter.start(start);
      tone.stop(start + duration); flutter.stop(start + duration);
      playingUntil = start + duration;
      return true;
    } catch {
      for (const node of nodes) { try { node.stop?.(); } catch {} }
      cleanup();
      return false;
    }
  }
  return {unlock, play, get ready() { return context?.state === 'running'; }};
}
