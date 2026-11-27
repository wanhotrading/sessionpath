import { validateVisualTags } from './chart-visual-contract.mjs?v=visual-reading-20261108';
import { animateForecastMeter } from './forecast-meter-animation.mjs';

const ends = { NTA: -270, ASIA: 120, LONDON: 510 };
const names = { NTA: 'NTA', ASIA: 'Asia', LONDON: 'London' };
const tickerPattern = /^(?:(?:CME_MINI|COMEX|NYMEX|CME):)?M?(CL|NQ|ES|GC)(?:[12]!|[FGHJKMNQUVXZ]\d{1,4})$/u;
const tags = new Set(['DOWN_FINISH', 'DOWN_THEN_BOUNCE', 'DROP_RECOVERY', 'UP_FINISH', 'UP_THEN_PULLBACK', 'RALLY_FADE', 'NARROW', 'ORDER_UNRESOLVED']);
const sources = { archive: 'Archive match', provisional: 'AI chart values · review', visual: 'AI visual · review', tentative: 'AI suggestion · user applied' };
const rank = { tentative: 0, visual: 1, provisional: 2, archive: 3 };

function chartMinute(date, cutoff) {
  if (typeof date !== 'string' || typeof cutoff !== 'string') return null;
  const validDate = /^\d{4}-\d{2}-\d{2}$/u.test(date) && Date.parse(date + 'T12:00:00Z');
  if (!Number.isFinite(validDate) || new Date(validDate).toISOString().slice(0, 10) !== date) return null;
  const priorDate = new Date(validDate - 86400000).toISOString().slice(0, 10);
  const time = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/u.exec(cutoff);
  if (!time || time[0] !== cutoff || ![date, priorDate].includes(time[1]) || +time[3] % 5) return null;
  return +time[2] * 60 + +time[3] - (time[1] === priorDate ? 1440 : 0);
}

function visualPathCandidates(body) {
  return validateVisualTags(body?.visualTags) ? body.visualTags.filter(row => Object.hasOwn(ends, row.session) && row.status === 'candidate') : [];
}

export function hasChartPathSuggestions(body) {
  return visualPathCandidates(body).length > 0;
}

export function confirmChartPathOutcomes(body, { market, date, time }) {
  const cutoff = date + 'T' + time;
  const minute = chartMinute(date, cutoff);
  if (minute === null) return null;
  const outcomes = visualPathCandidates(body)
    .filter(row => minute >= ends[row.session])
    .map(({session, tag}) => ({session, tag, source: 'tentative'}));
  const reading = {market, date, cutoff, minute, outcomes};
  return validPathReading(reading) ? reading : null;
}

export function chartPathOutcomes(body) {
  const observation = body?.chartObservation;
  const market = observation?.market;
  if (!['CL', 'NQ', 'ES', 'GC'].includes(market) || observation.timezone !== 'America/New_York' ||
      observation.intervalMinutes !== 5) return null;
  if (observation.ticker != null) {
    const match = typeof observation.ticker === 'string' && tickerPattern.exec(observation.ticker);
    if (!match || match[0] !== observation.ticker || match[1] !== market) return null;
  }
  const supplied = body.observationContext?.mode === 'historical' ? body.observationContext : null;
  if (supplied && observation.date && supplied.date !== observation.date) return null;
  const date = observation.date ?? supplied?.date;
  const cutoff = observation.cutoff ?? supplied?.cutoff;
  const minute = chartMinute(date, cutoff);
  if (minute === null || supplied?.cutoff && cutoff > supplied.cutoff) return null;
  const formal = Array.isArray(body.shapeTags) ? body.shapeTags : [];
  const visual = visualPathCandidates(body);
  const outcomes = [];
  for (const [session, end] of Object.entries(ends)) {
    if (minute < end) continue;
    const measured = formal.find(row => row.session === session);
    if (measured?.status === 'in_progress') continue;
    if (['archive', 'provisional'].includes(measured?.status) && tags.has(measured.tag)) {
      outcomes.push({ session, tag: measured.tag, source: measured.status });
      continue;
    }
    const candidate = visual.find(row => row.session === session);
    if (candidate) outcomes.push({ session, tag: candidate.tag, source: candidate.confidence === 'clear' ? 'visual' : 'tentative' });
  }
  return { market, date, cutoff, minute, outcomes };
}

export function validPathReading(reading) {
  const minute = chartMinute(reading?.date, reading?.cutoff);
  if (minute === null || reading.minute !== minute || !['CL', 'NQ', 'ES', 'GC'].includes(reading.market) ||
      !Array.isArray(reading.outcomes) || reading.outcomes.length > 3) return false;
  return new Set(reading.outcomes.map(row => row?.session)).size === reading.outcomes.length &&
    reading.outcomes.every(row => Object.hasOwn(ends, row?.session) && minute >= ends[row.session] &&
      tags.has(row.tag) && Object.hasOwn(rank, row.source));
}

export function applyChartPathOutcomes(state, reading, { market, date, replace = false }) {
  if (!validPathReading(reading)) return { applied: [], message: 'The chart details or outcomes could not be confirmed.' };
  if (reading.market !== market) return { applied: [], message: 'Select ' + reading.market + ' to use these outcomes.' };
  if (reading.date !== date) return { applied: [], message: 'Select ' + reading.date + ' in Replay to use these outcomes.' };
  const applied = [];
  const unchanged = [];
  const conflicts = [];
  state.sessionChoiceSources ??= {};
  for (const { session, tag, source } of reading.outcomes) {
    const previous = state.sessionChoiceSources[session];
    const selected = state.sessionChoices[session];
    if (selected && (!previous || rank[previous] > rank[source] ||
        rank[previous] === rank[source] && (selected === tag || reading.minute < state.chartPathMinute))) {
      if (selected === tag) {
        unchanged.push(session);
        continue;
      }
      if (!replace) {
        conflicts.push(session);
        continue;
      }
    }
    state.sessionChoices[session] = tag;
    state.sessionChoiceSources[session] = source;
    applied.push(session);
  }
  const conflictText = conflicts.length ? ' Existing selections kept for ' + conflicts.map(session => names[session]).join(', ') + '.' : '';
  if (!applied.length) return { applied, unchanged, conflicts, message: conflictText.trim() || (unchanged.length ?
    'These tags are already selected in Session paths.' : 'No completed-session outcomes to fill.') };
  if (reading.minute >= (state.chartPathMinute ?? -Infinity)) {
    state.chartPathMinute = reading.minute;
    state.chartPathTime = reading.cutoff.replace('T', ' ');
  }
  return { applied, unchanged, conflicts, message: 'Session paths filled ' + applied.map(session => names[session]).join(', ') + '.' + conflictText };
}

const nyCards = new WeakMap();

function nyForecastCard(host, make, {session, bins, n}, context) {
  const ranked = n > 0 ? bins.filter(bin => Number.isFinite(bin.p)).sort((a, b) => b.count - a.count).slice(0, 4) : [];
  const signature = JSON.stringify([n, context, ranked.map(bin => [bin.id, bin.count])]);
  const previous = nyCards.get(host);
  if (previous?.signature === signature) return previous.card;
  previous?.observer?.disconnect();

  const card = make('article', 'session-card compact-path-card');
  card.append(make('h3', '', session.name));
  const list = make('ol', 'ny-path-ranking');
  list.setAttribute('aria-label', 'Most likely New York session outcomes');
  const fills = new Map();
  for (const bin of ranked) {
    const item = make('li');
    const line = make('div', 'compact-path-result');
    line.append(make('span', '', bin.label), make('strong', 'probability-number', (100 * bin.p).toFixed(1) + '%'));
    const track = make('div', 'ny-path-track');
    track.setAttribute('aria-hidden', 'true');
    const fill = make('span');
    fill.style.transform = 'scaleX(' + bin.p + ')';
    track.append(fill);
    item.title = bin.count + '/' + n + ' historical windows';
    item.append(line, track);
    list.append(item);
    fills.set(bin.id, {fill, p: bin.p});
  }
  if (ranked.length) card.append(list);
  const detail = make('p', 'compact-path-sample', ranked.length
    ? n + (n === 1 ? ' matching window' : ' matching windows') + (n < 20 ? ' · small sample' : '')
    : 'No matching cases');
  if (context.length) detail.title = 'Given ' + context.join(' + ');
  card.append(detail);

  const state = {card, fills, signature};
  nyCards.set(host, state);
  const doc = host.ownerDocument;
  function reveal() {
    if (doc.documentElement.dataset.loadingCover) return;
    state.observer?.disconnect();
    if (!card.isConnected) return;
    for (const [id, {fill, p}] of fills) {
      const from = previous?.revealed ? previous.fills.get(id)?.p ?? 0 : 0;
      if (from !== p) animateForecastMeter(fill, [{transform:'scaleX(' + from + ')'}, {transform:fill.style.transform}]);
    }
    state.revealed = true;
  }
  if (ranked.length) {
    if (doc.documentElement.dataset.loadingCover) {
      state.observer = new doc.defaultView.MutationObserver(reveal);
      state.observer.observe(doc.documentElement, {attributes: true, attributeFilter: ['data-loading-cover']});
    } else queueMicrotask(reveal);
  }
  return card;
}

export function compactPathCards(host, results, { choices, choiceSources, shapes, minute, explore, formatTime }) {
  const doc = host.ownerDocument;
  const make = (tag, style, text) => {
    const el = doc.createElement(tag);
    if (style) el.className = style;
    if (text) el.textContent = text;
    return el;
  };
  const focusedSession = doc.activeElement?.dataset.session;
  host.replaceChildren(...results.map(({ session, bins, conditions, n }) => {
    const context = conditions.map(({ id, value }) => (names[id] ?? id) + ' ' + (shapes.find(([tag]) => tag === value)?.[1] ?? value));
    if (session.id === 'NY') return nyForecastCard(host, make, {session, bins, n}, context);
    const selected = choices[session.id];
    const best = bins.reduce((current, bin) => Number.isFinite(bin.p) && (!current || bin.p > current.p) ? bin : current, null);
    const shown = selected ? bins.find(bin => bin.id === selected) : best;
    const article = make('article', 'session-card compact-path-card');
    const title = make('h3', '', session.name);
    const percent = shown?.p == null ? '—' : (shown.p * 100).toFixed(1) + '%';
    const line = make('div', 'compact-path-result');
    line.append(make('span', '', shown?.label ?? 'No matching cases'), make('strong', 'probability-number', percent));
    const detail = make('p', 'compact-path-sample', (selected ? 'Selected outcome' : 'Most likely') +
      (shown?.p == null ? '' : ' · ' + shown.count + '/' + n) + (n > 0 && n < 20 ? ' · small sample' : ''));
    if (context.length) detail.title = 'Given ' + context.join(' + ');
    article.append(title, line, detail);
    if (Object.hasOwn(ends, session.id)) {
      const label = make('label', 'observed-select', explore ? 'Assumed outcome' : 'Observed outcome');
      const select = make('select');
      select.dataset.session = session.id;
      select.setAttribute('aria-label', session.id + ' observed outcome');
      select.disabled = !explore && session.end > minute;
      select.append(...[['', 'Not selected'], ...shapes].map(([id, text]) => {
        const option = make('option', '', text);
        option.value = id;
        return option;
      }));
      select.value = selected ?? '';
      label.append(select);
      article.append(label);
      const source = selected && sources[choiceSources?.[session.id]];
      if (source || select.disabled) article.append(make('small', 'compact-path-source',
        source || 'Available after ' + formatTime(session.end) + ' NY'));
    }
    return article;
  }));
  if (focusedSession) host.querySelector('select[data-session="' + focusedSession + '"]')?.focus({ preventScroll: true });
}
