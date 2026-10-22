import {instrument} from './instrument.mjs';

const DATA_URL = new URL('./data/cot/cot-positioning.json', import.meta.url);
const MARKET_NAMES = {CL: 'Crude oil', NQ: 'Nasdaq-100', ES: 'S&P 500'};
const integerFormat = new Intl.NumberFormat('en-US', {maximumFractionDigits: 0});
const numberFormat = new Intl.NumberFormat('en-US', {maximumFractionDigits: 2});

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function integer(value) { return finite(value) ? integerFormat.format(value) : 'Unavailable'; }
function signed(value, suffix = '') {
  return finite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${numberFormat.format(Math.abs(value))}${suffix}` : 'Unavailable';
}
function percent(value) { return finite(value) ? `${numberFormat.format(value)}%` : 'Unavailable'; }
function tone(value, inverse = false) {
  if (!finite(value) || value === 0) return 'cot-neutral';
  return (value > 0) !== inverse ? 'cot-positive' : 'cot-negative';
}
function dateLabel(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return 'Unavailable';
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(date.valueOf())) return 'Unavailable';
  return new Intl.DateTimeFormat('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'}).format(date);
}
function secureURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function addTextList(parent, values, className) {
  const list = node('ul', className);
  for (const value of Array.isArray(values) ? values : []) if (typeof value === 'string' && value.trim()) list.append(node('li', '', value));
  if (list.childElementCount) parent.append(list);
}
function metric(label, value, detail, className = '') {
  const item = node('div', `cot-metric ${className}`);
  item.append(node('span', 'cot-metric-label', label), node('strong', 'cot-metric-value', value));
  if (detail) item.append(node('span', 'cot-metric-detail', detail));
  return item;
}
function contextValue(context, key) { return context?.[key] || context?.[String(key)] || null; }

function participantCard(participant, unit = 'contracts') {
  const card = node('article', 'cot-participant');
  const title = node('div', 'cot-participant-heading');
  title.append(node('h3', '', participant.label || participant.id || 'Participant'));
  const netState = !finite(participant.net) ? 'Position unavailable' : participant.net > 0 ? 'Net long' : participant.net < 0 ? 'Net short' : 'Balanced';
  title.append(node('span', `cot-position-badge ${tone(participant.net)}`, netState));
  card.append(title);
  if (participant.role) card.append(node('p', 'cot-participant-role', participant.role));

  const positions = node('div', 'cot-position-grid');
  positions.append(metric('Long', integer(participant.long), unit), metric('Short', integer(participant.short), unit), metric('Net', signed(participant.net), 'long − short', tone(participant.net)));
  card.append(positions);

  const flow = node('div', 'cot-weekly-change');
  flow.append(node('h4', '', 'Change from previous report'));
  const changes = node('div', 'cot-position-grid');
  changes.append(metric('Reported longs', signed(participant.weekly?.long), '', tone(participant.weekly?.long)), metric('Reported shorts', signed(participant.weekly?.short), '', tone(participant.weekly?.short, true)), metric('Net', signed(participant.weekly?.net), '', tone(participant.weekly?.net)));
  flow.append(changes);
  card.append(flow);
  if (participant.mechanism) card.append(node('p', 'cot-mechanism', participant.mechanism));

  const ratios = node('div', 'cot-ratio-grid');
  ratios.append(metric('Net / open interest', signed(participant.netPctOI, '%'), 'current report'), metric('Weekly net flow / prior OI', signed(participant.weekly?.flowPctPrevOI, '%'), 'change in net position', tone(participant.weekly?.flowPctPrevOI)));
  card.append(ratios);

  const detail = node('details', 'cot-participant-details');
  detail.append(node('summary', '', 'Crowding, longer flows & spreading'));
  const extra = node('div', 'cot-detail-grid');
  const shortContext = contextValue(participant.context, 52);
  const longContext = contextValue(participant.context, 156);
  extra.append(metric('Net-position rank · 52 weeks', percent(shortContext?.netPercentile), `${integer(shortContext?.n)} earlier reports`), metric('Net-position rank · 156 weeks', percent(longContext?.netPercentile), `${integer(longContext?.n)} earlier reports`), metric('Weekly flow rank · 52 weeks', percent(shortContext?.flowPercentile), 'signed net flow; high means more bullish'), metric('Weekly shift size · 156 weeks', percent(longContext?.absFlowPercentile), 'absolute flow size, either direction'), metric('2-week net flow / starting OI', signed(participant.flow2wPct, '%'), 'cumulative net-position change'), metric('4-week net flow / starting OI', signed(participant.flow4wPct, '%'), 'cumulative net-position change'));
  if (finite(participant.spreading)) extra.append(metric('Spreading', integer(participant.spreading), `Weekly change ${signed(participant.weekly?.spreading)}`));
  if (finite(participant.grossLong)) extra.append(metric('Long including spreading', integer(participant.grossLong), `Weekly change ${signed(participant.weekly?.grossLong)}`));
  if (finite(participant.grossShort)) extra.append(metric('Short including spreading', integer(participant.grossShort), `Weekly change ${signed(participant.weekly?.grossShort)}`));
  detail.append(extra, node('p', 'cot-small-note', 'A percentile describes positioning relative to earlier reports. It is not a probability of the market rising or falling.'));
  card.append(detail);
  return card;
}

function historyChart(market) {
  const history = Array.isArray(market.history) ? market.history : [];
  const participants = market.participants || [];
  if (history.length < 2 || !participants.length) return null;
  const section = node('section', 'cot-history');
  const heading = node('div', 'cot-history-heading');
  const text = node('div');
  text.append(node('h3', '', 'Positioning over time'), node('p', 'cot-small-note', 'Net position as a share of each report’s open interest.'));
  const label = node('label', 'cot-history-select', 'Participant');
  const select = node('select');
  select.setAttribute('aria-label', 'Participant for positioning history');
  for (const participant of participants) {
    const option = node('option', '', participant.label || participant.id);
    option.value = participant.id;
    select.append(option);
  }
  const preferred = participants.find(p => /managed.?money|leveraged/i.test(p.id + ' ' + p.label));
  if (preferred) select.value = preferred.id;
  label.append(select);
  heading.append(text, label);
  const plot = node('div', 'cot-history-plot');
  section.append(heading, plot);

  const draw = () => {
    plot.replaceChildren();
    const points = history.map(report => ({date: report.date, value: report.participants?.[select.value]?.netPctOI})).filter(point => finite(point.value));
    if (points.length < 2) { plot.append(node('p', 'cot-small-note', 'Not enough reports to display this participant.')); return; }
    const minimum = Math.min(0, ...points.map(p => p.value));
    const maximum = Math.max(0, ...points.map(p => p.value));
    const padding = Math.max(1, (maximum - minimum) * .15);
    const low = minimum - padding, high = maximum + padding;
    const compact = window.innerWidth <= 700 || document.body.dataset.deviceView === 'mobile';
    const width = compact ? 480 : 900, height = compact ? 230 : 218, left = compact ? 85 : 65, right = 20, top = 20, bottom = 40;
    const x = index => left + (width - left - right) * index / (points.length - 1);
    const y = value => top + (high - value) / (high - low) * (height - top - bottom);
    const svgElement = (tag, attributes = {}, textValue) => {
      const item = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [name, value] of Object.entries(attributes)) item.setAttribute(name, String(value));
      if (textValue !== undefined) item.textContent = textValue;
      return item;
    };
    const svg = svgElement('svg', {viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${select.selectedOptions[0]?.textContent} net positioning, ${dateLabel(points[0].date)} to ${dateLabel(points.at(-1).date)}. Latest ${percent(points.at(-1).value)} of open interest.`});
    const guides = [minimum, 0, maximum].filter((value, index, all) => all.indexOf(value) === index);
    for (const value of guides) {
      svg.append(svgElement('line', {x1: left, x2: width - right, y1: y(value), y2: y(value), class: value === 0 ? 'cot-chart-zero' : 'cot-chart-grid'}));
      svg.append(svgElement('text', {x: left - 10, y: y(value) + 4, 'text-anchor': 'end', class: 'cot-chart-label'}, `${numberFormat.format(value)}%`));
    }
    svg.append(svgElement('path', {d: points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(2)},${y(point.value).toFixed(2)}`).join(' '), class: 'cot-chart-line'}));
    svg.append(svgElement('circle', {cx: x(points.length - 1), cy: y(points.at(-1).value), r: 4, class: 'cot-chart-dot'}));
    svg.append(svgElement('text', {x: left, y: height - 10, class: 'cot-chart-label'}, dateLabel(points[0].date)));
    svg.append(svgElement('text', {x: width - right, y: height - 10, 'text-anchor': 'end', class: 'cot-chart-label'}, dateLabel(points.at(-1).date)));
    plot.append(svg, node('p', 'cot-history-latest', `Latest: ${signed(points.at(-1).value, '%')} of OI · ${points.length} reports`));
  };
  select.addEventListener('change', draw);
  draw();
  return section;
}

function relativeComparison(relative) {
  if (!relative?.available || !Array.isArray(relative.participants)) return null;
  const details = node('details', 'cot-methodology cot-relative');
  details.append(node('summary', '', `Compare NQ & ES · ${dateLabel(relative.snapshotDate)}`));
  details.append(node('p', 'cot-small-note', 'Net positions use each market’s own open interest. Weekly flows use each market’s previous open interest.'));
  const scroll = node('div', 'cot-table-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', 'NQ and ES normalized positioning comparison');
  const table = node('table', 'cot-comparison-table');
  const caption = node('caption', '', 'NQ and ES positions and weekly changes · % of open interest');
  const head = node('thead');
  const row = node('tr');
  for (const label of ['Participant', 'NQ net / OI', 'ES net / OI', 'NQ weekly flow', 'ES weekly flow']) {
    const cell = node('th', '', label); cell.scope = 'col'; row.append(cell);
  }
  head.append(row);
  const body = node('tbody');
  for (const participant of relative.participants) {
    const row = node('tr');
    const name = node('th', '', participant.label || participant.id); name.scope = 'row'; row.append(name);
    for (const value of [participant.nqNetPctOI, participant.esNetPctOI, participant.nqFlowPctPrevOI, participant.esFlowPctPrevOI]) row.append(node('td', tone(value), signed(value, '%')));
    body.append(row);
  }
  table.append(caption, head, body);
  scroll.append(table);
  details.append(scroll);
  if (relative.note) details.append(node('p', 'cot-small-note', relative.note));
  return details;
}

export function setupCotPanel() {
  if (document.getElementById('cot-positioning-dialog')) return;
  const allowedMarkets = instrument.id === 'NQ' ? ['NQ', 'ES'] : ['CL'];
  let selectedMarket = allowedMarkets[0];
  let packet = null;
  let request = null;
  let trigger = null;

  const dialog = node('dialog', 'cot-panel');
  dialog.id = 'cot-positioning-dialog';
  dialog.setAttribute('aria-labelledby', 'cot-panel-title');
  dialog.setAttribute('aria-describedby', 'cot-panel-description');
  const header = node('header', 'cot-panel-header');
  const heading = node('div');
  heading.append(node('div', 'eyebrow', 'SESSIONPATH / COT'));
  const title = node('h2', '', 'Positioning bias');
  title.id = 'cot-panel-title';
  const description = node('p', 'cot-panel-description', 'Weekly futures positioning · a qualitative backdrop for your session.');
  description.id = 'cot-panel-description';
  heading.append(title, description);
  const back = node('button', 'cot-close', '×');
  back.type = 'button';
  back.setAttribute('aria-label', 'Close positioning bias');
  header.append(heading, back);
  const controls = node('div', 'cot-panel-controls');
  const markets = node('div', 'cot-market-tabs');
  markets.setAttribute('role', 'group');
  markets.setAttribute('aria-label', 'COT market');
  const marketButtons = new Map();
  for (const symbol of allowedMarkets) {
    const button = node('button', 'cot-market-tab', `${symbol} · ${MARKET_NAMES[symbol]}`);
    button.type = 'button';
    button.dataset.cotMarket = symbol;
    button.setAttribute('aria-pressed', String(symbol === selectedMarket));
    button.addEventListener('click', () => {
      selectedMarket = symbol;
      marketButtons.forEach((item, key) => item.setAttribute('aria-pressed', String(key === symbol)));
      render();
    });
    marketButtons.set(symbol, button);
    markets.append(button);
  }
  const reload = node('button', 'quiet cot-reload', 'Reload snapshot');
  reload.type = 'button';
  reload.addEventListener('click', () => load(true));
  controls.append(markets, reload);
  const status = node('p', 'cot-panel-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const body = node('div', 'cot-panel-body');
  dialog.append(header, controls, status, body);
  document.body.append(dialog);

  function render() {
    body.replaceChildren();
    const market = packet?.markets?.[selectedMarket];
    if (!market) {
      if (request) status.textContent = 'Loading CFTC positioning…';
      else status.textContent = 'This market’s positioning snapshot is unavailable. Please reload to try again.';
      return;
    }
    status.textContent = `${selectedMarket} · Positions as of ${dateLabel(market.snapshotDate)}${market.previousDate ? ` · Weekly changes from ${dateLabel(market.previousDate)}` : ''}`;
    const provenance = node('div', 'cot-snapshot-note');
    provenance.append(node('span', 'cot-snapshot-badge', 'Dated research snapshot'), node('span', '', 'Bundled CFTC data; this is not a live price feed.'));
    if (market.unit) provenance.append(node('span', 'cot-units-note', `Units: ${market.unit}.`));
    body.append(provenance);
    const bias = market.bias || {};
    const biasCard = node('section', `cot-bias cot-bias-${['bullish', 'bearish', 'mixed', 'neutral'].includes(bias.direction) ? bias.direction : 'neutral'}`);
    biasCard.append(node('span', 'cot-section-label', 'Underlying positioning bias'), node('h3', '', bias.label || 'No single directional conclusion'), node('p', 'cot-bias-summary', bias.summary || 'Review the participant positions and weekly changes below.'));
    addTextList(biasCard, bias.evidence, 'cot-bias-evidence');
    biasCard.append(node('p', 'cot-small-note', 'Positioning context, not a measured next-session probability or trade signal.'));
    body.append(biasCard);
    const oi = market.openInterest || {};
    const openInterest = node('section', 'cot-open-interest');
    const oiContext = contextValue(oi.context, 156);
    openInterest.append(metric('Open interest', integer(oi.value), market.unit || 'outstanding futures contracts'), metric('Weekly OI change', signed(oi.change), finite(oi.changePct) ? `${signed(oi.changePct, '%')} from previous report` : 'previous report unavailable'), metric('OI rank · 156 weeks', percent(oiContext?.percentile), `${integer(oiContext?.n)} earlier reports`));
    body.append(openInterest);
    const participantHeading = node('div', 'cot-section-heading');
    participantHeading.append(node('h3', '', 'Who holds the market'), node('p', 'cot-small-note', 'Green indicates a more bullish net flow; red indicates a more bearish net flow. Hedging positions need their own context.'));
    body.append(participantHeading);
    body.append(node('p', 'cot-reported-note', 'Long/short figures exclude separately reported spreads; explanations include them. Expand a participant for the full breakdown.'));
    const participantGrid = node('div', 'cot-participant-grid');
    for (const participant of Array.isArray(market.participants) ? market.participants : []) participantGrid.append(participantCard(participant, /equivalent/i.test(market.unit || '') ? 'equivalent contracts' : 'contracts'));
    if (!participantGrid.childElementCount) participantGrid.append(node('p', 'cot-small-note', 'Participant positions are unavailable for this snapshot.'));
    body.append(participantGrid);
    const chart = historyChart(market);
    if (chart) body.append(chart);
    if (allowedMarkets.length > 1) {
      const comparison = relativeComparison(packet.relative);
      if (comparison) body.append(comparison);
    }

    const definitions = node('details', 'cot-methodology');
    definitions.append(node('summary', '', 'How to read the numbers'));
    const dictionary = node('dl', 'cot-definition-list');
    for (const [term, definition] of [
      ['Net position', 'Long contracts minus short contracts. Positive is net long; negative is net short.'],
      ['Weekly net flow', 'The change in net position from the previous report. Long buying and short covering can both raise it.'],
      ['Net / open interest', 'Net position divided by the same report’s open interest, × 100. This makes different weeks and markets easier to compare.'],
      ['Weekly flow / prior OI', 'The change in net position divided by the previous report’s open interest, × 100.'],
      ['Position rank', 'Compared with the preceding 52 or 156 reports: earlier values below today’s value count fully, ties count half, and the current report is excluded. A high rank means relatively long positioning, not a high chance of a rally.'],
      ['Longer flows', 'The 2-week or 4-week change in net position divided by open interest at that period’s start, × 100. Percentages from different weeks are not added together.'],
      ['Spreading', 'Offsetting long and short positions classified as spreads. Where reported, they are separate from the reported long and short columns. Those columns can still contain hedged strategies.'],
      ['Open interest', 'Outstanding contracts. Every contract has a long and a short side; the two sides are not added together to count contracts.']
    ]) dictionary.append(node('dt', '', term), node('dd', '', definition));
    definitions.append(dictionary);
    addTextList(definitions, bias.limitations, 'cot-caveats');
    body.append(definitions);

    const sourceDetails = node('details', 'cot-methodology');
    sourceDetails.append(node('summary', '', 'Report, source & data checks'));
    const sourceFacts = node('dl', 'cot-definition-list');
    const publication = market.publication || {};
    for (const [label, value] of [
      ['Market', `${market.name || MARKET_NAMES[selectedMarket]} · CFTC ${market.marketCode || 'code unavailable'}`],
      ['Report', `${market.reportFamily || 'COT'} · ${market.scope || 'futures only'}`],
      ['Positions dated', dateLabel(market.snapshotDate)],
      ['Publication date', publication.verified && publication.date ? dateLabel(publication.date) : 'Not independently verified in this snapshot'],
      ['Database coverage', `${dateLabel(market.coverage?.start)} – ${dateLabel(market.coverage?.end)} · ${integer(market.coverage?.observations)} reports`],
      ['Snapshot built', dateLabel(packet.generatedAt)]
    ]) sourceFacts.append(node('dt', '', label), node('dd', '', value));
    sourceDetails.append(sourceFacts);
    if (publication.note) sourceDetails.append(node('p', 'cot-small-note', publication.note));
    addTextList(sourceDetails, market.quality?.notes, 'cot-caveats');
    const reconciliation = market.quality?.reconciliation;
    if (reconciliation) sourceDetails.append(node('p', 'cot-small-note', `Reconciliation differences · long ${signed(reconciliation.longDifference)} · short ${signed(reconciliation.shortDifference)} · net sum ${signed(reconciliation.netSum)} contracts.`));
    const sourceLinks = node('div', 'cot-source-links');
    for (const source of Array.isArray(packet.sources) ? packet.sources : []) {
      const href = secureURL(source.url);
      if (!href) continue;
      const link = node('a', '', source.label || 'CFTC source');
      link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      sourceLinks.append(link);
    }
    sourceDetails.append(sourceLinks);
    body.append(sourceDetails);
    if (allowedMarkets.length > 1) body.append(node('p', 'cot-cross-market-note', 'NQ and ES are shown separately. Their contract totals are not added together; compare their open-interest-normalized positioning.'));
  }

  async function load(force = false) {
    if (request) return;
    if (packet && !force) { render(); return; }
    const controller = new AbortController();
    request = controller;
    reload.disabled = true;
    status.textContent = 'Loading CFTC positioning…';
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(DATA_URL, {signal: controller.signal, credentials: 'omit', cache: force ? 'reload' : 'default'});
      if (!response.ok) throw new Error('Snapshot unavailable');
      const data = await response.json();
      if (data?.schemaVersion !== 1 || !data.markets || !allowedMarkets.some(symbol => data.markets[symbol])) throw new Error('Snapshot format unavailable');
      packet = data;
      render();
    } catch {
      if (packet) { render(); status.textContent += ' · Reload failed; showing the saved snapshot.'; }
      else { body.replaceChildren(); status.textContent = 'The positioning snapshot could not be loaded. Use Reload snapshot to try again.'; }
    } finally {
      clearTimeout(timer);
      request = null;
      reload.disabled = false;
    }
  }

  function open() {
    for (const other of document.querySelectorAll('dialog[open]')) if (other !== dialog) other.close();
    if (!dialog.open) dialog.showModal();
    trigger?.setAttribute('aria-expanded', 'true');
    back.focus();
    load();
  }
  function closeToTools() {
    dialog.close();
    const tools = document.getElementById('workspace-tools-dialog');
    for (const other of document.querySelectorAll('dialog[open]')) if (other !== tools) other.close();
    if (tools && !tools.open) tools.showModal();
    trigger?.focus();
  }
  back.addEventListener('click', closeToTools);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeToTools(); });
  dialog.addEventListener('close', () => { trigger?.setAttribute('aria-expanded', 'false'); });

  function mountToolsCard() {
    const grid = document.querySelector('#workspace-tools-dialog .workflow-tool-grid');
    if (!grid || document.getElementById('cot-tools-open')) return false;
    const card = node('article', 'workflow-tool-card cot-tool-card');
    card.append(node('h3', '', 'COT positioning bias'), node('p', '', instrument.id === 'NQ' ? 'Compare NQ and ES participant positions, weekly flows and crowding.' : 'Review CL participant positions, weekly flows and crowding.'));
    trigger = node('button', 'quiet', 'Open COT bias');
    trigger.id = 'cot-tools-open';
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', dialog.id);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.addEventListener('click', open);
    card.append(trigger);
    grid.append(card);
    return true;
  }
  if (!mountToolsCard()) {
    const observer = new MutationObserver(() => { if (mountToolsCard()) { observer.disconnect(); clearTimeout(expiry); } });
    observer.observe(document.body, {childList: true, subtree: true});
    const expiry = setTimeout(() => observer.disconnect(), 15000);
    window.addEventListener('pagehide', () => { observer.disconnect(); clearTimeout(expiry); }, {once: true});
  }
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('#workspace-tools-toggle')) mountToolsCard();
  });
  window.addEventListener('pagehide', () => request?.abort(), {once: true});
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupCotPanel, {once: true});
  else setupCotPanel();
}
