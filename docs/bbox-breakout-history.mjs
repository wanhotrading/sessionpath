const STUDY_MARKETS = new Set(['CL', 'NQ', 'ES']);
const PHASES = [
  ['Asia', '19:30–02:00'],
  ['02:00 gap', '02:00–03:00'],
  ['London', '03:00–05:00'],
  ['London', '05:00–08:30'],
];
const PHASE_COUNTS = {'03:00': 2, '05:00': 3, '08:30': 4};
const SIDES = ['', 'Upper edge', 'Lower edge', 'Both edges'];
const PCT = new Intl.NumberFormat('en-US', {style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1});

function historyFor(snapshot, cutoff) {
  const sample = snapshot?.bbox_history;
  const observed = PHASE_COUNTS[cutoff];
  if (snapshot?.cutoff !== cutoff || !observed || sample?.v !== 1 || sample.phases?.length !== 4 || !Array.isArray(sample.phases)) return null;
  if (!sample.phases.every((mask, index) => index < observed ? Number.isInteger(mask) && mask >= 0 && mask <= 3 : mask === null)) return null;
  const prior = sample.phases.some(mask => mask > 0);
  if (prior ? !Number.isInteger(sample.latest_minutes) || sample.latest_minutes < 0 || sample.latest_minutes % 5 !== 0 : sample.latest_minutes !== null) return null;
  if (!['attempts_up', 'attempts_down'].every(key => Number.isInteger(sample[key]) && sample[key] >= 0)) return null;
  return sample;
}

function displaySide(mask) {
  return SIDES[mask]?.toLowerCase() ?? '';
}

function addText(parent, tag, className, value) {
  const node = parent.ownerDocument.createElement(tag);
  node.className = className;
  node.textContent = value;
  parent.append(node);
  return node;
}

function paintForecast(node, market, cutoff, snapshot, model) {
  const low = snapshot.prior_low;
  const high = snapshot.prior_high;
  const open = snapshot.reference_price;
  const side = open > high ? 'above' : open < low ? 'below' : null;
  if (side) {
    node.textContent = `Price opened ${side} BBOX at ${cutoff} NY. This breakout forecast starts with price inside the box.`;
    return;
  }
  const estimate = model?.(market, snapshot);
  if (!estimate || estimate.state !== 'INSIDE' || ![estimate.baseline, estimate.adjusted].every(p => Number.isFinite(p) && p >= 0 && p <= 1)) {
    node.textContent = 'BBOX breakout estimate unavailable for this checkpoint.';
    return;
  }
  node.replaceChildren();
  const end = market === 'CL' ? '09:00' : '09:30';
  addText(node, 'div', 'bbox-history-forecast-label', `Wick beyond either edge before ${end} NY`);
  const rates = node.ownerDocument.createElement('div');
  rates.className = 'bbox-history-rates';
  node.append(rates);
  for (const [label, probability] of [['With recency and repeats', estimate.adjusted], ['With prior breach only', estimate.baseline]]) {
    const rate = node.ownerDocument.createElement('div');
    addText(rate, 'strong', '', PCT.format(probability));
    addText(rate, 'span', '', label);
    rates.append(rate);
  }
  addText(node, 'p', 'compact-note', 'Research estimates use the frozen checkpoint open, distance to both BBOX edges and overnight volatility.');
  if (Number.isInteger(estimate.trainingN) && estimate.trainingN > 0) {
    addText(node, 'p', 'compact-note', `Historical sample · ${estimate.trainingN.toLocaleString('en-US')} dates with price inside at this checkpoint`);
  }
}

let modelPromise;
function loadModel() {
  modelPromise ??= import('./bbox-overnight-model.mjs?v=bbox-history-20261116').then(module => module.bboxOvernightForecast).catch(() => null);
  return modelPromise;
}

export function makeBBoxBreakoutHistory(document, market, id, findHost) {
  if (!STUDY_MARKETS.has(market)) return null;
  const details = document.createElement('details');
  details.id = id;
  details.className = 'session-note bbox-breakout-history';
  const heading = document.createElement('summary');
  addText(heading, 'span', 'bbox-history-title', 'BBOX breakout history');
  const brief = addText(heading, 'span', 'bbox-history-summary', '');
  brief.setAttribute('role', 'status');
  details.append(heading);
  const body = document.createElement('div');
  body.className = 'bbox-history-body';
  details.append(body);
  let lastKey;

  function update({snapshot, cutoff, message} = {}) {
    const host = findHost();
    if (host && details.previousElementSibling !== host) host.after(details);
    const sample = historyFor(snapshot, cutoff);
    const key = JSON.stringify([cutoff, snapshot?.as_of, snapshot?.reference_price, snapshot?.prior_high,
      snapshot?.prior_low, snapshot?.open_1930, snapshot?.avr, sample, message]);
    if (lastKey === key) return;
    lastKey = key;
    body.replaceChildren();
    if (!sample) {
      brief.textContent = cutoff ? `${cutoff} NY` : '';
      addText(body, 'p', 'compact-note', message ?? (snapshot ? 'This checkpoint does not include verified BBOX history.' : 'Waiting for a verified TradingView checkpoint.'));
      return;
    }

    const completed = PHASE_COUNTS[cutoff];
    const breached = sample.phases.slice(0, completed).filter(Boolean).length;
    brief.textContent = `${cutoff} NY · ${breached}/${completed} overnight windows breached`;
    const list = document.createElement('ul');
    list.className = 'bbox-history-phases';
    body.append(list);
    for (let i = 0; i < completed; i++) {
      const [name, times] = PHASES[i];
      const mask = sample.phases[i];
      const item = document.createElement('li');
      const label = mask ? (name === '02:00 gap' ? 'Wick breach in the 02:00 gap' : `Wick breach in ${name}`) : `No wick breach · ${name}`;
      addText(item, 'span', '', label);
      addText(item, 'small', '', [times, mask ? displaySide(mask) : ''].filter(Boolean).join(' · '));
      list.append(item);
    }
    addText(body, 'p', 'compact-note', 'The 02:00–03:00 gap counts as a separate window.');
    if (sample.latest_minutes === null) {
      addText(body, 'p', 'compact-note', 'No earlier outside wick from 19:30 to this checkpoint.');
    } else {
      const age = sample.latest_minutes;
      addText(body, 'p', 'compact-note', age === 0 ? 'Last outside wick was in the candle ending at this checkpoint.' : `Last outside wick was in a candle that ended ${age} min before the checkpoint.`);
      const attempts = [sample.attempts_up, sample.attempts_down];
      const repeats = attempts.reduce((total, count) => total + Math.max(0, count - 1), 0);
      addText(body, 'p', 'compact-note', `Confirmed separate entries · ${attempts[0]} upper, ${attempts[1]} lower · ${repeats} same-edge repeat${repeats === 1 ? '' : 's'}`);
      if (sample.inherited === 1 || sample.inherited === 2) addText(body, 'p', 'compact-note', `Price was already outside the ${displaySide(sample.inherited)} at 19:30.`);
    }
    const stats = addText(body, 'div', 'bbox-history-forecast compact-note', 'Calculating BBOX breakout estimate…');
    const show = model => {
      if (lastKey !== key) return;
      try { paintForecast(stats, market, cutoff, snapshot, model); }
      catch { stats.textContent = 'BBOX breakout estimate unavailable for this checkpoint.'; }
    };
    if (snapshot.reference_price < snapshot.prior_low || snapshot.reference_price > snapshot.prior_high) show(null);
    else void loadModel().then(show);
  }
  return {update};
}
