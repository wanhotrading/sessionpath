function mountScreenshotView(board) {
  const controls = board.querySelector('.session-board-actions');
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'quiet screenshot-view-toggle';
  toggle.textContent = 'Screenshot view';
  toggle.setAttribute('aria-pressed', 'false');
  controls.append(toggle);

  const exit = document.createElement('button');
  exit.type = 'button';
  exit.className = 'quiet screenshot-view-exit';
  exit.textContent = 'Exit screenshot view';
  exit.hidden = true;
  document.body.append(exit);

  let active = false;
  let frame = 0;
  let scrollTop = 0;
  function fit() {
    frame = 0;
    if (!active) return;
    const viewport = window.visualViewport;
    const width = Math.floor(viewport?.width ?? innerWidth);
    const height = Math.floor(viewport?.height ?? innerHeight);
    const boardWidth = Math.max(1080, Math.min(1490, width - 20));
    board.style.setProperty('--screenshot-board-width', boardWidth + 'px');
    const scale = Math.min(1, (width - 20) / boardWidth, (height - 66) / Math.max(board.offsetHeight, 1));
    board.style.setProperty('--screenshot-board-scale', String(Math.max(0.05, scale)));
  }
  function scheduleFit() {
    if (active && !frame) frame = requestAnimationFrame(fit);
  }
  const observer = new ResizeObserver(scheduleFit);
  const grid = board.querySelector('.session-board-grid');
  function setActive(enabled) {
    active = enabled;
    if (active) scrollTop = window.scrollY;
    document.body.classList.toggle('session-board-capture', active);
    toggle.setAttribute('aria-pressed', String(active));
    exit.hidden = !active;
    if (active) {
      observer.observe(grid);
      fit();
      window.scrollTo(0, 0);
      exit.focus({ preventScroll: true });
    } else {
      observer.disconnect();
      board.style.removeProperty('--screenshot-board-width');
      board.style.removeProperty('--screenshot-board-scale');
      window.scrollTo(0, scrollTop);
      toggle.focus({ preventScroll: true });
    }
  }
  toggle.addEventListener('click', () => setActive(true));
  exit.addEventListener('click', () => setActive(false));
  window.addEventListener('keydown', event => {
    if (!active || event.key !== 'Escape') return;
    event.preventDefault();
    setActive(false);
  });
  window.addEventListener('resize', scheduleFit, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleFit, { passive: true });
}

const main = document.querySelector('main');
const available = document.getElementById('session-board');
if (available) mountScreenshotView(available);
else if (main) {
  const observer = new MutationObserver(() => {
    const board = document.getElementById('session-board');
    if (!board) return;
    observer.disconnect();
    mountScreenshotView(board);
  });
  observer.observe(main, { childList: true });
}
