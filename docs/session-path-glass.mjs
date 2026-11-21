const root = document.documentElement;
const reducedTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const targets = ['#sessions-section', '.quick-comparison-toggle'];
const component = 'sessionpath-glass';
const scenes = new Map();
let registration;

function currentWallpaper() {
  const choice = Number(root.dataset.background);
  const variant = Number.isInteger(choice) && choice >= 1 && choice <= 11 ? choice : 1;
  return new URL(`./assets/backgrounds/snowy-sunset-v${variant}.webp`, import.meta.url).href;
}

async function defineGlass() {
  const { LiquidGlassElement } = await import('./vendor/liquid-glass/liquid-glass.js?v=viewport-2');
  customElements.define(component, class extends LiquidGlassElement {
    get panes() {
      // Use the bounds of the live controls. Text and inputs stay in their original DOM.
      const children = this.parentElement?.querySelectorAll('.compact-path-card, #clear-sequence, .quick-comparison-toggle > span');
      return [this, ...(children ?? [])].slice(0, this.renderer?.maxPanes ?? 16);
    }

    connectedCallback() {
      this.lastPaint = 0;
      this.readyObserver = new MutationObserver(() => this.start());
      this.readyObserver.observe(this, {attributes: true, attributeFilter: ['data-ready']});
      super.connectedCallback();
      this.observeLayout();
    }

    observeLayout() {
      const host = this.parentElement;
      const signal = this.events.signal;
      const layoutChanged = () => {
        this.sceneDirty = true;
        this.stylesDirty = true;
        this.start();
      };
      this.elementsObserver = new MutationObserver(records => {
        if (records.some(record => record.target !== this)) layoutChanged();
      });
      this.elementsObserver.observe(host, {subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'hidden', 'class']});
      // Changes to sibling forecast panels can move the glass without resizing it.
      this.boardObserver = new ResizeObserver(layoutChanged);
      for (const el of [host.closest('.session-board-grid'),host.closest('.session-board-right'),host.previousElementSibling]) {
        if (el) this.boardObserver.observe(el);
      }
      window.addEventListener('scroll', layoutChanged, {capture:true, passive:true, signal});
      window.addEventListener('resize', layoutChanged, {passive:true, signal});
      const lightAtPointer = event => {
        if (reducedMotion.matches) return;
        this.movePointer(event);
        this.start();
      };
      const releaseLight = () => {
        this.pointer.inside = false;
        this.start();
      };
      host.addEventListener('pointermove', lightAtPointer, {passive:true, signal});
      host.addEventListener('pointerdown', lightAtPointer, {passive:true, signal});
      host.addEventListener('pointerleave', releaseLight, {passive:true, signal});
      host.addEventListener('pointerup', event => {
        if (event.pointerType !== 'mouse') releaseLight();
      }, {passive:true, signal});
      host.addEventListener('pointercancel', releaseLight, {signal});
      reducedMotion.addEventListener('change', releaseLight, {signal});
    }

    disconnectedCallback() {
      this.readyObserver.disconnect();
      this.elementsObserver.disconnect();
      this.boardObserver.disconnect();
      delete this.dataset.painted;
      super.disconnectedCallback();
    }

    resize() {
      super.resize();
      this.start();
    }

    applyBackdrop() {
      delete this.dataset.painted;
      delete this.dataset.ready;
      super.applyBackdrop();
    }

    start() {
      if (this.dataset.renderer === 'webgl' && !reducedTransparency.matches) super.start();
    }

    frame(now) {
      // Coalesce pointer and scroll events. A still dashboard never runs a render loop.
      if (now - this.lastPaint < 33) {
        this.frameId = requestAnimationFrame(time => this.frame(time));
        return;
      }
      this.lastPaint = now;
      const active = this.pointer.inside && !reducedMotion.matches;
      Object.assign(this.light, {
        x: active ? this.pointer.x - 100 : this.width * .18,
        y: active ? this.pointer.y - 160 : -this.height * .25, vx: 0, vy: 0
      });
      Object.assign(this.bulge, {x: active ? this.pointer.x : -10000, y: active ? this.pointer.y : -10000, vx: 0, vy: 0});
      this.lastSignature = ''; // Light position alone also changes the refracted image.
      try {
        super.frame(now);
        if (this.hasAttribute('data-ready') && !this.animatedScene && this.dataset.renderer === 'webgl') this.dataset.painted = '';
      } finally {
        this.stop();
      }
    }
  });
}

async function mount(host) {
  try {
    await (registration ??= defineGlass());
    if (!host.isConnected || reducedTransparency.matches || scenes.has(host)) return;
    const scene = document.createElement(component);
    scene.className = 'sp-liquid-surface';
    scene.setAttribute('aria-hidden', 'true');
    scene.setAttribute('viewport-backdrop', '');
    scene.setAttribute('dim', '.08');
    scene.backdrop = currentWallpaper();
    host.prepend(scene);
    scenes.set(host, scene);
  } catch {
    // The CSS glass is already visible and operable.
  }
}

if ('IntersectionObserver' in window && 'ResizeObserver' in window) {
  const visible = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      visible.unobserve(entry.target);
      void mount(entry.target);
    }
  });
  function discover() {
    if (reducedTransparency.matches || root.dataset.startup !== 'ready') return;
    const hosts = targets.map(selector => document.querySelector(selector));
    for (const host of hosts) if (host && !scenes.has(host)) visible.observe(host);
    if (hosts.every(Boolean)) additions.disconnect();
  }
  const additions = new MutationObserver(discover);
  additions.observe(document.body, {childList:true, subtree:true});
  const settings = new MutationObserver(() => {
    for (const scene of scenes.values()) if (scene.backdrop !== currentWallpaper()) {
      delete scene.dataset.painted;
      scene.backdrop = currentWallpaper();
    }
    discover();
  });
  settings.observe(root, {attributes:true, attributeFilter:['data-background', 'data-startup']});
  reducedTransparency.addEventListener('change', () => {
    if (reducedTransparency.matches) {
      visible.disconnect();
      for (const scene of scenes.values()) scene.remove();
      scenes.clear();
    } else discover();
  });
  discover();
}
