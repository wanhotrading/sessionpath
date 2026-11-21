const panel = document.getElementById('sessions-section');
const root = document.documentElement;
const reduceTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
const component = 'sessionpath-glass';

function currentWallpaper() {
  const selected = Number(root.dataset.background);
  const variant = Number.isInteger(selected) && selected >= 1 && selected <= 11 ? selected : 1;
  return new URL(`./assets/backgrounds/snowy-sunset-v${variant}.webp`, import.meta.url).href;
}

async function mountGlass() {
  // Upstream 1.1.1 at 32cd7f8, including its WebGL refraction shader. Keep its regular
  // animation loop out of this dashboard by painting only on readiness and resize.
  const { LiquidGlassElement } = await import('./vendor/liquid-glass/liquid-glass.js');
  if (reduceTransparency.matches || !panel.isConnected) return;
  if (!customElements.get(component)) {
    customElements.define(component, class extends LiquidGlassElement {
      connectedCallback() {
        this.backdropObserver = new MutationObserver(() => this.start());
        this.backdropObserver.observe(this, { attributes: true, attributeFilter: ['data-ready'] });
        super.connectedCallback();
      }

      disconnectedCallback() {
        this.backdropObserver.disconnect();
        delete this.dataset.painted;
        super.disconnectedCallback();
      }

      start() {
        if (this.dataset.renderer === 'webgl') super.start();
      }

      resize() {
        super.resize();
        this.start();
      }

      frame(now) {
        // The light stays above the bevel. The pane never receives pointer events.
        Object.assign(this.light, { x: this.width * .18, y: -this.height * .25, vx: 0, vy: 0 });
        try {
          super.frame(now);
          if (this.hasAttribute('data-ready') && !this.animatedScene && !this.hasAttribute('data-painted')) {
            this.dataset.painted = '';
          }
        } finally {
          this.stop();
        }
      }
    });
  }

  const scene = document.createElement(component);
  scene.className = 'sp-liquid-surface';
  scene.setAttribute('aria-hidden', 'true');
  scene.setAttribute('reduce-motion', '');
  scene.setAttribute('dim', '.34');
  scene.backdrop = currentWallpaper();
  const pane = document.createElement('div');
  pane.className = 'sp-liquid-pane';
  pane.setAttribute('glass', '');
  scene.append(pane);
  panel.prepend(scene);

  new MutationObserver(() => {
    const wallpaper = currentWallpaper();
    if (scene.backdrop === wallpaper) return;
    delete scene.dataset.painted;
    scene.backdrop = wallpaper;
  }).observe(root, { attributes: true, attributeFilter: ['data-background'] });
}

if (panel && !reduceTransparency.matches && 'IntersectionObserver' in window && 'ResizeObserver' in window) {
  let visible = false;
  function mountWhenReady() {
    if (!visible || root.dataset.startup !== 'ready') return;
    intersection.disconnect();
    startup.disconnect();
    void mountGlass().catch(() => {
      // The original frosted surface stays visible if the enhancement cannot load.
    });
  }
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    mountWhenReady();
  });
  const startup = new MutationObserver(mountWhenReady);
  startup.observe(root, { attributes: true, attributeFilter: ['data-startup'] });
  intersection.observe(panel);
}
