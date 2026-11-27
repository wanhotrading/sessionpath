const retryInterval = 60_000;

export function createSavedCheckpointReader({endpoint, market, parse, windows, lookback, fetchImpl=fetch, now=Date.now}) {
  const cache = new Map();
  let completeReceipt;

  async function readReceipt(date) {
    const url = new URL(endpoint);
    url.searchParams.set('market', market);
    url.searchParams.set('date', date);
    const response = await fetchImpl(url, {
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(7000)
    });
    return response.ok ? response.json() : null;
  }

  function load(date, lastIndex = windows.length - 1) {
    const key = date + '/' + lastIndex;
    const previous = cache.get(key);
    if (previous && now()-previous.at < retryInterval) return previous.promise;
    const promise = (async () => {
      const payload = completeReceipt?.date === date ? completeReceipt.payload : await readReceipt(date).catch(() => null);
      const verified = windows.map(window => {
        try { return payload ? parse(payload, {...window, date, market}) : null; }
        catch { return null; }
      });
      if (verified.every(Boolean)) completeReceipt = {date, payload};
      let usedReceipt = false;
      const records = await Promise.all(windows.map(async (window, index) => {
        if (index > lastIndex) return null;
        const request = {...window, date, market};
        if (verified[index]) {
          usedReceipt = true;
          return {...verified[index], saved:true};
        }
        if (!lookback) return null;
        try {
          const record = await lookback(request);
          if (record?.market !== market || record.date !== date || record.contract !== market + '1!' ||
              record.snapshot?.cutoff !== window.cutoff) return null;
          return {...record, saved:true};
        } catch { return null; }
      }));
      return {records, packet:usedReceipt ? payload.packet : null};
    })();
    cache.delete(key);
    cache.set(key, {at:now(),promise});
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    return promise;
  }

  async function findSavedCheckpoint({date, minute}) {
    const index = windows.findLastIndex(window => window.minute <= minute);
    if (index < 0) return null;
    const {records, packet} = await load(date,index);
    const record = records[index];
    return record ? {date, index, record, records, packet} : null;
  }
  findSavedCheckpoint.forDate = load;
  return findSavedCheckpoint;
}
