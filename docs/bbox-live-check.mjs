import { curveGeometry } from './bbox-curve.mjs?v=live-time-20261023';
import { createOnlineClock, nyClockParts } from './ny-online-clock.mjs?v=automatic-bbox-20261118';
import { validatePersonalRead } from './tradingview-live-core.mjs?v=feed-watermark-20261118';

const firstClose = 185;
const deadline = 510;
const barLength = 5;
const msPerBar = barLength * 60_000;
const time = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const percent = p => Number.isFinite(p) ? (100 * p).toFixed(1) + '%' : '—';
const priceFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });
const sideName = side => side > 0 ? 'Above' : side < 0 ? 'Below' : 'Inside';

function sideOf(price, low, high) {
  return price > high + 1e-8 ? 1 : price < low - 1e-8 ? -1 : 0;
}

export function locateBBoxObservation(packet, clock, estimate) {
  const epoch = Date.parse(packet?.observed_at);
  if (!Number.isFinite(epoch) || epoch % msPerBar !== 0 || !Number.isFinite(packet.last_price)) {
    throw new Error('Waiting for a verified five-minute close.');
  }
  const close = nyClockParts(epoch);
  if (packet.session_date !== clock.date || close.date !== clock.date || close.minute !== clock.completed) {
    throw new Error('Waiting for the latest five-minute close. Check again shortly.');
  }
  if (close.minute < firstClose) throw new Error('The first check is the 03:05 NY close.');
  // The 05:00 close belongs to the candle that opened at 04:55.
  const window = close.minute <= 300 ? { cutoff: '03:00', minute: 180, endMinute: 300 } :
    close.minute <= deadline ? { cutoff: '05:00', minute: 300, endMinute: deadline } :
    { cutoff: '08:30', minute: deadline, endMinute: 960 };
  const snapshot = packet.snapshots?.find(item => item.cutoff === window.cutoff);
  if (!snapshot || !Number.isFinite(snapshot.prior_low) || !Number.isFinite(snapshot.prior_high) ||
      snapshot.prior_low >= snapshot.prior_high) throw new Error('Waiting for the ' + window.cutoff + ' forecast inputs.');
  const mean = estimate(snapshot, window, close.date);
  if (!mean || !Number.isFinite(mean.low) || !Number.isFinite(mean.high) || mean.low > mean.high) {
    throw new Error('The ' + window.cutoff + ' SessionPath box has no eligible forecast.');
  }
  const price = packet.last_price;
  const bbox = { low: snapshot.prior_low, high: snapshot.prior_high };
  const side = sideOf(price, bbox.low, bbox.high);
  const sessionSide = sideOf(price, mean.low, mean.high);
  const group = !side ? null : sessionSide === side ? 1 : sessionSide === -side ? 2 : 3;
  return { date: close.date, minute: close.minute, epoch, price, side, group, sessionSide, bbox, mean, window };
}

export function advanceBBoxObservation(observation, lastEpoch, packet) {
  const epoch = Date.parse(packet?.observed_at);
  if (packet.session_date !== observation.date || !Number.isFinite(epoch) || epoch % msPerBar !== 0 ||
      epoch <= lastEpoch || !Number.isFinite(packet.last_price)) return null;
  const close = nyClockParts(epoch);
  if (close.date !== observation.date || close.minute > deadline) return null;
  const returned = !sideOf(packet.last_price, observation.bbox.low, observation.bbox.high);
  const gap = !returned && epoch - lastEpoch !== msPerBar;
  return { epoch, minute: close.minute, returned, gap };
}

function text(doc, tag, className, value = '') {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  el.textContent = value;
  return el;
}

function interactiveCurve(host, points, current) {
  const doc = host.ownerDocument;
  const chart = text(doc, 'div', 'br-decay bbox-check-curve');
  const g = curveGeometry(points, deadline, current);
  chart.innerHTML = `<svg viewBox="0 0 640 265" role="img" aria-label="Remaining chance of a close inside the BBOX">
    ${g.axis.ticks.map(p => `<line x1="62" x2="616" y1="${g.y(p)}" y2="${g.y(p)}" class="br-grid"/><text x="49" y="${g.y(p) + 5}" text-anchor="end">${Math.round(p * 100)}%</text>`).join('')}
    ${g.ticks.map(p => `<text x="${g.x(p.minute)}" y="247" text-anchor="middle">${time(p.minute)}</text>`).join('')}
    <path d="${g.path}" fill="none" stroke="#bda7ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <g class="br-now-marker"><line y1="28" y2="216" class="br-now-guide"/><g><circle class="br-now-ring" r="4"/><circle class="br-now-dot" r="4"/></g></g>
    <g class="bbox-check-cursor" visibility="hidden"><line y1="28" y2="216"/><circle r="4"/></g></svg>`;
  const svg = chart.querySelector('svg');
  const live = svg.querySelector('.br-now-marker');
  const cursor = svg.querySelector('.bbox-check-cursor');
  const readout = text(doc, 'output', 'bbox-curve-readout');
  readout.setAttribute('aria-live', 'polite');
  const slider = text(doc, 'input', 'bbox-curve-scrub');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(points.length - 1);
  slider.step = '1';
  slider.setAttribute('aria-label', 'Explore remaining probability by New York close');
  chart.append(readout, slider);
  host.append(chart);
  let activeMinute = current;
  let exploring = false;
  function position(marker, point) {
    const visible = Number.isFinite(point?.p);
    marker.setAttribute('visibility', visible ? 'visible' : 'hidden');
    if (!visible) return;
    const x = g.x(point.minute);
    const line = marker.querySelector('line');
    line.setAttribute('x1', x);
    line.setAttribute('x2', x);
    marker.lastElementChild.setAttribute('transform', `translate(${x} ${g.y(point.p)})`);
  }
  function showPoint(index, explore) {
    const point = points[index];
    if (!point) return;
    slider.value = String(index);
    const label = time(point.minute) + ' NY · ' + percent(point.p) +
      (point.n ? ` · ${point.k}/${point.n} dates` : ' · No eligible dates');
    if (readout.textContent !== label) readout.textContent = label;
    slider.setAttribute('aria-valuetext', label);
    position(cursor, explore ? point : null);
  }
  const indexAt = minute => Math.round((minute - g.start) / barLength);
  function setCurrent(minute, tracking) {
    activeMinute = minute;
    position(live, tracking ? points[indexAt(minute)] : null);
    chart.dataset.live = String(tracking);
    if (!exploring) showPoint(indexAt(minute), false);
  }
  function pointer(event) {
    const bounds = svg.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * 640 / bounds.width;
    const ratio = (x - 62) / 554;
    const index = Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))));
    exploring = true;
    showPoint(index, true);
  }
  svg.addEventListener('pointermove', event => { if (event.pointerType === 'mouse') pointer(event); });
  svg.addEventListener('click', pointer);
  svg.addEventListener('pointerleave', event => {
    if (event.pointerType !== 'mouse') return;
    exploring = false;
    showPoint(indexAt(activeMinute), false);
  });
  slider.addEventListener('input', () => { exploring = true; showPoint(Number(slider.value), true); });
  setCurrent(current, true);
  return setCurrent;
}

export function mountLiveBBoxCheck(host, {
  market, archiveURL, feedURL, estimate, stats, makeCode, year, isReplay,
  ready, clock = createOnlineClock(), fetchImpl = fetch,
}) {
  const doc = host.ownerDocument;
  const view = doc.defaultView;
  const header = text(doc, 'div', 'bbox-check-header');
  const title = text(doc, 'h2', '', 'BBOX return probability');
  const clockLabel = text(doc, 'time', 'bbox-check-clock');
  clockLabel.setAttribute('aria-label', 'New York time');
  const check = text(doc, 'button', 'quiet bbox-check-button', 'Check now');
  check.type = 'button';
  header.append(title, clockLabel, check);
  const summary = text(doc, 'p', 'bbox-check-note');
  summary.setAttribute('role', 'status');
  const result = text(doc, 'div', 'bbox-check-result');
  host.replaceChildren(header, summary, result);
  let archive;
  let run = 0;
  let active;
  let code = '';
  let request;
  let refreshCode;
  let nyModel;
  doc.addEventListener('sessionpath:forecast-export', event => {
    const model = event.detail?.model;
    if (model?.query?.minute === deadline && model.query.endMinute === 960) nyModel = model;
  });
  function estimateCurrent(snapshot, window, date) {
    if (window.minute !== deadline) return estimate(snapshot, window, date);
    const q = nyModel?.query;
    if (!nyModel?.box || q?.date !== date || ![['price', 'reference_price'], ['avr', 'avr'], ['rangeHigh', 'range_high'], ['rangeLow', 'range_low']]
      .every(([key, field]) => q[key] != null && Math.abs(q[key] - snapshot[field]) < 1e-7)) return null;
    return { low: q.price - nyModel.box.downPoints, high: q.price + nyModel.box.upPoints };
  }

  const load = () => archive ??= fetchImpl(archiveURL).then(async response => {
    if (!response.ok) throw new Error('BBOX history is unavailable. Check again to retry.');
    const data = await response.json();
    if (!Array.isArray(data.days)) throw new Error('BBOX history could not be read.');
    return data.days;
  }).catch(error => { archive = null; throw error; });

  function finish(message, minute) {
    if (!active?.tracking) return;
    active.tracking = false;
    active.current = minute ?? active.current;
    active.setCurrent(active.current, false);
    code = '';
    refreshCode?.();
    summary.textContent = message;
  }

  function refreshClock() {
    const now = clock.read();
    clockLabel.textContent = 'New York · ' + now.clock + ' ' + (now.zone || 'ET');
    if (!active?.tracking) return;
    if (active.observation.date !== now.date || now.minute >= deadline + 2) {
      finish('Tracking reached 08:30 NY.', deadline);
    } else if (now.minute >= deadline) {
      code = '';
      refreshCode?.();
      summary.textContent = 'Waiting for the final 08:30 NY close.';
    }
  }
  const sync = () => { void clock.sync().then(refreshClock, () => {}); };
  refreshClock();
  sync();
  const ticker = view.setInterval(() => { if (!doc.hidden) refreshClock(); }, 1000);
  const resync = view.setInterval(() => { if (!doc.hidden) sync(); }, 300_000);
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden) { refreshClock(); sync(); } });
  view.addEventListener('pagehide', event => {
    if (event.persisted) return;
    view.clearInterval(ticker);
    view.clearInterval(resync);
    request?.abort();
  });

  function clear() {
    run++;
    request?.abort();
    active = null;
    code = '';
    refreshCode = null;
    result.replaceChildren();
    summary.textContent = '';
    check.disabled = false;
  }
  const replayToggle = doc.getElementById('replay-toggle');
  replayToggle?.addEventListener('change', () => {
    clear();
    if (isReplay()) summary.textContent = 'Choose Back to today for a live check.';
  });
  doc.getElementById('trading-date')?.addEventListener('change', () => {
    if (!isReplay()) return;
    clear();
    summary.textContent = 'Choose Back to today for a live check.';
  });

  function setCode(point, q) {
    code = '';
    if (active?.tracking && point?.n && point.minute < deadline) {
      try { code = makeCode({ ...q, now: point.minute }, { remaining: point }, time(q.observation)); } catch {}
    }
    refreshCode?.();
  }

  doc.addEventListener('sessionpath:verified-checkpoints', ({ detail: packet }) => {
    if (!active?.tracking || packet.market !== market || isReplay()) return;
    const next = advanceBBoxObservation(active.observation, active.lastEpoch, packet);
    if (!next) return;
    active.lastEpoch = next.epoch;
    if (next.returned) { finish('Returned inside the BBOX on the ' + time(next.minute) + ' NY close.', next.minute); return; }
    if (next.gap) { finish('A completed close is missing. Check again to start a new observation.'); return; }
    if (next.minute >= deadline) { finish('Tracking reached 08:30 NY.', deadline); return; }
    active.current = next.minute;
    active.setCurrent(next.minute, true);
    setCode(active.points.find(point => point.minute === next.minute), active.q);
  });

  check.addEventListener('click', async () => {
    clear();
    const revision = run;
    const now = clock.read();
    if (isReplay()) { summary.textContent = 'Choose Back to today for a live check.'; return; }
    if (now.minute < firstClose) {
      summary.textContent = 'The first check is the 03:05 NY close.';
      return;
    }
    if (!ready()) { summary.textContent = 'Loading forecast history. Check again shortly.'; return; }
    check.disabled = true;
    summary.textContent = 'Checking the latest five-minute close…';
    const currentRequest = new view.AbortController();
    request = currentRequest;
    const timer = view.setTimeout(() => currentRequest.abort(), 9000);
    try {
      const endpoint = new URL(feedURL);
      endpoint.searchParams.set('market', market);
      const response = await fetchImpl(endpoint, { signal: currentRequest.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error('TradingView feed unavailable. Check again to retry.');
      const body = await response.json();
      if (run !== revision) return;
      const checked = clock.read();
      const packet = validatePersonalRead(body, { market, now: checked.epoch });
      if (!packet) throw new Error('Waiting for a verified five-minute close.');
      const observation = locateBBoxObservation(packet, checked, estimateCurrent);
      const classification = text(doc, 'p', 'bbox-check-classification', `${time(observation.minute)} NY close · ${priceFormat.format(observation.price)}`);
      const boxes = text(doc, 'div', 'bbox-check-boxes');
      for (const [label, side, bounds] of [['BBOX', observation.side, observation.bbox], ['SessionPath', observation.sessionSide, observation.mean]]) {
        const chip = text(doc, 'span', '', label + ' · ' + sideName(side));
        chip.title = priceFormat.format(bounds.low) + '–' + priceFormat.format(bounds.high);
        boxes.append(chip);
      }
      result.append(classification, boxes);
      if (observation.minute >= deadline) { summary.textContent = 'The 08:30 NY return window has ended.'; return; }
      if (!observation.side) { summary.textContent = 'Price is already inside the BBOX.'; return; }
      const q = { date: observation.date, year: year(), anchor: Math.floor(observation.minute / 30) * 30,
        now: observation.minute, end: deadline, side: observation.side, group: observation.group, observation: observation.minute };
      const days = await load();
      if (run !== revision) return;
      const model = stats(days, q);
      if (!model.remaining.n) { summary.textContent = 'No earlier cases matched this close and box relationship.'; return; }
      summary.textContent = 'The curve assumes no completed close has returned yet.';
      const setCurrent = interactiveCurve(result, model.decay, observation.minute);
      active = { tracking: true, observation, current: observation.minute, lastEpoch: observation.epoch, points: model.decay, q, setCurrent };
      const transfer = text(doc, 'div', 'bbox-check-transfer');
      const copy = text(doc, 'button', 'quiet', 'Copy BBOX return code');
      const feedback = text(doc, 'span', 'bbox-check-note');
      feedback.setAttribute('role', 'status');
      copy.type = 'button';
      refreshCode = () => {
        copy.disabled = !code;
        const field = transfer.querySelector('textarea');
        if (field) {
          if (code) field.value = code;
          else field.remove();
        }
      };
      copy.addEventListener('click', async () => {
        if (!code) return;
        try { await view.navigator.clipboard.writeText(code); feedback.textContent = 'Copied.'; }
        catch {
          const field = text(doc, 'textarea', 'bbox-check-code');
          field.readOnly = true;
          field.value = code;
          field.setAttribute('aria-label', 'BBOX return code');
          transfer.querySelector('textarea')?.remove();
          transfer.append(field);
          field.select();
          feedback.textContent = 'Code selected.';
        }
      });
      transfer.append(copy, feedback);
      result.append(transfer);
      setCode(model.remaining.n ? model.decay[0] : null, q);
      refreshClock();
    } catch (error) {
      if (run === revision) summary.textContent = error.name === 'AbortError' ? 'TradingView check timed out. Check again to retry.' : error.message;
    } finally {
      view.clearTimeout(timer);
      if (revision === run) check.disabled = false;
    }
  });
}
