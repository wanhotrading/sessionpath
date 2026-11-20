import { currentNYStep, lastStep } from './core.mjs?v=conditional-20261119';
import { nyClockParts } from '../ny-online-clock.mjs?v=automatic-bbox-20261118';

export function mountDashboardTiming(host, { market, replay, getLatest }) {
  let timer, started = false, panel;
  async function load() {
    try {
      const {mountLiveTimingPanel} = await import('./live-panel.mjs?v=overnight-hours-20261120');
      panel = mountLiveTimingPanel(host, {market, replay});
      const packet = getLatest();
      if (packet) panel.receive(packet);
    } catch {
      host.className = 'overnight-timing-panel';
      const link = document.createElement('a');
      link.className = 'quiet';
      link.textContent = 'Open overnight breach timing';
      link.href = new URL('./?instrument='+market, import.meta.url).href;
      host.replaceChildren(link);
    }
  }
  function sync() {
    clearTimeout(timer);
    const now = Date.now();
    const clock = nyClockParts(now);
    const step = currentNYStep(clock);
    host.hidden = step === null || step >= lastStep;
    if (!host.hidden) {
      if (!started) {
        started = true;
        void load();
      } else panel?.refresh();
    }
    const cutoff = 8 * 60 + 30, reopen = 18 * 60;
    const next = clock.minute < cutoff ? cutoff : clock.minute < reopen ? reopen : cutoff + 1440;
    // Recheck the local clock across daylight-saving changes and timer suspension.
    timer = setTimeout(sync, Math.min(3600000, (next - clock.minute) * 60000 - now % 60000));
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  window.addEventListener('pageshow', sync);
  window.addEventListener('pagehide', () => clearTimeout(timer));
  sync();
}
