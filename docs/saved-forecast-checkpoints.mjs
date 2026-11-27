const retryInterval = 60_000;

export function createSavedCheckpointReader({endpoint, market, parse, windows, fetchImpl=fetch, now=Date.now}) {
  const cache = new Map();

  function load(date) {
    const previous = cache.get(date);
    if (previous && now()-previous.at < retryInterval) return previous.promise;
    const promise = (async () => {
      const url = new URL(endpoint);
      url.searchParams.set('market', market);
      url.searchParams.set('date', date);
      const response = await fetchImpl(url, {
        credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(7000)
      });
      if (!response.ok) return {records: [], packet: null};
      const payload = await response.json();
      const records = windows.map(window => {
        try {
          const record = parse(payload, {...window, date, market});
          return record ? {...record, saved: true} : null;
        } catch { return null; }
      });
      return {records, packet: records.some(Boolean) ? payload.packet : null};
    })().catch(() => ({records: [], packet: null}));
    cache.delete(date);
    cache.set(date, {at:now(),promise});
    if (cache.size > 5) cache.delete(cache.keys().next().value);
    return promise;
  }

  async function findSavedCheckpoint({date, minute}) {
    const index = windows.findLastIndex(window => window.minute <= minute);
    if (index < 0) return null;
    const {records, packet} = await load(date);
    const record = records[index];
    return record ? {date, index, record, records, packet} : null;
  }
  findSavedCheckpoint.forDate = load;
  return findSavedCheckpoint;
}
