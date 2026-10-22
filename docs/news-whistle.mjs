// A short, softly faded whistle; no downloaded audio or microphone access.
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
    try {
      const start = context.currentTime;
      const duration = 1.15;
      const tone = context.createOscillator();
      const envelope = context.createGain();
      const flutter = context.createOscillator();
      const flutterDepth = context.createGain();
      tone.type = 'sine';
      tone.frequency.setValueAtTime(2250, start);
      tone.frequency.exponentialRampToValueAtTime(2930, start + .23);
      tone.frequency.exponentialRampToValueAtTime(2640, start + .95);
      flutter.frequency.value = 25;
      flutterDepth.gain.value = 14;
      flutter.connect(flutterDepth).connect(tone.frequency);
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(.045, start + .09);
      envelope.gain.setValueAtTime(.036, start + .4);
      envelope.gain.exponentialRampToValueAtTime(.001, start + duration);
      tone.connect(envelope).connect(context.destination);
      tone.onended = () => {
        tone.disconnect(); envelope.disconnect(); flutter.disconnect(); flutterDepth.disconnect();
      };
      tone.start(start); flutter.start(start);
      tone.stop(start + duration); flutter.stop(start + duration);
      playingUntil = start + duration;
      return true;
    } catch { return false; }
  }
  return {unlock, play, get ready() { return context?.state === 'running'; }};
}
