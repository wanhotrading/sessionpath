// The build publishes immutable research parts. Only the active market is decoded.
const inFlight = new Map();

export function transformPrices(rows, tick, decode) {
  for (const row of rows) {
    for (const series of row.slice(2, 4)) {
      if (!Array.isArray(series)) continue;
      let prior = row[1] ?? 0;
      for (let i = 0; i < series.length; i++) {
        if (series[i] === null) continue;
        if (decode) {
          prior += series[i] * tick;
          series[i] = prior;
        } else {
          const price = series[i];
          series[i] = (price - prior) / tick;
          prior = price;
        }
      }
    }
  }
  return rows;
}

async function readPart(url, retry = false) {
  // Reset the deadline whenever bytes arrive, so a slow transfer can finish.
  const controller = new AbortController();
  let timeout;
  const reset = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => controller.abort(), 15000);
  };
  reset();
  try {
    const response = await fetch(url, { signal: controller.signal, cache: retry ? 'reload' : 'force-cache' });
    if (!response.ok) throw Object.assign(Error('Research download failed (' + response.status + ').'), { status: response.status });
    const reader = response.body.getReader();
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      reset();
    }
    clearTimeout(timeout);
    const stream = new Blob(chunks).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).json();
  } finally { clearTimeout(timeout); }
}

async function loadParts(manifest, root) {
  const parts = new Array(manifest.files.length);
  let cursor = 0;
  async function worker() {
    while (cursor < parts.length) {
      const index = cursor++;
      const url = new URL(manifest.files[index], root);
      try {
        parts[index] = await readPart(url);
      } catch {
        // Retry this part independently. The other workers retain their completed parts.
        parts[index] = await readPart(url, true);
      }
    }
  }
  await Promise.all(Array.from({length: Math.min(4, parts.length)}, worker));
  const [{ days, tags, extra, timelineMeta }, ...groups] = parts;
  const rows = transformPrices(groups.flat(), manifest.tick, true);
  if (rows.length !== manifest.rows) throw Error('Incomplete research timeline.');
  const timeline = timelineMeta ? { ...timelineMeta, rows } : rows;
  return [days, tags, timeline, extra];
}

export function loadDashboardResearch(market, fallback) {
  const config = globalThis.sessionPathStartup;
  if (!config || !config.markets[market] || typeof DecompressionStream === 'undefined') return fallback();
  if (!inFlight.has(market)) {
    const promise = loadParts(config.markets[market], new URL(config.root, document.baseURI));
    inFlight.set(market, promise);
    promise.catch(() => inFlight.delete(market));
  }
  return inFlight.get(market).catch(error => {
    // An older cached page may name parts from a previous deployment.
    if (error.status === 404) return fallback();
    throw error;
  });
}

export function warmDashboard(market) {
  const fallback = () => Promise.resolve();
  void loadDashboardResearch(market, fallback).catch(() => {});
}

export function warmDestination(market) {
  const config = globalThis.sessionPathStartup;
  if (!config?.markets[market] || typeof DecompressionStream === 'undefined') return;
  // Start network work during the outgoing animation without parsing the next market twice.
  const root = new URL(config.root, document.baseURI);
  if (config.apps?.[market]) {
    const target = new URL(config.apps[market], root).href;
    if (![...document.querySelectorAll('link[rel="modulepreload"]')].some(link => link.href === target)) {
      const link = document.createElement('link');
      link.rel = 'modulepreload';
      link.href = target;
      document.head.append(link);
    }
  }
  for (const file of config.markets[market].files.slice(0, 4)) {
    fetch(new URL(file, root), { cache: 'force-cache' }).then(response => response.arrayBuffer()).catch(() => {});
  }
}
