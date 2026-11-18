import { validateVisualTags } from './chart-visual-contract.mjs?v=visual-reading-20261108';

const ends = { NTA: -270, ASIA: 120, LONDON: 510 };
const names = { NTA: 'NTA', ASIA: 'Asia', LONDON: 'London' };
const tickerPattern = /^(?:(?:CME_MINI|COMEX|NYMEX|CME):)?M?(CL|NQ|ES|GC)(?:[12]!|[FGHJKMNQUVXZ]\d{1,4})$/u;
const tags = new Set(['DOWN_FINISH', 'DOWN_THEN_BOUNCE', 'DROP_RECOVERY', 'UP_FINISH', 'UP_THEN_PULLBACK', 'RALLY_FADE', 'NARROW', 'ORDER_UNRESOLVED']);
const sources = { archive: 'Archive match', provisional: 'AI chart values · review', visual: 'AI visual · review' };

export function chartPathOutcomes(body) {
  const observation = body?.chartObservation;
  const match = typeof observation?.ticker === 'string' && tickerPattern.exec(observation.ticker);
  if (!match || match[0] !== observation.ticker || match[1] !== observation.market ||
      observation.timezone !== 'America/New_York' || observation.intervalMinutes !== 5 ||
      typeof observation.date !== 'string' || typeof observation.cutoff !== 'string') return null;
  const { date, cutoff, market } = observation;
  const validDate = /^\d{4}-\d{2}-\d{2}$/u.test(date) && Date.parse(date + 'T12:00:00Z');
  if (!Number.isFinite(validDate) || new Date(validDate).toISOString().slice(0, 10) !== date) return null;
  const priorDate = new Date(validDate - 86400000).toISOString().slice(0, 10);
  const time = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/u.exec(cutoff);
  if (!time || time[0] !== cutoff || ![date, priorDate].includes(time[1]) || +time[3] % 5) return null;
  const minute = +time[2] * 60 + +time[3] - (time[1] === priorDate ? 1440 : 0);
  const formal = Array.isArray(body.shapeTags) ? body.shapeTags : [];
  const visual = validateVisualTags(body.visualTags) ? body.visualTags : [];
  const outcomes = [];
  for (const [session, end] of Object.entries(ends)) {
    if (minute < end) continue;
    const measured = formal.find(row => row.session === session);
    if (measured?.status === 'in_progress') continue;
    if (['archive', 'provisional'].includes(measured?.status) && tags.has(measured.tag)) {
      outcomes.push({ session, tag: measured.tag, source: measured.status });
      continue;
    }
    const candidate = visual.find(row => row.session === session && row.status === 'candidate' &&
      row.complete && row.confidence === 'clear' && tags.has(row.tag));
    if (candidate) outcomes.push({ session, tag: candidate.tag, source: 'visual' });
  }
  return { market, date, cutoff, minute, outcomes };
}

export function applyChartPathOutcomes(state, reading, { market, date }) {
  if (!reading) return { applied: [], message: 'Session Paths needs a readable market, date, and completed five-minute cutoff.' };
  if (reading.market !== market) return { applied: [], message: 'Select ' + reading.market + ' to use these outcomes.' };
  if (reading.date !== date) return { applied: [], message: 'Select ' + reading.date + ' in Replay to use these outcomes.' };
  const applied = [];
  const rank = { visual: 1, provisional: 2, archive: 3 };
  state.sessionChoiceSources ??= {};
  for (const { session, tag, source } of reading.outcomes) {
    if (!Object.hasOwn(ends, session) || reading.minute < ends[session] || !tags.has(tag) || !Object.hasOwn(rank, source)) continue;
    const previous = state.sessionChoiceSources[session];
    if (state.sessionChoices[session] && (!previous || rank[previous] > rank[source])) continue;
    state.sessionChoices[session] = tag;
    state.sessionChoiceSources[session] = source;
    applied.push(session);
  }
  if (!applied.length) return { applied, message: 'No new confirmed or clear completed-session outcomes to fill.' };
  state.chartPathMinute = Math.max(state.chartPathMinute ?? -Infinity, reading.minute);
  state.chartPathTime = reading.cutoff.replace('T', ' ');
  return { applied, message: 'Session Paths filled ' + applied.map(session => names[session]).join(', ') + '.' };
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
    const selected = choices[session.id];
    const best = bins.reduce((current, bin) => Number.isFinite(bin.p) && (!current || bin.p > current.p) ? bin : current, null);
    const shown = selected ? bins.find(bin => bin.id === selected) : best;
    const article = make('article', 'session-card compact-path-card');
    const title = make('h3', '', session.name);
    const context = conditions.map(({ id, value }) => (names[id] ?? id) + ' ' + (shapes.find(([tag]) => tag === value)?.[1] ?? value));
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
