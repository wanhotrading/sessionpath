const STORAGE_KEY = 'sessionpath-device-view-v1';
const PREFERENCES = new Set(['auto', 'desktop', 'mobile']);

export function normalizeDevicePreference(value) {
  return PREFERENCES.has(value) ? value : 'auto';
}

export function resolveDeviceView(preference, narrowScreen) {
  const choice = normalizeDevicePreference(preference);
  return choice === 'auto' ? (narrowScreen ? 'mobile' : 'desktop') : choice;
}

/** Call after setupWorkspace, once the shared header and workspace exist. */
export function setupDeviceView() {
  const existing = document.getElementById('device-view');
  if (existing) return;

  const header = document.querySelector('.topbar');
  if (!header) return;
  const host = header.querySelector('.top-actions') || header;
  const label = document.createElement('label');
  label.className = 'device-view-control';
  label.htmlFor = 'device-view';
  const caption = document.createElement('span');
  caption.textContent = 'View';
  const select = document.createElement('select');
  select.id = 'device-view';
  select.setAttribute('aria-label', 'Choose desktop or mobile view');
  for (const [value, text] of [['auto', 'Auto'], ['desktop', 'Desktop'], ['mobile', 'Mobile']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    select.append(option);
  }
  label.append(caption, select);
  host.prepend(label);

  const media = window.matchMedia('(max-width: 800px)');
  let preference = 'auto';
  try { preference = normalizeDevicePreference(localStorage.getItem(STORAGE_KEY)); } catch {}
  select.value = preference;

  const apply = () => {
    const view = resolveDeviceView(preference, media.matches);
    document.body.dataset.deviceView = view;
    document.body.dataset.devicePreference = preference;
    select.title = preference === 'auto' ? `Auto · ${view} view` : `${view === 'mobile' ? 'Mobile' : 'Desktop'} view`;
    document.querySelectorAll('.device-table-scroll').forEach(wrap => {
      if (view === 'mobile') {
        wrap.tabIndex = 0;
        wrap.setAttribute('role', 'region');
        wrap.setAttribute('aria-label', 'Scrollable data table');
      } else {
        wrap.removeAttribute('tabindex');
        wrap.removeAttribute('role');
        wrap.removeAttribute('aria-label');
      }
    });
    window.dispatchEvent(new CustomEvent('sessionpath:view-change', { detail: { view, preference } }));
  };
  select.addEventListener('change', () => {
    preference = normalizeDevicePreference(select.value);
    try { localStorage.setItem(STORAGE_KEY, preference); } catch {}
    apply();
  });
  if (media.addEventListener) media.addEventListener('change', apply);
  else media.addListener(apply);

  // New forecast/NY results arrive after initial load. Keep wide data tables
  // scrollable within their section without giving the whole page a scrollbar.
  const wrapTable = table => {
    if (table.closest('.table-wrap, .device-table-scroll')) return;
    const wrap = document.createElement('div');
    wrap.className = 'device-table-scroll';
    if (document.body.dataset.deviceView === 'mobile') {
      wrap.tabIndex = 0;
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', 'Scrollable data table');
    }
    table.before(wrap);
    wrap.append(table);
  };
  document.querySelectorAll('table').forEach(wrapTable);
  const observer = new MutationObserver(changes => {
    for (const change of changes) for (const node of change.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches('table')) wrapTable(node);
      else node.querySelectorAll('table').forEach(wrapTable);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  apply();
}
