const SHAPE_END = { NTA: 0, ASIA: 120, LONDON: 510 };
const BATCH = 12;

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

function makeSlide(day, image) {
  const slide = document.createElement('article');
  slide.className = 'quick-comparison-slide';
  const heading = document.createElement('h3');
  const date = document.createElement('time');
  date.dateTime = day.date;
  date.textContent = day.date;
  heading.append(date);
  const contract = image.contract || day.contract;
  if (contract) {
    const symbol = document.createElement('span');
    symbol.textContent = contract;
    heading.append(symbol);
  }
  const link = document.createElement('a');
  link.href = image.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', 'Open full chart for ' + day.date + ' in a new tab');
  const chart = document.createElement('img');
  chart.src = image.url;
  chart.alt = 'TradingView chart for ' + day.date;
  chart.loading = 'lazy';
  chart.decoding = 'async';
  link.append(chart);
  slide.append(heading, link);
  return slide;
}

export function mountQuickComparison(after, { loadArchive, getDays, getChoices }) {
  const section = document.createElement('section');
  section.className = 'quick-comparison';
  section.innerHTML = `
    <button type="button" class="quiet quick-comparison-toggle" aria-expanded="false" aria-controls="quick-comparison-results">
      Compare similar days <span aria-hidden="true">⌄</span>
    </button>
    <div id="quick-comparison-results" class="quick-comparison-results" hidden inert>
      <div class="quick-comparison-toolbar">
        <p class="quick-comparison-coverage" role="status"></p>
        <div class="quick-comparison-navigation" hidden>
          <button type="button" class="quiet" aria-label="Previous matched day">←</button>
          <span class="quick-comparison-position" aria-live="polite"></span>
          <button type="button" class="quiet" aria-label="Next matched day">Next day →</button>
        </div>
      </div>
      <div class="quick-comparison-frame" hidden>
        <div class="quick-comparison-track" role="region" aria-label="Matched day charts" tabindex="0"></div>
      </div>
    </div>`;
  after.after(section);
  const toggle = section.querySelector('.quick-comparison-toggle');
  const panel = section.querySelector('.quick-comparison-results');
  const coverage = section.querySelector('.quick-comparison-coverage');
  const controls = section.querySelector('.quick-comparison-navigation');
  const position = section.querySelector('.quick-comparison-position');
  const frame = section.querySelector('.quick-comparison-frame');
  const track = section.querySelector('.quick-comparison-track');
  const [previous, next] = controls.querySelectorAll('button');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let forecast;
  let source;
  let loading;
  let expanded = false;
  let animation;
  let scheduled = false;
  let signature;
  let slides = [];
  let index = 0;

  function appendSlides() {
    const start = track.children.length;
    const fragment = document.createDocumentFragment();
    for (const { day, image } of slides.slice(start, start + BATCH)) fragment.append(makeSlide(day, image));
    track.append(fragment);
  }

  function updatePosition() {
    if (frame.hidden || panel.hidden || !track.firstElementChild) return;
    const step = track.children[1]?.offsetLeft - track.firstElementChild.offsetLeft;
    const atEnd = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
    if (atEnd && track.children.length < slides.length) appendSlides();
    const last = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
    index = last ? slides.length - 1 : Math.min(slides.length - 1, Math.round(track.scrollLeft / (step || 1)));
    frame.classList.toggle('has-prev', track.scrollLeft > 2);
    frame.classList.toggle('has-next', !last);
    previous.disabled = index === 0;
    next.disabled = index === slides.length - 1;
    const label = (index + 1) + ' / ' + slides.length;
    if (position.textContent !== label) position.textContent = label;
  }

  function navigate(delta) {
    const destination = Math.min(slides.length - 1, Math.max(0, index + delta));
    if (destination === index || destination < 0) return;
    if (destination >= track.children.length) appendSlides();
    const card = track.children[destination];
    if (card) track.scrollTo({
      left: card.offsetLeft - track.firstElementChild.offsetLeft,
      behavior: reduced.matches || document.body.classList.contains('motion-paused') ? 'instant' : 'smooth',
    });
  }

  function render() {
    if (!expanded) return;
    const days = getDays();
    const canMatch = Boolean(days?.length && forecast?.date);
    const matches = canMatch ? comparisonCandidates(days, forecast, getChoices(forecast.date)) : [];
    const images = source ? dayScreenshots(source()) : null;
    const result = images ? matches.flatMap(day => images.has(day.date) ? [{ day, image: images.get(day.date) }] : []) : [];
    const message = !canMatch ? 'Waiting for the forecast and historical data.' :
      !matches.length ? 'No historical matches for the active forecast and selected outcomes.' :
      !images ? 'Loading archived charts…' :
      result.length ? result.length.toLocaleString() + ' of ' + matches.length.toLocaleString() + ' matched days have screenshots.' :
      'No screenshots are available for these matched days.';
    if (coverage.textContent !== message) coverage.textContent = message;
    const key = result.map(({ day, image }) => day.date + '|' + image.url).join('\n');
    if (key === signature) { updatePosition(); return; }
    signature = key;
    slides = result;
    controls.hidden = result.length < 2;
    frame.hidden = !result.length;
    track.replaceChildren();
    appendSlides();
    track.scrollLeft = 0;
    updatePosition();
  }

  function refresh() {
    if (!expanded || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; render(); });
  }

  const frames = [
    { clipPath: 'polygon(8% 0%, 28% 0%, 30% 20%, 29% 70%, 27% 100%, 13% 100%, 10% 70%, 8% 20%)', transform: 'translateY(-6px) scaleY(.06)', opacity: .6 },
    { offset: .55, clipPath: 'polygon(0% 0%, 100% 0%, 94% 20%, 84% 70%, 78% 100%, 9% 100%, 4% 70%, 1% 20%)', transform: 'translateY(0) scaleY(.78)', opacity: 1 },
    { clipPath: 'polygon(0% 0%, 100% 0%, 100% 20%, 100% 70%, 100% 100%, 0% 100%, 0% 70%, 0% 20%)', transform: 'translateY(0) scaleY(1)', opacity: 1 },
  ];
  function togglePanel(open) {
    expanded = open;
    toggle.setAttribute('aria-expanded', String(open));
    panel.inert = !open;
    if (open) {
      panel.hidden = false;
      if (!loading) {
        loading = Promise.resolve().then(loadArchive).then(readArchive => {
          source = readArchive;
        }).catch(() => { source = () => []; }).finally(refresh);
      }
      render();
    }
    animation?.cancel();
    if (reduced.matches || document.body.classList.contains('motion-paused')) { panel.hidden = !open; return; }
    animation = panel.animate(frames, { duration: 300, easing: 'cubic-bezier(.25,.7,.25,1)', direction: open ? 'normal' : 'reverse' });
    animation.onfinish = () => { panel.hidden = !expanded; };
  }
  toggle.addEventListener('click', () => togglePanel(!expanded));
  section.addEventListener('keydown', event => {
    if (event.key === 'Escape' && expanded) {
      togglePanel(false);
      toggle.focus();
    }
  });
  track.addEventListener('scroll', updatePosition, { passive: true });
  track.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    navigate(event.key === 'ArrowRight' ? 1 : -1);
  });
  new ResizeObserver(updatePosition).observe(track);
  previous.addEventListener('click', () => navigate(-1));
  next.addEventListener('click', () => navigate(1));
  return {
    setForecast(value) {
      if (forecast?.date === value.date && forecast?.minute === value.minute && forecast?.dates === value.dates) return;
      forecast = value;
      refresh();
    },
    refresh,
  };
}
