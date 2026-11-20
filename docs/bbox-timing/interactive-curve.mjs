import { probabilityAxis, smoothSegments } from '../bbox-curve.mjs?v=live-time-20261023';
import { time } from './core.mjs?v=conditional-20261119';

const left = 50, right = 620, top = 16, bottom = 170;
const fmt = number => number.toFixed(2);

export function mountTimingCurve(svg, select) {
  let points = [], marker, x, y, start, end, active;
  let captured = null, queued = 0, clientPoint;
  svg.setAttribute('viewBox', '0 0 642 207');
  svg.setAttribute('role', 'slider');
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-label', 'Explore remaining breach probability by five-minute observation');
  svg.classList.add('overnight-curve');

  function moveMarker(step) {
    if (!points.length || !marker) return;
    active = Math.max(start, Math.min(step, end));
    const point = points[active - start];
    const finite = Number.isFinite(point?.p);
    const at = x(active);
    marker.style.transform = `translateX(${at}px)`;
    const dot = marker.querySelector('circle');
    dot.style.transform = `translateY(${finite ? y(point.p) : bottom}px)`;
    marker.classList.toggle('no-sample', !finite);
    svg.setAttribute('aria-valuenow', String(active));
    svg.setAttribute('aria-valuetext', time(active) + ' NY · ' +
      (finite ? (100 * point.p).toFixed(1) + '%' : 'No matching dates'));
  }

  function draw(data, selected) {
    if (!data.length) return;
    points = data;
    start = data[0].step;
    end = data.at(-1).step;
    const span = Math.max(1, end - start);
    const axis = probabilityAxis(data);
    x = step => left + (step - start) / span * (right - left);
    y = p => bottom - p / axis.top * (bottom - top);
    const guides = axis.ticks.map(p => `<line x1="${left}" x2="${right}" y1="${y(p)}" y2="${y(p)}" class="ot-grid"/><text x="40" y="${y(p)+5}" text-anchor="end">${Math.round(p*100)}%</text>`).join('');
    const tickSpacing = span < 30 ? 6 : span <= 45 ? 12 : 24;
    const ticks = [start, ...data.filter(p=>p.step > start && p.step < end && p.step % tickSpacing === 0 &&
      x(p.step)-left >= 64 && right-x(p.step) >= 64).map(p=>p.step), end];
    const labels = ticks.map(step => `<text x="${x(step)}" y="194" text-anchor="${step===start?'start':step===end?'end':'middle'}">${time(step)}</text>`).join('');
    const paths = { normal: [], thin: [] };
    for (const group of smoothSegments(data.map(point=>({...point,minute:point.step})))) {
      let previous;
      if (!group.segments.length) {
        const a = group.start, px = x(a.step), py = y(a.p);
        paths[a.n < 30 ? 'thin' : 'normal'].push(`M${fmt(px)} ${fmt(py)}h.1`);
      }
      for (const {a,b,c1,c2} of group.segments) {
        const type = a.n < 30 || b.n < 30 ? 'thin' : 'normal';
        if (previous !== type) paths[type].push(`M${fmt(x(a.step))} ${fmt(y(a.p))}`);
        paths[type].push(`C${fmt(x(c1.minute))} ${fmt(y(c1.p))} ${fmt(x(c2.minute))} ${fmt(y(c2.p))} ${fmt(x(b.step))} ${fmt(y(b.p))}`);
        previous = type;
      }
    }
    svg.innerHTML = guides + labels +
      `<path class="ot-trend" d="${paths.normal.join(' ')}"/><path class="ot-trend ot-thin" d="${paths.thin.join(' ')}"/>
      <g class="ot-marker"><line class="ot-guide" y1="${top}" y2="${bottom}"/><circle r="6" class="ot-dot"/></g>`;
    marker = svg.querySelector('.ot-marker');
    svg.setAttribute('aria-valuemin', String(start));
    svg.setAttribute('aria-valuemax', String(end));
    moveMarker(selected);
  }

  function atPointer(clientX, clientY) {
    const transform = svg.getScreenCTM();
    if (!transform) return;
    const pointer = new DOMPoint(clientX, clientY).matrixTransform(transform.inverse());
    const step = Math.max(start, Math.min(end, Math.round(start + (pointer.x-left)/(right-left)*(end-start))));
    select(step);
  }
  svg.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || !points.length) return;
    captured = event.pointerId;
    svg.setPointerCapture(captured);
    svg.focus({ preventScroll:true });
    atPointer(event.clientX,event.clientY);
  });
  svg.addEventListener('pointermove', event => {
    if (event.pointerId !== captured) return;
    clientPoint = [event.clientX, event.clientY];
    if (!queued) queued = requestAnimationFrame(() => { queued=0; atPointer(...clientPoint); });
  });
  svg.addEventListener('pointerup', event => {
    if (event.pointerId === captured) atPointer(event.clientX, event.clientY);
  });
  svg.addEventListener('lostpointercapture', () => {
    captured = null;
    if (queued) cancelAnimationFrame(queued);
    queued = 0;
  });
  svg.addEventListener('keydown', event => {
    if (!points.length || !['ArrowLeft','ArrowRight','ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === 'Home' ? start : event.key === 'End' ? end :
      active + (event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1);
    select(Math.max(start, Math.min(end, step)));
  });
  return { draw, moveMarker };
}
