// Session paths choices belong to a market's current New York trading date.
export const SESSION_PATH_CLOSE = 16 * 60;
const sessions = ['NTA', 'ASIA', 'LONDON'];
const sources = new Set(['archive', 'provisional', 'visual', 'tentative']);

export function createSessionPathMemory({ market, shapes, closeAt, onExpire, storage = () => localStorage }) {
  const key = 'sessionpath.session-paths.v1.' + market;
  const tags = new Set(shapes.map(([id]) => id));
  let watchedDate;
  let timer;

  function clean(value) {
    if (!value || typeof value !== 'object') return null;
    const sessionChoices = {};
    const sessionChoiceSources = {};
    for (const session of sessions) {
      const tag = value.sessionChoices?.[session];
      if (!tags.has(tag)) continue;
      sessionChoices[session] = tag;
      const source = value.sessionChoiceSources?.[session];
      if (sources.has(source)) sessionChoiceSources[session] = source;
    }
    const hasChoices = Object.keys(sessionChoices).length > 0;
    const explore = value.explore === true;
    if (!hasChoices && !explore) return null;
    const cutoff = value.sessionPathCutoff;
    const minute = value.chartPathMinute;
    const time = value.chartPathTime;
    return {
      sessionChoices, sessionChoiceSources, explore,
      sessionPathCutoff: hasChoices && typeof cutoff === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff) ? cutoff : null,
      chartPathMinute: hasChoices && Number.isInteger(minute) && minute >= -1440 && minute < 1440 ? minute : null,
      chartPathTime: hasChoices && typeof time === 'string' && /^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null,
    };
  }

  function discard(date) {
    try {
      const store = storage();
      if (JSON.parse(store.getItem(key))?.date === date) store.removeItem(key);
    } catch { /* Storage can be disabled. */ }
  }

  function expire() {
    if (!watchedDate || Date.now() < closeAt(watchedDate)) return;
    const date = watchedDate;
    watchedDate = null;
    clearTimeout(timer);
    discard(date);
    onExpire(date);
  }

  function watch(date) {
    if (watchedDate === date) return;
    clearTimeout(timer);
    watchedDate = date;
    timer = setTimeout(expire, Math.max(0, closeAt(date) - Date.now()) + 25);
  }

  function active(date, clock) {
    return date === clock.date && clock.minute < SESSION_PATH_CLOSE;
  }

  return {
    expire,
    read(date, clock) {
      try {
        const saved = JSON.parse(storage().getItem(key));
        if (!saved) return null;
        if (saved.date < clock.date || (saved.date === clock.date && clock.minute >= SESSION_PATH_CLOSE)) {
          discard(saved.date);
          return null;
        }
        if (!active(date, clock) || saved.date !== date) return null;
        const value = clean(saved);
        if (value) watch(date);
        return value;
      } catch { return null; }
    },
    write(date, clock, settings) {
      if (!active(date, clock)) return;
      const value = clean(settings);
      if (!value) {
        if (watchedDate === date) {
          watchedDate = null;
          clearTimeout(timer);
        }
        discard(date);
        return;
      }
      watch(date);
      try { storage().setItem(key, JSON.stringify({ date, ...value })); } catch { /* Keep selections for this visit. */ }
    },
  };
}
