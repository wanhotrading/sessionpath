const sessionDuration = 86_400_000;
const retryInterval = 60_000;

function weekdayDates(date, count) {
  const dates = [];
  let cursor = Date.parse(date + 'T12:00:00Z');
  if (!Number.isFinite(cursor)) return dates;
  while (dates.length < count) {
    const day = new Date(cursor);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) dates.push(day.toISOString().slice(0, 10));
    cursor -= sessionDuration;
  }
  return dates;
}

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
      if (!response.ok) return [];
      const payload = await response.json();
      return windows.map(window => {
        try {
          const record = parse(payload, {...window, date, market});
          return record ? {...record, saved: true} : null;
        } catch { return null; }
      });
    })().catch(() => []);
    cache.delete(date);
    cache.set(date, {at:now(),promise});
    if (cache.size > 5) cache.delete(cache.keys().next().value);
    return promise;
  }

  return async function findSavedCheckpoint({date, minute}) {
    for (const session of weekdayDates(date, 3)) {
      if (session === date && minute < windows[0].minute) continue;
      const records = await load(session);
      const index = records.findLastIndex((record, i) => record && (session !== date || windows[i].minute <= minute));
      if (index >= 0) return {date:session, index, record:records[index]};
    }
    return null;
  };
}
