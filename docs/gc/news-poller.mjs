const MIN_PAUSE_MS = 1_000;
const MAX_BACKOFF_MS = 300_000;
const MAX_RETRY_AFTER_MS = 3_600_000;

/** Independent publisher clocks: a slow or failed publisher cannot delay another.
 * refresh() skips in-flight requests; stop() invalidates even loaders that ignore
 * their AbortSignal. Timers and clocks are injectable for deterministic checks.
 */
export function createNewsPoller({
  sources = [], loadSource, onResult = () => {}, onActivity = () => {},
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout
} = {}) {
  if (typeof loadSource !== 'function') throw new TypeError('A news source loader is required.');
  const entries = new Map();
  for (const source of sources) {
    if (!source || typeof source.id !== 'string' || !source.id || entries.has(source.id)) throw new TypeError('News source IDs must be unique.');
    const pollMs = Number.isFinite(source.pollMs) && source.pollMs > 0 ? Math.max(MIN_PAUSE_MS, source.pollMs) : 10_000;
    const paused = source.paused === true;
    entries.set(source.id, {source, pollMs, paused, failures: 0, timer: null, controller: null, nextAt: null, retryNotBefore: null, startedAt: null, lastCompletedAt: null, status: paused ? 'paused' : null});
  }
  let running = false;
  let generation = 0;

  const pending = () => [...entries.values()].filter(entry => entry.controller).map(entry => entry.source.id);
  // UI hooks must not break the publisher clocks if a renderer fails.
  function activity() { try { onActivity(pending()); } catch {} }
  function clearScheduled(entry) {
    if (entry.timer !== null) clearTimer(entry.timer);
    entry.timer = null;
    entry.nextAt = null;
  }
  function schedule(entry, nextAt, requestGeneration) {
    if (!running || generation !== requestGeneration) return;
    clearScheduled(entry);
    entry.nextAt = nextAt;
    entry.timer = setTimer(() => {
      entry.timer = null;
      entry.nextAt = null;
      if (running && generation === requestGeneration) request(entry);
    }, Math.max(0, nextAt - now()));
  }

  async function request(entry) {
    if (!running || entry.paused || entry.controller) return;
    // Publisher rate limits survive manual refreshes and visibility restarts.
    if (entry.retryNotBefore > now()) {
      schedule(entry, entry.retryNotBefore, generation);
      return;
    }
    clearScheduled(entry);
    const requestGeneration = generation;
    const controller = new AbortController();
    entry.controller = controller;
    entry.startedAt = now();
    const startedAt = entry.startedAt;
    activity();
    // An activity hook is allowed to stop the poller synchronously.
    if (!running || generation !== requestGeneration || controller.signal.aborted) return;
    let result;
    try {
      result = await loadSource(entry.source, {signal: controller.signal});
      if (!result || !Array.isArray(result.items) || !result.source || !['ok', 'error'].includes(result.source.status)) throw new Error('Invalid news source response.');
    } catch (error) {
      result = {items: [], source: {id: entry.source.id, name: entry.source.name || entry.source.id, status: 'error', fetchedAt: new Date(now()).toISOString(), latestAt: null, error: error?.message || 'This publisher could not be reached.'}};
    }
    if (!running || generation !== requestGeneration || entry.controller !== controller || controller.signal.aborted) return;

    entry.controller = null;
    entry.lastCompletedAt = now();
    entry.status = result.source.status;
    entry.failures = entry.status === 'ok' ? 0 : Math.min(entry.failures + 1, 30);
    const interval = entry.failures ? Math.min(MAX_BACKOFF_MS, entry.pollMs * 2 ** entry.failures) : entry.pollMs;
    const retryAfterMs = entry.status === 'error' && Number.isFinite(result.source.retryAfterMs)
      ? Math.min(MAX_RETRY_AFTER_MS, Math.max(0, result.source.retryAfterMs)) : 0;
    entry.retryNotBefore = retryAfterMs > 0 ? entry.lastCompletedAt + retryAfterMs : null;
    const nextAt = Math.max(startedAt + interval, entry.lastCompletedAt + MIN_PAUSE_MS, entry.lastCompletedAt + retryAfterMs);
    schedule(entry, nextAt, requestGeneration);
    try { onResult(result); } catch {}
    if (running && generation === requestGeneration) activity();
  }

  function start() {
    if (running) return;
    running = true;
    generation += 1;
    for (const entry of entries.values()) request(entry);
  }
  function stop() {
    if (!running) return;
    running = false;
    generation += 1;
    for (const entry of entries.values()) {
      clearScheduled(entry);
      entry.controller?.abort();
      entry.controller = null;
    }
  }
  function refresh() {
    if (!running) return;
    for (const entry of entries.values()) if (!entry.paused && !entry.controller && !(entry.retryNotBefore > now())) request(entry);
  }
  function snapshot() {
    return {running, pending: pending(), sources: [...entries.values()].map(entry => ({
      id: entry.source.id, pollMs: entry.pollMs, paused: entry.paused, pending: Boolean(entry.controller), failures: entry.failures,
      nextAt: entry.nextAt, retryNotBefore: entry.retryNotBefore, startedAt: entry.startedAt, lastCompletedAt: entry.lastCompletedAt, status: entry.status
    }))};
  }
  return {start, stop, refresh, snapshot};
}
