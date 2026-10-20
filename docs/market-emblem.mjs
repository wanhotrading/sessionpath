const EMBLEMS = Object.freeze({
  CL: 'assets/emblems/cl-acrylic-v1.webp',
  NQ: 'assets/emblems/nq-acrylic-v1.webp',
});

/** Decorative only: the chosen market loads one image, with no form state. */
export function mountMarketEmblem(market) {
  const panel = document.getElementById('conditions');
  const source = EMBLEMS[market];
  if (!panel || !source || panel.querySelector('.market-emblem')) return;

  const layer = document.createElement('div');
  layer.className = 'market-emblem';
  layer.dataset.market = market;
  layer.setAttribute('aria-hidden', 'true');
  layer.style.setProperty('--market-emblem-image', `url("${source}")`);

  const art = document.createElement('div');
  art.className = 'market-emblem-art';
  const image = document.createElement('img');
  image.className = 'market-emblem-image';
  image.src = source;
  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  image.draggable = false;
  image.decoding = 'async';
  image.width = 512;
  image.height = 512;
  const highlight = document.createElement('span');
  highlight.className = 'market-emblem-light';
  highlight.setAttribute('aria-hidden', 'true');
  art.append(image, highlight);
  layer.append(art);
  panel.prepend(layer);
  image.addEventListener('error', () => { layer.hidden = true; }, { once: true });
}
