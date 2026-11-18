function make(doc, tag, className, text = '') {
  const element = doc.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

export function mountNewsTicker(doc = document) {
  const view = doc.defaultView;
  const bar = make(doc, 'section', 'sp-news-ticker');
  bar.setAttribute('aria-label', 'Latest market headline');
  bar.dataset.feedState = 'checking';

  const trigger = make(doc, 'button', 'sp-news-open', 'News');
  trigger.type = 'button';
  trigger.id = 'news-desk-toggle';

  const viewport = make(doc, 'div', 'sp-news-viewport');
  const headline = make(doc, 'span', 'sp-news-headline', 'Checking headlines…');
  headline.dir = 'auto';
  viewport.append(headline);

  const pause = make(doc, 'button', 'sp-news-pause', 'Ⅱ');
  pause.type = 'button';
  pause.setAttribute('aria-label', 'Pause news ticker');
  pause.setAttribute('aria-pressed', 'false');
  pause.title = 'Pause news ticker';
  pause.hidden = true;

  const reducedMotion = view.matchMedia('(prefers-reduced-motion: reduce)');
  let label = headline.textContent;
  let moving = false;
  let paused = false;
  // Read dimensions only on headline or viewport changes. Animation runs on a
  // single transform so it does not reflow the dashboard while it scrolls.
  function measure() {
    if (!moving) return;
    const travel = viewport.clientWidth;
    if (!travel) return;
    const width = headline.scrollWidth;
    const seconds = Math.max(8, (travel + width + 24) / 76);
    headline.style.setProperty('--sp-news-travel', travel + 'px');
    headline.style.setProperty('--sp-news-duration', seconds.toFixed(2) + 's');
  }
  function renderPause() {
    pause.hidden = !moving || reducedMotion.matches;
    bar.dataset.paused = String(paused);
    pause.textContent = paused ? '▷' : 'Ⅱ';
    const name = paused ? 'Resume news ticker' : 'Pause news ticker';
    pause.setAttribute('aria-label', name);
    pause.setAttribute('aria-pressed', String(paused));
    pause.title = name;
  }
  pause.addEventListener('click', () => {
    paused = !paused;
    renderPause();
    if (!paused) measure();
  });
  reducedMotion.addEventListener('change', renderPause);

  bar.append(trigger, viewport, pause);
  doc.body.prepend(bar);
  new view.ResizeObserver(measure).observe(viewport);

  function update(text, state) {
    if (bar.dataset.feedState !== state) {
      bar.dataset.feedState = state;
      doc.dispatchEvent(new view.CustomEvent('sessionpath:news-connection', {detail: state}));
    }
    const next = text || ({
      checking: 'Checking headlines…',
      connected: 'No matching headlines',
      unavailable: 'News feed unavailable',
    })[state];
    const animate = Boolean(text);
    if (next === label && animate === moving) return;
    moving = animate;
    label = next;
    headline.dataset.moving = 'false';
    headline.textContent = next;
    viewport.title = next;
    renderPause();
    if (!moving) return;
    headline.dataset.moving = 'true';
    // Setting a new animation name forces the new headline to start at the
    // right edge even when two updates happen in the same rendering frame.
    headline.dataset.parity = headline.dataset.parity === 'a' ? 'b' : 'a';
    measure();
  }
  return {trigger, update};
}
