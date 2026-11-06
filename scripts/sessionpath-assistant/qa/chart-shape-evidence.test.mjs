import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyChartShapeEvidence} from '../chart-vision.mjs';
import {OCT19_NQ_SHAPE_CASE, OCT19_NQ_EXPECTED_TAGS} from './chart-shape-case.mjs';

const now = Date.parse('2026-11-05T13:00:00Z');
const classify = evidence => classifyChartShapeEvidence(evidence, {now});
const bySession = (result, session) => result?.shapeTags.find(row => row.session === session);
const london = (order, close, extra = {}) => ({session: 'LONDON', high: 30000, low: 29900, close, order, complete: true, ...extra});
const withLondon = (row, extra = {}) => ({...OCT19_NQ_SHAPE_CASE, priorNyHigh: 30000, priorNyLow: 29800, sessions: [row], ...extra});

test('Oct. 19 evidence from native candles reproduces the three known tags and leaves NY unfinished', () => {
  const result = classify(OCT19_NQ_SHAPE_CASE);
  assert.equal(result.chartObservation.market, 'NQ');
  assert.equal(result.chartObservation.date, '2026-10-19');
  assert.equal(result.chartObservation.cutoff, '2026-10-19T10:45');
  assert.deepEqual(Object.fromEntries(result.shapeTags.map(row => [row.session, row.tag])), OCT19_NQ_EXPECTED_TAGS);
  assert.equal(bySession(result, 'NY').status, 'in_progress');
  for (const session of ['NTA', 'ASIA', 'LONDON']) assert.equal(bySession(result, session).status, 'provisional');
});

test('directional shape labels use both first-extreme order and inclusive closing thresholds', () => {
  for (const [order, close, expected] of [
    ['high_first', 29925, 'DOWN_FINISH'],
    ['high_first', 29925.25, 'DOWN_THEN_BOUNCE'],
    ['high_first', 29969.75, 'DOWN_THEN_BOUNCE'],
    ['high_first', 29970, 'DROP_RECOVERY'],
    ['low_first', 29930, 'RALLY_FADE'],
    ['low_first', 29930.25, 'UP_THEN_PULLBACK'],
    ['low_first', 29974.75, 'UP_THEN_PULLBACK'],
    ['low_first', 29975, 'UP_FINISH'],
    ['same_bar', 29975, 'ORDER_UNRESOLVED'],
  ]) {
    assert.equal(bySession(classify(withLondon(london(order, close))), 'LONDON')?.tag, expected, `${order}: ${close}`);
  }
});

test('Narrow takes priority and uses a strict 18% threshold against the prior NY BBOX', () => {
  const narrow = london('same_bar', 29910, {high: 29917.75});
  const equal = {...narrow, high: 29918};
  const bbox = {priorNyHigh: 30000, priorNyLow: 29900};
  assert.equal(bySession(classify(withLondon(narrow, bbox)), 'LONDON')?.tag, 'NARROW');
  assert.equal(bySession(classify(withLondon(equal, bbox)), 'LONDON')?.tag, 'ORDER_UNRESOLVED');
});

test('incomplete and unknown evidence cannot produce an official shape guess', () => {
  const claimedComplete = london('high_first', 29925);
  const beforeLondonEnd = withLondon(claimedComplete, {cutoff: '2026-10-19T08:25'});
  const noFinalClose = withLondon({...claimedComplete, close: null});
  const noPriorBbox = withLondon(claimedComplete, {priorNyHigh: null, priorNyLow: null});
  const noOrder = withLondon({...claimedComplete, order: null});
  const noTime = withLondon(claimedComplete, {cutoff: null});
  for (const evidence of [beforeLondonEnd, noFinalClose, noPriorBbox, noOrder, noTime]) {
    assert.equal(bySession(classify(evidence), 'LONDON')?.tag ?? null, null);
  }
});

test('phase endpoints are New York completed-close cutoffs, including previous-evening NTA', () => {
  const {sessions} = OCT19_NQ_SHAPE_CASE;
  const nyComplete = {...sessions[2], session: 'NY'};
  const evidence = {...OCT19_NQ_SHAPE_CASE, sessions: [...sessions.slice(0, 3), nyComplete]};
  const cases = [
    ['NTA', '2026-10-18T19:25', '2026-10-18T19:30'],
    ['ASIA', '2026-10-19T01:55', '2026-10-19T02:00'],
    ['LONDON', '2026-10-19T08:25', '2026-10-19T08:30'],
    ['NY', '2026-10-19T15:55', '2026-10-19T16:00'],
  ];
  for (const [session, before, at] of cases) {
    assert.equal(bySession(classify({...evidence, cutoff: before}), session).tag, null);
    assert.equal(bySession(classify({...evidence, cutoff: at}), session).status, 'provisional');
  }
  assert.ok(classify({...evidence, timezone: null}).shapeTags.every(row => row.tag === null));
});
