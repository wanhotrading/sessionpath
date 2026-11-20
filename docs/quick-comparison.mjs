const SHAPE_END = { NTA: 0, ASIA: 120, LONDON: 510 };
const PAGE_SIZE = 6;
import { genieFrames, MOTION } from './panel-motion.mjs';
const SITE = new URL('./', import.meta.url);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CHART_PATH = /^(?:(?:es|gc)\/)?charts\/(?:[a-z0-9._-]+\/)*[a-z0-9._-]+\.(?:png|jpe?g|webp)$/i;
const PREVIEW_NAME = /^\d{4}-\d{2}-\d{2}-[0-9a-f]{12}\.webp$/;

export function comparisonCandidates(days, { date, minute, dates }, choices = {}) {
  const tags = Object.entries(choices)
    .filter(([session, value]) => value && SHAPE_END[session] <= minute)
    .map(([session, value]) => [session, session + ':' + value]);
  if (!dates && !tags.length) return [];
  const byDate = new Map(days.filter(day => day.date < date).map(day => [day.date, day]));
  const ordered = dates ?? [...byDate.keys()].sort().reverse();
  return [...new Set(ordered)].map(value => byDate.get(value)).filter(day =>
    day && tags.every(([session, tag]) => day.phaseComplete?.[session] && day.phaseTags?.includes(tag)));
}

function dayScreenshots(archive) {
  const images = new Map();
  for (const image of archive) {
    const previous = images.get(image.date);
    if (!previous || previous.view !== 'overview' && image.view === 'overview') images.set(image.date, image);
  }
  return images;
}

async function fetchPreviewArchive(market) {
  if (!['CL', 'NQ', 'ES', 'GC'].includes(market)) throw Error('Unsupported market');
  const folder = new URL(`charts/previews/v1/${market}/`, SITE);
  const options = { credentials: 'omit' };
  if (typeof AbortSignal.timeout === 'function') options.signal = AbortSignal.timeout(8000);
  const response = await fetch(new URL('index.json', folder), options);
  if (!response.ok) throw Error('Preview archive unavailable');
  const data = await response.json();
  if (data.version !== 1 || data.market !== market || !Array.isArray(data.images) || data.images.length > 5000) throw Error('Invalid preview archive');
  const images = new Map();
  for (const item of data.images) {
    const { date, src, contract, preview } = item || {};
    if (!DATE.test(date) || typeof src !== 'string' || !CHART_PATH.test(src) ||
        src.split('/').some(part => part === '.' || part === '..')) continue;
    images.set(date, {
      contract,
      url: new URL(src, SITE).href,
      preview: PREVIEW_NAME.test(preview) ? new URL(preview, folder).href : null,
    });
  }
  if (data.images.length && !images.size) throw Error('Preview archive has no valid images');
  return images;
}

function makeCard({ day, image }, index, lazy) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'quick-comparison-card';
  card.dataset.chartIndex = index;
  card.setAttribute('aria-label', 'Enlarge chart for ' + day.date);
  const chart = document.createElement('img');
  chart.alt = 'TradingView chart for ' + day.date;
  chart.loading = lazy ? 'lazy' : 'eager';
  chart.decoding = 'async';
  if (image.preview) chart.addEventListener('error', () => { chart.src = image.url; }, { once: true });
  chart.src = image.preview || image.url;
  const caption = document.createElement('span');
  caption.className = 'quick-comparison-caption';
  const date = document.createElement('time');
  date.dateTime = day.date;
  date.textContent = day.date;
  const contract = document.createElement('span');
  contract.textContent = image.contract || day.contract || '';
  caption.append(date, contract);
  card.append(chart, caption);
  return card;
}



export function mountQuickComparison(after, { market, loadArchive, getDays, getChoices }) {
  const section = document.createElement('section');
  section.className = 'quick-comparison';
  section.innerHTML = `
    <button type="button" class="quiet quick-comparison-toggle" aria-haspopup="dialog" aria-expanded="false" aria-controls="quick-comparison-results">
      Compare similar days <span aria-hidden="true">↗</span>
    </button>`;
  after.after(section);
  const toggle = section.firstElementChild;

  const panel = document.createElement('dialog');
  panel.id = 'quick-comparison-results';
  panel.className = 'quick-comparison-results';
  panel.setAttribute('aria-labelledby', 'quick-comparison-title');
  panel.innerHTML = `
    <header class="quick-comparison-toolbar">
      <div class="quick-comparison-summary">
        <h2 id="quick-comparison-title">Compare similar days</h2>
        <p class="quick-comparison-coverage" role="status"></p>
      </div>
      <div class="quick-comparison-navigation" hidden>
        <button type="button" class="quiet quick-comparison-back" hidden>Back to grid</button>
        <button type="button" class="quiet quick-comparison-previous" aria-label="Previous six matched charts">←</button>
        <span class="quick-comparison-position" aria-live="polite"></span>
        <button type="button" class="quiet quick-comparison-next" aria-label="Next six matched charts">→</button>
      </div>
      <button type="button" class="quiet quick-comparison-close" aria-label="Close comparison" autofocus>×</button>
    </header>
    <div class="quick-comparison-grid" role="group" aria-label="Matched day charts" hidden></div>
    <figure class="quick-comparison-detail" hidden>
      <img class="quick-comparison-detail-image" alt="">
      <figcaption class="quick-comparison-caption">
        <span class="quick-comparison-detail-label"></span>
        <a class="quiet quick-comparison-original" target="_blank" rel="noopener noreferrer">Open original ↗</a>
      </figcaption>
    </figure>`;
  document.body.append(panel);
  const coverage = panel.querySelector('.quick-comparison-coverage');
  const controls = panel.querySelector('.quick-comparison-navigation');
  const position = panel.querySelector('.quick-comparison-position');
  const previous = panel.querySelector('.quick-comparison-previous');
  const next = panel.querySelector('.quick-comparison-next');
  const back = panel.querySelector('.quick-comparison-back');
  const close = panel.querySelector('.quick-comparison-close');
  const grid = panel.querySelector('.quick-comparison-grid');
  const detail = panel.querySelector('.quick-comparison-detail');
  const detailImage = panel.querySelector('.quick-comparison-detail-image');
  const detailLabel = panel.querySelector('.quick-comparison-detail-label');
  const original = panel.querySelector('.quick-comparison-original');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const narrow = matchMedia('(max-width: 700px)');
  let forecast;
  let source;
  let loading;
  let animation;
  let frames;
  let closing = false;
  let scheduled = false;
  let signature;
  let charts = [];
  let page = 0;
  let current = null;

  function updateNavigation() {
    const first = page * PAGE_SIZE;
    const single = current !== null;
    controls.hidden = charts.length <= PAGE_SIZE && !single;
    back.hidden = !single;
    previous.setAttribute('aria-label', single ? 'Previous matched day' : 'Previous six matched charts');
    next.setAttribute('aria-label', single ? 'Next matched day' : 'Next six matched charts');
    previous.disabled = single ? current === 0 : page === 0;
    next.disabled = single ? current === charts.length - 1 : first + PAGE_SIZE >= charts.length;
    position.textContent = single ? (current + 1) + ' / ' + charts.length :
      (first + 1) + '–' + Math.min(first + PAGE_SIZE, charts.length) + ' / ' + charts.length;
  }

  function showGrid(focusIndex = null) {
    current = null;
    detail.hidden = true;
    grid.hidden = !charts.length;
    const first = page * PAGE_SIZE;
    grid.replaceChildren(...charts.slice(first, first + PAGE_SIZE).map((item, offset) =>
      makeCard(item, first + offset, narrow.matches && offset > 1)));
    grid.scrollTop = 0;
    updateNavigation();
    if (focusIndex !== null) grid.children[focusIndex - first]?.focus();
  }

  function showDetail(index) {
    const { day, image } = charts[index];
    const entering = current === null;
    current = index;
    page = Math.floor(index / PAGE_SIZE);
    grid.hidden = true;
    detail.hidden = false;
    detailImage.src = image.url;
    detailImage.alt = 'Full TradingView chart for ' + day.date;
    detailLabel.textContent = [day.date, image.contract || day.contract].filter(Boolean).join(' · ');
    original.href = image.url;
    updateNavigation();
    if (entering) back.focus();
  }

  function navigate(delta) {
    if (current !== null) {
      const index = current + delta;
      if (index >= 0 && index < charts.length) showDetail(index);
      return;
    }
    const target = page + delta;
    if (target < 0 || target * PAGE_SIZE >= charts.length) return;
    page = target;
    showGrid();
  }

  function render() {
    if (!panel.open || closing) return;
    const days = getDays();
    const canMatch = Boolean(days?.length && forecast?.date);
    const matches = canMatch ? comparisonCandidates(days, forecast, getChoices(forecast.date)) : [];
    const images = source?.();
    const result = images ? matches.flatMap(day => images.has(day.date) ? [{ day, image: images.get(day.date) }] : []) : [];
    const message = !canMatch ? 'Waiting for the forecast and historical data.' :
      !matches.length ? 'No historical matches for the active forecast and selected outcomes.' :
      !images ? 'Loading archived charts…' :
      result.length ? result.length.toLocaleString() + ' of ' + matches.length.toLocaleString() + ' matched days have screenshots.' :
      'No screenshots are available for these matched days.';
    if (coverage.textContent !== message) coverage.textContent = message;
    const key = result.map(({ day, image }) => day.date + '|' + (image.preview || image.url)).join('\n');
    if (key === signature) return;
    const selectedDate = charts[current]?.day.date;
    signature = key;
    charts = result;
    const selectedIndex = selectedDate ? charts.findIndex(item => item.day.date === selectedDate) : -1;
    if (selectedIndex >= 0) showDetail(selectedIndex);
    else {
      page = 0;
      showGrid();
    }
  }

  function refresh() {
    if (!panel.open || closing || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; render(); });
  }

  function motionEnabled() {
    return !reduced.matches && !document.body.classList.contains('motion-paused');
  }

  function prepareArchive() {
    loading ??= fetchPreviewArchive(market)
      .then(images => { source = () => images; })
      .catch(async () => {
        const archive = await loadArchive();
        source = () => dayScreenshots(archive());
      }).catch(() => { source = () => new Map(); }).finally(refresh);
  }

  function openComparison() {
    if (panel.open) return;
    const anchor = toggle.getBoundingClientRect();
    panel.showModal();
    toggle.setAttribute('aria-expanded', 'true');
    prepareArchive();
    render();
    const bounds = panel.getBoundingClientRect();
    panel.style.transformOrigin = `${anchor.left + anchor.width / 2 - bounds.left}px ${anchor.top + anchor.height / 2 - bounds.top}px`;
    frames = genieFrames(anchor, bounds);
    if (motionEnabled()) animation = panel.animate(frames, MOTION);
  }

  function closeComparison() {
    if (closing) return;
    closing = true;
    if (!motionEnabled()) { panel.close(); return; }
    if (animation?.playState === 'running') animation.reverse();
    else animation = panel.animate(frames, { ...MOTION, direction: 'reverse' });
    animation.onfinish = () => panel.close();
  }

  toggle.addEventListener('pointerdown', prepareArchive, { passive: true });
  toggle.addEventListener('click', openComparison);
  close.addEventListener('click', closeComparison);
  panel.addEventListener('close', () => {
    closing = false;
    animation = null;
    toggle.setAttribute('aria-expanded', 'false');
    if (current !== null) showGrid();
    toggle.focus({ preventScroll: true });
  });
  panel.addEventListener('cancel', event => {
    event.preventDefault();
    if (current !== null && !closing) showGrid(current);
    else closeComparison();
  });
  panel.addEventListener('keydown', event => {
    if (closing || !['ArrowLeft', 'ArrowRight'].includes(event.key) || event.altKey || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    navigate(event.key === 'ArrowRight' ? 1 : -1);
  });
  grid.addEventListener('click', event => {
    const card = event.target.closest('[data-chart-index]');
    if (card && !closing) showDetail(Number(card.dataset.chartIndex));
  });
  back.addEventListener('click', () => { if (!closing) showGrid(current); });
  previous.addEventListener('click', () => { if (!closing) navigate(-1); });
  next.addEventListener('click', () => { if (!closing) navigate(1); });

  return {
    setForecast(value) {
      if (forecast?.date === value.date && forecast?.minute === value.minute && forecast?.dates === value.dates) return;
      forecast = value;
      refresh();
    },
    refresh,
  };
}
