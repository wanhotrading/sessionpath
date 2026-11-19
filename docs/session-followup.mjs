import {completedEndpointClose, firstCompletedBreach} from './followup-observations.mjs?v=2';

const endpointMetrics = [['hh', 'New running high'], ['ll', 'New running low'], ['both', 'Both new extremes'], ['neither', 'Neither new extreme']];
const breachMetrics = [['return20', 'Close back inside within 20 minutes'], ['reach120', 'Later reach 1.20×'], ['reach130', 'Later reach 1.30×']];
const windows = {180: '03-05', 300: '05-0830', 510: '0830-1600'};
const endpointTitle = {ABOVE_U: 'Previous box closed above U', BELOW_D: 'Previous box closed below D', INSIDE: 'Previous box closed inside'};
const pc = value => Number.isFinite(value) ? (100 * value).toFixed(1) + '%' : '—';
const clock = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function reading(title) {
  const root = element('section', 'followup-reading');
  const heading = element('h3', '', title);
  const detail = element('div');
  root.append(heading, detail);
  return {root, detail, key: ''};
}

function show(group, label, meta = '', metrics = [], outcomes = {}, reached = {}) {
  const key = JSON.stringify([label, meta, metrics, outcomes, reached]);
  if (key === group.key) return;
  group.key = key;
  group.detail.replaceChildren(element('p', metrics.length ? 'research-state' : 'followup-status', label));
  if (!metrics.length) return;
  if (meta) group.detail.append(element('p', 'compact-note', meta));
  const grid = element('div', 'research-metrics');
  for (const [id, name] of metrics) {
    const metric = outcomes[id];
    const stat = element('article', 'research-stat');
    stat.append(element('span', '', name));
    if (metric?.available) {
      stat.append(element('strong', '', pc(metric.probability)));
      const interval = metric.rawInterval?.map(pc).join('–');
      const sample = metric.n > 0 ? `${metric.successes}/${metric.n} observed · 95% raw interval ${interval}` : `${metric.prior.n} broader cases`;
      stat.append(element('small', '', sample));
    } else {
      stat.dataset.status = 'unavailable';
      stat.append(element('strong', '', reached[id] ? 'Already reached' : '—'));
      if (!reached[id]) stat.append(element('small', '', metric?.reason ?? 'No earlier cases'));
    }
    grid.append(stat);
  }
  group.detail.append(grid);
}

const breachStatus = {
  waiting: 'Waiting for the first completed five-minute candle.',
  unavailable: 'Waiting for verified five-minute candle highs and lows.',
  gap: 'Candle history is incomplete. The first breach cannot be verified.',
};

export function mountSessionFollowup(host, {market, loadResearch, historyURL}) {
  const endpoint = reading('Next-window continuation');
  const breach = reading('After the first breach');
  host.append(element('h2', '', 'Continuation & first breach'), endpoint.root, breach.root);
  let research, revision = 0;
  const readings = new Map();

  function readFirstBreach(date, window, bounds, through) {
    const url = new URL('/api/followup', historyURL);
    const {cutoff, minute, endMinute} = window;
    for (const [name, value] of Object.entries({market, date, cutoff, upper:bounds.upper.toFixed(6), lower:bounds.lower.toFixed(6)})) {
      url.searchParams.set(name, value);
    }
    const key = url.href;
    const cached = readings.get(key);
    if (cached?.terminal || cached?.through === through) return cached.promise;
    if (readings.size >= 12) readings.delete(readings.keys().next().value);
    const item = {through, terminal:false};
    item.promise = fetch(url, {credentials:'omit', cache:'no-store', signal:AbortSignal.timeout(6000)})
      .then(response => response.ok ? response.json() : null).then(value => {
        if (!value || value.date !== date || value.market !== market || value.cutoff !== cutoff) return {status:'unavailable'};
        const at = value.minute;
        if (['breach','ambiguous','unbreached'].includes(value.status) && (!Number.isInteger(at) || at <= minute || at > endMinute || at % 5)) return {status:'unavailable'};
        if (value.status === 'breach') {
          const x = value.observation;
          if (!['D','U'].includes(x?.side) || !['WICK_ONLY','CLOSE_OUTSIDE'].includes(x.signalType) ||
            !['reach120','reach130'].every(key => typeof x.alreadyReached?.[key] === 'boolean')) return {status:'unavailable'};
        }
        item.terminal = ['breach','ambiguous'].includes(value.status) || value.status === 'unbreached' && at === endMinute;
        return value;
      }).catch(() => ({status:'unavailable'}));
    readings.set(key,item);
    return item.promise;
  }

  return async function render({date, window, record, bounds, priorBounds, through, remoteThrough, barAt, exactClose, replay}) {
    const run = ++revision;
    if (!record) {
      show(endpoint, 'Waiting for a verified checkpoint.');
      show(breach, 'Waiting for the SessionPath box.');
      return;
    }
    const {minute, endMinute} = window;
    const id = windows[minute];
    const close = completedEndpointClose(record, minute, barAt, exactClose);
    const signal = !bounds ? null : !barAt && Number.isInteger(remoteThrough) && remoteThrough > minute ?
      await readFirstBreach(date, window, bounds, remoteThrough) : firstCompletedBreach({start: minute, end: endMinute, through, bounds, barAt});
    if (run !== revision) return;
    const canReadEndpoint = minute > 180 && Number.isFinite(close) && priorBounds;
    const canReadBreach = signal?.status === 'breach';
    if (!canReadEndpoint) show(endpoint, minute === 180 ? 'Starts at the 05:00 checkpoint.' :
      !priorBounds ? 'Waiting for the previous SessionPath box.' : 'Waiting for the verified endpoint close.');
    if (!canReadBreach) {
      const text = signal?.status === 'ambiguous' ? `Both edges broke in the ${clock(signal.minute)} NY candle. The first side is unknown.` :
        signal?.status === 'unbreached' ? `No strict breach through ${clock(signal.minute)} NY.` : breachStatus[signal?.status];
      show(breach, text ?? 'Waiting for the SessionPath box.');
    }
    if (!canReadEndpoint && !canReadBreach) return;

    research ??= loadResearch().catch(error => { research = null; throw error; });
    try {
      const [data, {selectEndpointProbability, selectFirstBreachProbability}, {classifyEndpoint, observeFirstBreach}] = await research;
      if (run !== revision) return;
      if (canReadEndpoint) {
        const state = classifyEndpoint(close, priorBounds.upper, priorBounds.lower);
        const result = selectEndpointProbability(data, {market, window: id, state, asOf: date});
        const training = result.sample.trainingThrough;
        show(endpoint, endpointTitle[state], `${date} · ${clock(minute)}–${clock(endMinute)} NY${training ? ' · Training through ' + training : ''}`, endpointMetrics, result.outcomes);
      }
      if (canReadBreach) {
        const observation = signal.observation || observeFirstBreach({window: id, minute: signal.minute, ...bounds, ...signal.bar});
        const result = selectFirstBreachProbability(data, {market, window: id, asOf: date, completionMinute: signal.minute, ...observation});
        const side = observation.side === 'U' ? 'Upper breach' : 'Lower breach';
        const type = observation.signalType === 'WICK_ONLY' ? 'wick outside, closed inside' : 'closed outside';
        show(breach, `${side} · ${type}`, `${date} · ${clock(signal.minute)} NY${replay ? ' · recorded after the checkpoint' : ''}`,
          breachMetrics, result.outcomes, observation.alreadyReached);
      }
    } catch {
      if (run !== revision) return;
      if (canReadEndpoint) show(endpoint, 'Continuation probabilities are unavailable.');
      if (canReadBreach) show(breach, 'First-breach probabilities are unavailable.');
    }
  };
}
