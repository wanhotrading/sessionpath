import test from 'node:test';
import assert from 'node:assert/strict';
import {DAY_REVIEW_KNOWLEDGE, DAY_REVIEW_READING_GUIDE} from '../../../docs/chart-day-review-knowledge.mjs';
import {CHART_REFERENCE_VERSION, CHART_READING_SYSTEM, CHART_COMPARISON_PROMPT, ACTIVE_DAY_REVIEW_GUIDE} from '../../../docs/chart-reading-reference.mjs';
import {classifyChartShapeEvidence, validateChartRequest} from '../chart-vision.mjs';
import {createAssistantHandler, FREE_MODEL} from '../router.mjs';
import {RASTER_FIXTURES} from './chart-fixtures.mjs';

const NOW = Date.parse('2026-11-07T15:00:00Z');
const analysis = {
  summary: 'The visible session contains an early decline followed by a recovery.',
  sequence: ['The first visible move is downward.', 'Price later recovers part of that move.'],
  bbox: 'The exact prior New York boundaries are unreadable.',
  sessionpath: 'The full forecast boundaries are unreadable.',
  uncertainties: ['The exact session prices cannot be established from this example.'],
};
const chartInput = {
  message: 'Describe the historical chart through the declared cutoff.',
  context: {market: 'CL', window: '03:00-05:00', date: null},
  referenceVersion: 'sessionpath-chart-v3',
  observation: {mode: 'historical', date: '2022-01-20', cutoff: '2022-01-20T16:00'},
  image: {dataUrl: RASTER_FIXTURES.jpeg},
};

test('public knowledge retains source provenance and current columns without needing the full sheet export', () => {
  const source = DAY_REVIEW_KNOWLEDGE.source;
  assert.equal(DAY_REVIEW_KNOWLEDGE.schema, 'sessionpath.day-review.knowledge.v1');
  assert.equal(source.spreadsheetId, '1_FOxbdxo7x0OOTzjuA3hWiYrMTE6pI5Uy1WastnMlp0');
  assert.equal(source.sheetId, 1087870928);
  assert.equal(source.sheetName, 'Day review');
  assert.match(source.url, /gid=1087870928/u);
  assert.match(source.readDate, /^\d{4}-\d{2}-\d{2}$/u);
  const entries = DAY_REVIEW_KNOWLEDGE.tagDictionary.entries;
  assert.equal(entries.length, 34);
  assert.ok(entries.every(row => ['area', 'term', 'definition', 'knownWhen'].every(key => typeof row[key] === 'string' && row[key].length > 0)));
  for (const [column, name] of Object.entries({
    D: 'New full-day screenshot', H: 'Asia IB location', I: 'Asia after IB path',
    J: 'London IB location', K: 'London after IB path', L: 'NY IB path', M: 'NY after IB path',
    Q: 'Whole-day sequence', R: 'Phase combination (all years)', S: 'BBOX location sequence',
    T: 'Event tags (all years)', E: 'Prior BBOX high', V: 'Gap (original / derived)',
  })) assert.equal(DAY_REVIEW_KNOWLEDGE.columns[column], name);
  assert.equal(DAY_REVIEW_KNOWLEDGE.workedExamples.length, 4);
  assert.equal(Object.hasOwn(DAY_REVIEW_KNOWLEDGE, 'rows'), false);
});

test('IB, after-IB, handoff and complete-session windows retain their distinct anchors', () => {
  const clocks = DAY_REVIEW_KNOWLEDGE.clocks;
  assert.equal(clocks.timezone, 'America/New_York');
  assert.deepEqual(clocks.ASIA, {IB: '19:30–20:30', AIB: '20:30–02:00', full: '19:30–02:00'});
  assert.deepEqual(clocks.LONDON, {IB: '03:00–04:00', AIB: '04:00–08:30', full: '03:00–08:30'});
  assert.deepEqual(clocks.NY, {IB: '09:30–10:30', AIB: '10:30–16:00', full: '09:30–16:00'});
  assert.equal(clocks.ATL, '02:00–03:00');
  assert.equal(clocks.LTN, '08:30–09:30');
  assert.equal(clocks.forecastNY, '08:30–16:00');
  assert.match(clocks.endpoint, /15:55-open/u);
  assert.equal(DAY_REVIEW_KNOWLEDGE.londonExtension.anchor, 'London IB 03:00–04:00.');
  assert.equal(DAY_REVIEW_KNOWLEDGE.londonExtension.upper, 'IB high + 0.5 × IB width');
  assert.equal(DAY_REVIEW_KNOWLEDGE.londonExtension.lower, 'IB low − 0.5 × IB width');
});

test('source examples remain quoted teaching material with separate formal codes and limited visual provenance', () => {
  const examples = DAY_REVIEW_KNOWLEDGE.workedExamples;
  assert.deepEqual(examples.map(row => [row.date, row.contract, row.source.sheetRow]), [
    ['2022-01-04', 'CLG2022', 3], ['2022-01-07', 'CLG2022', 6],
    ['2022-01-20', 'CLH2022', 15], ['2022-01-21', 'CLH2022', 16],
  ]);
  for (const example of examples) {
    assert.match(example.source.permalink, new RegExp(`range=A${example.source.sheetRow}:Z${example.source.sheetRow}`));
    assert.match(example.source.screenshot, /^https:\/\/drive\.google\.com\/file\/d\//u);
    assert.match(example.review.level, /^broad_visual_agreement/u);
    assert.match(example.review.scope, /not revalidated/u);
    assert.ok(DAY_REVIEW_READING_GUIDE.includes(example.cells.Q));
    assert.match(example.cells.R, /ASIA:/u);
    assert.match(example.cells.S, /ASIA02:/u);
    assert.notEqual(example.cells.Q, example.cells.R);
  }
  assert.match(examples[1].review.caveat, /16:00-open/u);
  assert.match(examples[1].review.caveat, /15:55-open/u);
  assert.match(examples[1].review.caveat, /unresolved/u);
  assert.match(DAY_REVIEW_KNOWLEDGE.evidence.timeLimits, /Missing coverage stays unknown/u);
});

test('formal shape classification still uses its own range and the completed phase deadline', () => {
  const evidence = {
    market: 'CL', ticker: 'CLH2022', date: '2022-01-21', cutoff: '2022-01-21T08:30',
    captureNy: '2026-11-07T08:00', timezone: 'America/New_York', intervalMinutes: 5,
    priorNyHigh: 120, priorNyLow: 100, open1930: 98,
    sessions: [{session: 'LONDON', high: 99, low: 94, close: 98.8, order: 'low_first', complete: true}],
  };
  const completed = classifyChartShapeEvidence(evidence, {now: NOW});
  assert.equal(completed.shapeTags.find(row => row.session === 'LONDON').tag, 'UP_FINISH');
  assert.ok(evidence.sessions[0].close < evidence.priorNyLow);
  assert.equal(completed.shapeTags.find(row => row.session === 'NY').status, 'in_progress');
  const early = classifyChartShapeEvidence({...evidence, cutoff: '2022-01-21T08:25'}, {now: NOW});
  assert.equal(early.shapeTags.find(row => row.session === 'LONDON').tag, null);
});

test('legacy v3 callers receive the sourced framework without unrelated example answers', async () => {
  assert.equal(CHART_REFERENCE_VERSION, 'sessionpath-chart-v6');
  assert.equal(validateChartRequest(chartInput, {now: NOW}).referenceVersion, 'sessionpath-chart-v3');
  let sent;
  const handler = createAssistantHandler({now: () => NOW, fetcher: async (_url, init) => {
    sent = JSON.parse(init.body);
    return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(analysis)}}]});
  }});
  const request = new Request('https://assistant.test/api/chart', {
    method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://wanhotrading.github.io', 'CF-Connecting-IP': '192.0.2.8'},
    body: JSON.stringify(chartInput),
  });
  const response = await handler(request, {
    OPENROUTER_API_KEY: 'dummy-test-key',
    ASSISTANT_QUOTA: {getByName: () => ({reserve: async () => ({allowed: true})})},
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.referenceVersion, 'sessionpath-chart-v3');
  assert.deepEqual(result.analysis, analysis);
  assert.equal(sent.model, FREE_MODEL);
  assert.equal(FREE_MODEL, 'nvidia/nemotron-3.5-super-vl:free');
  const system = sent.messages[0].content;
  assert.ok(system.includes(ACTIVE_DAY_REVIEW_GUIDE));
  for(const example of DAY_REVIEW_KNOWLEDGE.workedExamples)assert.equal(system.includes(example.cells.Q),false);
  assert.ok(system.includes('User-supplied layout legend'));
  assert.match(system, /London0.5, not05:00/u);
  assert.match(system, /Known when: 08:30/u);
  assert.ok(CHART_COMPARISON_PROMPT.startsWith(CHART_READING_SYSTEM));
  const user = JSON.parse(sent.messages[1].content[0].text);
  assert.deepEqual(user, {request: chartInput.message, observation: chartInput.observation});
});

test('health reports the actual public knowledge metadata without a provider call', async () => {
  const handler = createAssistantHandler({fetcher: async () => {throw new Error('Health must stay local.');}});
  const response = await handler(new Request('https://assistant.test/health'), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.chartReferenceVersion, 'sessionpath-chart-v6');
  assert.equal(body.model, 'nvidia/nemotron-3.5-super-vl:free');
  assert.equal(body.freeModelsOnly, true);
  assert.deepEqual(body.chartKnowledge, {
    schema: 'sessionpath.day-review.knowledge.v1', source: DAY_REVIEW_KNOWLEDGE.source.url,
    readDate: DAY_REVIEW_KNOWLEDGE.source.readDate, dictionaryEntries: 34,
    exampleDates: ['2022-01-04', '2022-01-07', '2022-01-20', '2022-01-21'],
  });
  assert.equal(Object.hasOwn(body, 'rows'), false);
});
