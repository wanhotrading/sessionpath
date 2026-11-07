import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssistantHandler} from '../router.mjs';
import {validateChartRequest, validateChartShapeEvidence, classifyChartShapeEvidence} from '../chart-vision.mjs';
import {CHART_REFERENCE_VERSION} from '../../../docs/chart-reading-reference.mjs';
import {RASTER_FIXTURES} from './chart-fixtures.mjs';

const NOW = Date.parse('2026-11-07T15:00:00Z'); // 10:00 New York, after the DST change.
const observation = {mode: 'historical', date: '2026-10-30', cutoff: '2026-10-30T16:00'};
const context = {market: 'CL', window: '03:00-05:00', date: null};
const evidence = {
  market: 'CL', ticker: 'CL1!', date: '2026-10-30', cutoff: '2026-10-30T16:00',
  captureNy: '2026-11-07T08:12', timezone: 'America/New_York', intervalMinutes: 5,
  priorNyHigh: 120, priorNyLow: 100, open1930: 110,
  sessions: [
    {session: 'NTA', high: 111, low: 108, close: 110, order: 'low_first', complete: true},
    {session: 'ASIA', high: 114, low: 109, close: 113, order: 'low_first', complete: true},
    {session: 'LONDON', high: 116, low: 110, close: 111, order: 'high_first', complete: true},
    {session: 'NY', high: 118, low: 112, close: 117, order: 'low_first', complete: true},
  ],
};
const analysis = {
  summary: 'The historical chart shows a rise followed by a London decline.',
  sequence: ['Asia rises from its earlier low.', 'London retreats after its high.'],
  bbox: 'The supplied session prices lie inside the prior New York range.',
  sessionpath: 'Forecast boundaries are unavailable in this example.',
  uncertainties: ['The screenshot export time and historical candle times describe different dates.'],
};
const chartBody = extras => ({
  message: 'Read this historical chart through the requested cutoff.', context,
  referenceVersion: CHART_REFERENCE_VERSION, image: {dataUrl: RASTER_FIXTURES.jpeg}, ...extras,
});
function chartPost(body) {
  return new Request('https://assistant.test/api/chart', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Origin: 'https://wanhotrading.github.io',
      'CF-Connecting-IP': '192.0.2.8',
    },
    body: JSON.stringify(body),
  });
}
function harness(modelEvidence = evidence) {
  const state = {quotaCalls: 0, upstreamCalls: 0, sent: null};
  const env = {
    OPENROUTER_API_KEY: 'dummy-test-key',
    ASSISTANT_QUOTA: {getByName: () => ({reserve: async () => {
      state.quotaCalls++;
      return {allowed: true};
    }})},
  };
  const handler = createAssistantHandler({
    now: () => NOW,
    fetcher: async (_url, init) => {
      state.upstreamCalls++;
      state.sent = JSON.parse(init.body);
      return Response.json({choices: [{
        finish_reason: 'stop', message: {content: JSON.stringify({...analysis, shapeEvidence: modelEvidence})},
      }]});
    },
  });
  return {handler, env, state};
}
const tagFor = (result, session) => result.shapeTags.find(row => row.session === session);

test('historical observation is optional and carries a separate exact chart date and cutoff', () => {
  const supplied = validateChartRequest(chartBody({observation}), {now: NOW});
  assert.deepEqual(supplied.observation, observation);
  assert.deepEqual(supplied.context, context);
  const undatedCutoff = {...observation, cutoff: null};
  assert.deepEqual(validateChartRequest(chartBody({observation: undatedCutoff}), {now: NOW}).observation, undatedCutoff);
  assert.equal(Object.hasOwn(validateChartRequest(chartBody(), {now: NOW}), 'observation'), false);
});

test('malformed or future historical observations fail before quota reservation or upstream calls', async () => {
  const invalid = [
    null, '2026-10-30', {...observation, mode: 'live'},
    {mode: 'historical', date: observation.date}, {...observation, extra: true},
    {...observation, date: '2026-02-29', cutoff: null},
    {...observation, date: '2026-11-08', cutoff: null},
    {...observation, cutoff: '2026-10-29T16:00'},
    {...observation, cutoff: '2026-10-30T16:01'},
    {...observation, cutoff: '2026-10-30T24:00'},
    {...observation, cutoff: '16:00'},
    {mode: 'historical', date: '2026-11-07', cutoff: '2026-11-07T10:05'},
  ];
  const h = harness();
  for (const supplied of invalid) {
    const response = await h.handler(chartPost(chartBody({observation: supplied})), h.env);
    assert.equal(response.status, 400, JSON.stringify(supplied));
    assert.equal((await response.json()).error.code, 'INVALID_CHART_REQUEST');
  }
  assert.equal(h.state.quotaCalls, 0);
  assert.equal(h.state.upstreamCalls, 0);
});

test('October candles remain historical when exported after the November DST change', () => {
  // Oct. 30 16:00 EDT = 20:00 UTC. Nov. 7 08:12 EST = 13:12 UTC.
  assert.ok(Date.parse('2026-10-30T16:00:00-04:00') < Date.parse('2026-11-07T08:12:00-05:00'));
  const result = classifyChartShapeEvidence(evidence, {now: NOW, observation});
  assert.equal(result.chartObservation.date, '2026-10-30');
  assert.equal(result.chartObservation.cutoff, '2026-10-30T16:00');
  assert.equal(tagFor(result, 'LONDON').tag, 'DOWN_FINISH');
  assert.equal(tagFor(result, 'NY').tag, 'UP_FINISH');
});

test('a capture timestamp and historical request cannot silently supply missing chart metadata', () => {
  const captureOnly = {
    ...evidence, date: null, cutoff: null, timezone: null, intervalMinutes: null,
  };
  const validated = validateChartShapeEvidence(captureOnly, {now: NOW, observation});
  assert.equal(validated.date, null);
  assert.equal(validated.cutoff, null);
  assert.equal(validated.timezone, null);
  assert.equal(validated.intervalMinutes, null);
  const result = classifyChartShapeEvidence(captureOnly, {now: NOW, observation});
  assert.ok(result.shapeTags.every(row => row.tag === null && row.status === 'unverified'));
  for (const field of ['date', 'cutoff', 'timezone', 'intervalMinutes']) {
    const missingField = validateChartShapeEvidence({...evidence, [field]: null}, {now: NOW, observation});
    assert.equal(missingField[field], null, field);
  }
});

test('an explicit historical date conflicting with model evidence leaves date and cutoff unverified', () => {
  const contradictory = {...evidence, date: '2026-10-29', cutoff: '2026-10-29T16:00'};
  const validated = validateChartShapeEvidence(contradictory, {now: NOW, observation});
  assert.equal(validated.date, null);
  assert.equal(validated.cutoff, null);
  const result = classifyChartShapeEvidence(contradictory, {now: NOW, observation});
  assert.ok(result.shapeTags.every(row => row.tag === null && row.status === 'unverified'));
});

test('a requested cutoff excludes later model observations and preserves earlier completed cutoffs', () => {
  const later = validateChartShapeEvidence({...evidence, cutoff: '2026-10-30T16:05'}, {now: NOW, observation});
  assert.equal(later.cutoff, null);
  const earlier = classifyChartShapeEvidence({...evidence, cutoff: '2026-10-30T15:55'}, {now: NOW, observation});
  assert.equal(earlier.chartObservation.cutoff, '2026-10-30T15:55');
  assert.equal(tagFor(earlier, 'NY').status, 'in_progress');
  assert.equal(tagFor(earlier, 'NY').tag, null);
  const openCutoff = validateChartShapeEvidence(evidence, {now: NOW, observation: {...observation, cutoff: null}});
  assert.equal(openCutoff.cutoff, evidence.cutoff);
});

test('London requires its completed 08:30 close even during historical review', () => {
  const requested = {...observation, cutoff: '2026-10-30T08:30'};
  for (const [time, status, tag] of [['08:25', 'in_progress', null], ['08:30', 'provisional', 'DOWN_FINISH']]) {
    const result = classifyChartShapeEvidence({...evidence, cutoff: `2026-10-30T${time}`}, {now: NOW, observation: requested});
    assert.equal(tagFor(result, 'LONDON').status, status);
    assert.equal(tagFor(result, 'LONDON').tag, tag);
  }
});

test('handler forwards and echoes explicit historical context without converting selected page context into chart evidence', async () => {
  const h = harness();
  const input = chartBody({observation});
  const response = await h.handler(chartPost(input), h.env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.observationContext, observation);
  assert.equal(result.chartObservation.date, evidence.date);
  assert.equal(result.chartObservation.cutoff, evidence.cutoff);
  assert.deepEqual(JSON.parse(h.state.sent.messages[1].content[0].text), {request: input.message, observation});
  assert.equal(h.state.quotaCalls, 1);
  assert.equal(h.state.upstreamCalls, 1);
});

test('legacy chart requests omit observation fields from model input and reply', async () => {
  const h = harness();
  const input = chartBody();
  const response = await h.handler(chartPost(input), h.env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(Object.hasOwn(result, 'observationContext'), false);
  const userText = JSON.parse(h.state.sent.messages[1].content[0].text);
  assert.deepEqual(userText, {request: input.message});
});

test('handler applies requested date and cutoff constraints to the model result', async () => {
  for (const modelEvidence of [
    {...evidence, date: '2026-10-29', cutoff: '2026-10-29T16:00'},
    {...evidence, cutoff: '2026-10-30T16:05'},
  ]) {
    const h = harness(modelEvidence);
    const response = await h.handler(chartPost(chartBody({observation})), h.env);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.chartObservation.cutoff, null);
    assert.ok(result.shapeTags.every(row => row.tag === null && row.status === 'unverified'));
  }
});
