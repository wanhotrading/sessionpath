import { curveGeometry } from './bbox-curve.mjs?v=live-time-20261023';
import { createOnlineClock, nyClockParts } from './ny-online-clock.mjs?v=automatic-bbox-20261118';
import { validatePersonalRead } from './tradingview-live-core.mjs?v=feed-watermark-20261118';

import { afternoonStart, afternoonEnd, readAfternoonArchive, afternoonReturnStats, returnQuartile, minimumQuartileSample } from './bbox-ny-return.mjs?v=bbox-return-quartiles-20261125';

const firstClose = 185;
const closedMessage = 'The live BBOX return window ended at 16:00 NY.';
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
  const age = clock.completed - close.minute;
  if (packet.session_date !== clock.date || close.date !== clock.date || age < 0 || age > 5) {
    throw new Error('Waiting for the latest five-minute close.');
  }
  if (close.minute < firstClose) throw new Error('The first check is the 03:05 NY close.');
  if (close.minute > afternoonEnd) throw new Error(closedMessage);
  // The 05:00 close belongs to the candle that opened at 04:55.
  const afternoon = close.minute >= afternoonStart;
  const window = afternoon ? { cutoff: '08:30', minute: afternoonStart, endMinute: afternoonEnd } :
    close.minute <= 300 ? { cutoff: '03:00', minute: 180, endMinute: 300 } :
    { cutoff: '05:00', minute: 300, endMinute: afternoonStart };
  const snapshots = packet.snapshots || [];
  const exact = snapshots.find(item => item.cutoff === window.cutoff);
  const snapshot = exact ?? (afternoon ? snapshots.at(-1) : null);
  if (!snapshot || !Number.isFinite(snapshot.prior_low) || !Number.isFinite(snapshot.prior_high) ||
      snapshot.prior_low >= snapshot.prior_high) throw new Error('Waiting for the ' + window.cutoff + ' forecast inputs.');
  const forecast = exact ? estimate(exact, window, close.date) : null;
  const mean = forecast && Number.isFinite(forecast.low) && Number.isFinite(forecast.high) &&
    forecast.low <= forecast.high ? forecast : null;
  if (!mean && !afternoon) throw new Error('The ' + window.cutoff + ' SessionPath box has no eligible forecast.');
  const price = packet.last_price;
  const bbox = { low: snapshot.prior_low, high: snapshot.prior_high };
  const side = sideOf(price, bbox.low, bbox.high);
  const sessionSide = mean ? sideOf(price, mean.low, mean.high) : null;
  const group = !side || !mean ? null : sessionSide === side ? 1 : sessionSide === -side ? 2 : 3;
  const distance = side && snapshot.avr > 0 ? Math.abs(price - (side > 0 ? bbox.high : bbox.low)) / snapshot.avr : null;
  return { date: close.date, minute: close.minute, epoch, price, side, group, sessionSide, bbox, mean, window, distance, afternoon };
}

export function advanceBBoxObservation(observation, lastEpoch, packet) {
  const epoch = Date.parse(packet?.observed_at);
  if (packet.session_date !== observation.date || !Number.isFinite(epoch) || epoch % msPerBar !== 0 ||
      epoch <= lastEpoch || !Number.isFinite(packet.last_price)) return null;
  const close = nyClockParts(epoch);
  const end = observation.afternoon ? afternoonEnd : afternoonStart;
  if (close.date !== observation.date || close.minute > end) return null;
  const returned = !sideOf(packet.last_price, observation.bbox.low, observation.bbox.high);
  return { epoch, minute: close.minute, returned, gap: epoch - lastEpoch !== msPerBar };
}

function text(doc, tag, className, value = '') {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  el.textContent = value;
  return el;
}

function interactiveCurve(host, points, current, end) {
  const doc = host.ownerDocument;
  const chart = text(doc, 'div', 'br-decay bbox-check-curve');
  const g = curveGeometry(points, end, current);
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
  const quartileBadge = text(doc, 'span', 'bbox-return-quartile');
  quartileBadge.hidden = true;
  header.append(title, clockLabel, check, quartileBadge);
  const summary = text(doc, 'p', 'bbox-check-note');
  summary.setAttribute('role', 'status');
  const result = text(doc, 'div', 'bbox-check-result');
  host.replaceChildren(header, summary, result);
  const archives = new Map();
  let run = 0;
  let active;
  let code = '';
  let request;
  let refreshCode;
  let nyModel;
  let pendingEpoch = null;
  let lastAccepted = null;

  doc.addEventListener('sessionpath:forecast-export', event => {
    const model = event.detail?.model;
    if (model?.query?.minute === afternoonStart && model.query.endMinute === afternoonEnd) nyModel = model;
  });

  function estimateCurrent(snapshot, window, date) {
    if (window.minute !== afternoonStart) return estimate(snapshot, window, date);
    const q = nyModel?.query;
    if (nyModel?.conditions?.method !== 'Prior Wide' || !nyModel.box || q?.date !== date ||
        ![['price', 'reference_price'], ['avr', 'avr'], ['rangeHigh', 'range_high'], ['rangeLow', 'range_low']]
          .every(([key, field]) => q[key] != null && Math.abs(q[key] - snapshot[field]) < 1e-7)) return null;
    return { low: q.price - nyModel.box.downPoints, high: q.price + nyModel.box.upPoints };
  }

  function loadHistory(afternoon) {
    if (archives.has(afternoon)) return archives.get(afternoon);
    const url = afternoon ? new URL('./bbox-return-ny/' + market + '.json?v=20261125', import.meta.url) : archiveURL;
    const promise = fetchImpl(url).then(async response => {
      if (!response.ok) throw new Error('BBOX history is unavailable. Check again to retry.');
      const data = await response.json();
      if (afternoon) return readAfternoonArchive(data, market);
      if (!Array.isArray(data.days)) throw new Error('BBOX history could not be read.');
      return data.days;
    }).catch(error => { archives.delete(afternoon); throw error; });
    archives.set(afternoon, promise);
    return promise;
  }

  function setCode(point, q) {
    code = '';
    if (active?.tracking && point?.n && point.minute < afternoonStart) {
      try { code = makeCode({ ...q, now: point.minute }, { remaining: point }, time(q.observation)); } catch {}
    }
    refreshCode?.();
  }

  function showQuartile(minute) {
    const index = (minute - active.observation.minute) / barLength;
    const quartile = returnQuartile(active.points[index], active.peerCurves.map(curve => curve[index]));
    quartileBadge.hidden = !quartile;
    if (!quartile) return;
    quartileBadge.dataset.band = quartile.band;
    quartileBadge.textContent = { upper: 'Top quartile', middle: 'Middle half', lower: 'Bottom quartile' }[quartile.band];
    quartileBadge.title = 'Compared with other historical groups for this market, BBOX side and time.';
  }

  function finish(message, minute) {
    quartileBadge.hidden = true;
    active.tracking = false;
    active.current = minute ?? active.current;
    active.setCurrent(active.current, false);
    setCode(null, active.q);
    summary.textContent = message;
  }

  function resetResult() {
    run++;
    quartileBadge.hidden = true;
    active = null;
    pendingEpoch = lastAccepted = null;
    code = '';
    refreshCode = null;
    result.replaceChildren();
    summary.textContent = '';
  }

  function refreshClock() {
    const now = clock.read();
    clockLabel.textContent = 'New York · ' + now.clock + ' ' + (now.zone || 'ET');
    if (isReplay()) return;
    if (lastAccepted && lastAccepted.date !== now.date) resetResult();
    if (!active?.tracking) {
      if (!lastAccepted && !request && pendingEpoch === null && now.minute >= afternoonEnd + 2) {
        summary.textContent = closedMessage;
      }
      return;
    }
    if (now.minute >= active.q.end + 2) {
      finish(active.q.end === afternoonEnd ? 'The 16:00 NY window ended. The final close was not received.' :
        'Waiting for the first New York close to start the 16:00 estimate.');
    } else if (now.minute >= active.q.end) {
      quartileBadge.hidden = true;
      setCode(null, active.q);
      summary.textContent = 'Waiting for the ' + time(active.q.end) + ' NY close.';
    } else if (now.completed - active.current >= 10) {
      quartileBadge.hidden = true;
      setCode(null, active.q);
      active.setCurrent(active.current, false);
      summary.textContent = 'Waiting for a fresh verified close. The chart is paused.';
    }
  }

  const sync = () => { void clock.sync().then(refreshClock, () => {}); };
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

  function replayChanged() {
    request?.abort();
    request = null;
    resetResult();
    check.disabled = false;
    if (isReplay()) summary.textContent = 'Choose Back to today for a live check.';
    else refreshClock();
  }

  doc.getElementById('replay-toggle')?.addEventListener('change', replayChanged);
  doc.getElementById('trading-date')?.addEventListener('change', () => {
    if (isReplay()) replayChanged();
  });

  function renderClassification(observation) {
    const classification = text(doc, 'p', 'bbox-check-classification',
      time(observation.minute) + ' NY close · ' + priceFormat.format(observation.price));
    const boxes = text(doc, 'div', 'bbox-check-boxes');
    for (const [label, side, bounds] of [['BBOX', observation.side, observation.bbox], ['SessionPath', observation.sessionSide, observation.mean]]) {
      if (!bounds) continue;
      const chip = text(doc, 'span', '', label + ' · ' + sideName(side));
      chip.title = priceFormat.format(bounds.low) + '–' + priceFormat.format(bounds.high);
      boxes.append(chip);
    }
    result.replaceChildren(classification, boxes);
  }

  function addTransfer() {
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
  }

  async function usePacket(packet, now, manual = false) {
    if (!packet || packet.market !== market || isReplay() || now.minute < firstClose || now.minute >= afternoonEnd + 2) return;
    const epoch = Date.parse(packet.observed_at);
    if (lastAccepted && lastAccepted.date !== now.date) resetResult();
    if (epoch < (lastAccepted?.epoch ?? -Infinity) || (!manual && epoch === lastAccepted?.epoch) ||
        epoch <= (pendingEpoch ?? -Infinity)) return;
    const observation = locateBBoxObservation(packet, now, estimateCurrent);
    const deadline = observation.afternoon ? afternoonEnd : afternoonStart;
    let gap = false;
    if (active?.tracking && active.q.end === deadline && active.observation.date === observation.date) {
      const next = advanceBBoxObservation(active.observation, active.lastEpoch, packet);
      if (!next && !manual) return;
      if (next && (next.returned || next.minute === deadline || (!manual && !next.gap))) {
        lastAccepted = observation;
        active.lastEpoch = next.epoch;
        if (next.returned) {
          finish(next.gap ? 'The ' + time(next.minute) + ' NY close is inside the BBOX.' :
            'Returned inside the BBOX on the ' + time(next.minute) + ' NY close.', next.minute);
        } else if (next.minute === deadline) {
          finish('16:00 NY close verified. Price ended outside the BBOX.', next.minute);
        } else {
          active.current = next.minute;
          active.setCurrent(next.minute, true);
          showQuartile(next.minute);
          summary.textContent = active.note;
          setCode(active.points.find(point => point.minute === next.minute), active.q);
        }
        return;
      }
      gap = next?.gap ?? false;
    }

    const revision = ++run;
    active = null;
    quartileBadge.hidden = true;
    code = '';
    refreshCode = null;
    pendingEpoch = epoch;
    renderClassification(observation);
    try {
      if (observation.minute === afternoonEnd) {
        summary.textContent = '16:00 NY close verified. Price ended ' + (observation.side ? 'outside' : 'inside') + ' the BBOX.';
      } else if (!observation.side) {
        summary.textContent = 'The latest close is inside the BBOX.';
      } else {
        summary.textContent = 'Loading BBOX return history…';
        const q = { date: observation.date, year: year(), anchor: Math.floor(observation.minute / 30) * 30,
          now: observation.minute, end: deadline, side: observation.side, group: observation.group,
          observation: observation.minute, distance: observation.distance };
        const days = await loadHistory(observation.afternoon);
        if (run !== revision) return;
        const model = (observation.afternoon ? afternoonReturnStats : stats)(days, q);
        if (!model.remaining.n) {
          summary.textContent = 'No earlier cases matched this close and box relationship.';
        } else {
          const note = (gap ? 'A close was missed. Tracking restarted at ' + time(observation.minute) + ' NY. ' : '') +
            'Chance of a close back inside by ' + time(deadline) + ' NY, if still outside.' +
            (model.criteria ? ' Historical match uses ' + model.criteria + '.' : '') +
            (model.remaining.n < 25 ? ' Small historical sample.' : '');
          summary.textContent = note;
          const setCurrent = interactiveCurve(result, model.decay, observation.minute, deadline);
          const peerCurves = model.peerCurves ?? (model.remaining.n >= minimumQuartileSample ?
            [1, 2, 3].map(group => (group === q.group ? model : stats(days, { ...q, group })).decay) : []);
          active = { tracking: true, observation, current: observation.minute, lastEpoch: epoch, points: model.decay, q, setCurrent, note, peerCurves };
          showQuartile(observation.minute);
          if (!observation.afternoon) addTransfer();
          setCode(model.decay[0], q);
        }
      }
      lastAccepted = observation;
      refreshClock();
    } finally {
      if (run === revision) pendingEpoch = null;
    }
  }

  doc.addEventListener('sessionpath:verified-checkpoints', ({ detail: packet }) => {
    const now = clock.read();
    if (!request && (ready() || now.minute >= afternoonStart)) {
      void usePacket(packet, now).catch(error => { summary.textContent = error.message; });
    }
  });

  check.addEventListener('click', async () => {
    const now = clock.read();
    if (isReplay()) { summary.textContent = 'Choose Back to today for a live check.'; return; }
    if (now.minute < firstClose) { summary.textContent = 'The first check is the 03:05 NY close.'; return; }
    if (now.minute >= afternoonEnd) { refreshClock(); return; }
    if (!ready() && now.minute < afternoonStart) { summary.textContent = 'Loading forecast history. Check again shortly.'; return; }
    check.disabled = true;
    const priorStatus = summary.textContent;
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
      if (request !== currentRequest) return;
      const checked = clock.read();
      const packet = validatePersonalRead(body, { market, now: checked.epoch });
      if (!packet) throw new Error('Waiting for a verified five-minute close.');
      await usePacket(packet, checked, true);
      if (summary.textContent === 'Checking the latest five-minute close…') summary.textContent = priorStatus;
    } catch (error) {
      if (request === currentRequest) {
        summary.textContent = error.name === 'AbortError' ? 'TradingView check timed out. Check again to retry.' : error.message;
      }
    } finally {
      view.clearTimeout(timer);
      if (request === currentRequest) {
        request = null;
        check.disabled = false;
      }
    }
  });
  refreshClock();
}
