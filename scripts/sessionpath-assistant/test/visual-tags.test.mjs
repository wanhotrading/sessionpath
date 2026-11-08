import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssistantHandler} from '../router.mjs';
import {CHART_MODEL, CHART_ANALYSIS_SCHEMA, classifyChartShapeEvidence, classifySessionShape, normalizeChartVisualTags, validateChartAnalysis, validateChartRequest, validateChartVisualProposal} from '../chart-vision.mjs';
import {CHART_VISUAL_SESSIONS, CHART_VISUAL_TAG_CODES, validateVisualTags} from '../../../docs/chart-visual-contract.mjs';
import {CHART_REFERENCE_VERSION, CHART_READING_SYSTEM} from '../../../docs/chart-reading-reference.mjs';
import {RASTER_FIXTURES} from './chart-fixtures.mjs';

const NOW = Date.parse('2026-11-08T18:00:00Z');
const observation = {mode: 'historical', date: '2026-10-30', cutoff: '2026-10-30T16:00'};
const shapeEvidence = {
  market: 'CL', ticker: 'CL1!', date: observation.date, cutoff: observation.cutoff,
  captureNy: '2026-11-07T08:12', timezone: 'America/New_York', intervalMinutes: 5,
  priorNyHigh: 120, priorNyLow: 100, open1930: 110,
  sessions: [{session: 'LONDON', high: null, low: null, close: null, order: 'high_first', complete: true}],
};
const prose = {summary: 'The actual candles decline and then recover part of the move.', sequence: ['The first actual high precedes the low.', 'The final candle recovers into the session range.'], bbox: 'The printed prior range is distinct from the session range.', sessionpath: 'The forecast edges are separate from actual candle extremes.', uncertainties: ['The exact candle prices are not labelled.']};
const proposal = (session, overrides = {}) => ({session, tag: 'DOWN_THEN_BOUNCE', confidence: 'tentative', evidence: 'The actual high comes first, followed by the low; the own-session final close is visibly in Q2.', uncertainty: 'The exact close threshold and Narrow comparison are uncertain.', complete: true, ...overrides});
const proposals = () => CHART_VISUAL_SESSIONS.map(session => proposal(session));
const rowFor = (rows, session) => rows.find(row => row.session === session);
const options = extras => ({now: NOW, observation, shapeEvidence, ...extras});
const normalize = (rows, extras) => normalizeChartVisualTags(rows, options(extras));

test('strict model schema requires visual proposals while accepting legacy request reference versions', () => {
  assert.equal(CHART_REFERENCE_VERSION, 'sessionpath-chart-v7');
  assert.ok(CHART_ANALYSIS_SCHEMA.required.includes('visualTags'));
  const schema = CHART_ANALYSIS_SCHEMA.properties.visualTags;
  assert.equal(schema.minItems, 4); assert.equal(schema.maxItems, 4);
  assert.equal(schema.items.additionalProperties, false);
  assert.deepEqual(schema.items.required, ['session', 'tag', 'confidence', 'evidence', 'uncertainty', 'complete']);
  assert.deepEqual(schema.items.properties.tag.enum, [...CHART_VISUAL_TAG_CODES, null]);
  for (const referenceVersion of ['sessionpath-chart-v6', 'sessionpath-chart-v1', CHART_REFERENCE_VERSION]) {
    assert.equal(validateChartRequest({context: {market: 'CL', window: '03:00-05:00', date: null}, image: {dataUrl: RASTER_FIXTURES.png}, referenceVersion}, {now: NOW}).referenceVersion, referenceVersion);
  }
});

test('unlabelled exact HLC remains null without blocking a qualitative visual candidate', () => {
  const rows = normalize(proposals());
  assert.equal(validateVisualTags(rows), true);
  const london = rowFor(rows, 'LONDON');
  assert.equal(london.tag, 'DOWN_THEN_BOUNCE'); assert.equal(london.status, 'candidate'); assert.equal(london.source, 'visual');
  assert.match(london.evidence, /actual high comes first.*own-session final close.*Q2/u);
  assert.deepEqual(shapeEvidence.sessions[0], {session: 'LONDON', high: null, low: null, close: null, order: 'high_first', complete: true});
  const formal = classifyChartShapeEvidence(shapeEvidence, {now: NOW, observation});
  assert.equal(rowFor(formal.shapeTags, 'LONDON').tag, null);
  assert.equal(rowFor(formal.shapeTags, 'LONDON').status, 'unverified');
});

test('a visual completion claim with unknown timing stays tentative and explicitly discloses timing uncertainty', () => {
  const rows = normalizeChartVisualTags([proposal('ASIA', {confidence: 'clear', uncertainty: 'x'.repeat(300)})], {now: NOW});
  const asia = rowFor(rows, 'ASIA');
  assert.equal(asia.status, 'candidate'); assert.equal(asia.confidence, 'tentative');
  assert.match(asia.uncertainty, /^Timing uncertainty:/u); assert.ok(asia.uncertainty.length <= 300);
  assert.equal(validateVisualTags(rows), true);
});

test('incomplete and null proposals become unclassified rather than shape codes', () => {
  const rows = normalize([proposal('ASIA', {complete: false}), proposal('LONDON', {tag: null, confidence: 'clear'})]);
  for (const session of ['ASIA', 'LONDON']) {
    const row = rowFor(rows, session); assert.equal(row.tag, null); assert.equal(row.status, 'unclassified'); assert.equal(row.confidence, 'unclassified');
  }
  assert.equal(validateVisualTags(rows), true);
});

test('invalid visual rows degrade separately without retaining forged source or status', () => {
  for (const bad of [
    {status: 'archive'}, {source: 'verified'}, {tag: 'NOT_A_CODE'},
    {evidence: '<script>bad()</script>'}, {uncertainty: 'See https://example.test'},
    {evidence: 'SP6|123|456'}, {evidence: 'Buy now.'}, {evidence: 'There is a 90% chance of a rally.'},
    {evidence: 'x'.repeat(401)}, {uncertainty: 'x'.repeat(301)}, {complete: 'true'},
  ]) {
    const badRow = proposal('ASIA', bad);
    assert.equal(validateChartVisualProposal(badRow), false, JSON.stringify(bad));
    const rows = normalize([badRow, proposal('LONDON')]);
    assert.equal(rowFor(rows, 'ASIA').status, 'unclassified'); assert.equal(rowFor(rows, 'ASIA').tag, null);
    assert.equal(rowFor(rows, 'LONDON').status, 'candidate'); assert.equal(validateVisualTags(rows), true);
    assert.equal(validateChartAnalysis({...prose, visualTags: [badRow]}).summary, prose.summary);
  }
});

test('duplicates and malformed arrays cannot claim a session and response validation rejects forged contracts', () => {
  const duplicated = normalize([proposal('ASIA'), proposal('ASIA'), proposal('LONDON')]);
  assert.equal(rowFor(duplicated, 'ASIA').status, 'unclassified'); assert.equal(rowFor(duplicated, 'LONDON').status, 'candidate');
  for (const raw of [null, {}, 'wrong', Array(5).fill(proposal('ASIA'))]) {
    const rows = normalize(raw); assert.equal(validateVisualTags(rows), true); assert.ok(rows.every(row => row.tag === null));
  }
  const rows = normalize(proposals());
  for (const patch of [{status: 'archive'}, {status: 'verified'}, {source: 'archive'}, {tag: 'NOT_A_CODE'}, {evidence: '<b>bad</b>'}, {complete: false}, {extra: true}]) {
    assert.equal(validateVisualTags([{...rows[0], ...patch}, ...rows.slice(1)]), false, JSON.stringify(patch));
  }
  assert.equal(validateVisualTags([rows[0], rows[0], ...rows.slice(2)]), false);
  assert.equal(validateVisualTags(rows.slice(1)), false);
});

test('08:30 completed cutoff permits London and blocks NY despite a later model cutoff', () => {
  const supplied = {...observation, cutoff: '2026-10-30T08:30'};
  const rows = normalize(proposals(), {observation: supplied});
  const ny = rowFor(rows, 'NY');
  assert.equal(ny.status, 'in_progress'); assert.equal(ny.tag, null); assert.equal(ny.complete, false);
  const london = rowFor(rows, 'LONDON');
  assert.equal(london.status, 'candidate'); assert.equal(london.confidence, 'tentative');
  assert.match(london.uncertainty, /supplied cutoff takes precedence/u);
  assert.equal(validateVisualTags(rows), true);
});

test('the earlier validated chart cutoff and conflicting chart dates constrain visual proposals', () => {
  const rows = normalize(proposals(), {observation: {...observation, cutoff: '2026-10-30T08:30'}, shapeEvidence: {...shapeEvidence, cutoff: '2026-10-30T08:25'}});
  assert.equal(rowFor(rows, 'LONDON').status, 'in_progress');
  assert.equal(rowFor(rows, 'NY').status, 'in_progress');
  const wrongDate = normalize(proposals(), {shapeEvidence: {...shapeEvidence, date: '2026-10-29', cutoff: '2026-10-29T16:00'}});
  assert.ok(wrongDate.every(row => row.tag === null));
  assert.match(rowFor(wrongDate, 'ASIA').uncertainty, /date conflicts/u);
});

test('visual proposals cannot change Narrow precedence, exact thresholds or formal outputs', () => {
  const exact = {...shapeEvidence, sessions: [{session: 'LONDON', high: 116, low: 110, close: 111, order: 'high_first', complete: true}]};
  const before = classifyChartShapeEvidence(exact, {now: NOW, observation});
  const candidate = normalize(proposals(), {shapeEvidence: exact});
  assert.equal(rowFor(candidate, 'LONDON').tag, 'DOWN_THEN_BOUNCE');
  assert.deepEqual(classifyChartShapeEvidence(exact, {now: NOW, observation}), before);
  assert.equal(rowFor(before.shapeTags, 'LONDON').tag, 'DOWN_FINISH');
  assert.equal(classifySessionShape({high: 103.5, low: 100, close: 102, order: 'high_first', bboxWidth: 20}), 'NARROW');
  assert.equal(classifySessionShape({high: 120, low: 100, close: 105, order: 'high_first', bboxWidth: 20}), 'DOWN_FINISH');
  assert.equal(classifySessionShape({high: 120, low: 100, close: 106, order: 'low_first', bboxWidth: 20}), 'RALLY_FADE');
});

test('handler adds four visual rows for old outputs and preserves valid prose and formal results for invalid visuals', async () => {
  const exact = {...shapeEvidence, sessions: [{session: 'LONDON', high: 116, low: 110, close: 111, order: 'high_first', complete: true}]};
  for (const visual of [undefined, [{...proposal('LONDON'), status: 'archive'}]]) {
    const handler = createAssistantHandler({now: () => NOW, fetcher: async () => Response.json({model: CHART_MODEL, choices: [{finish_reason: 'stop', message: {content: JSON.stringify({...prose, shapeEvidence: exact, ...(visual === undefined ? {} : {visualTags: visual})})}}]})});
    const response = await handler(new Request('https://assistant.test/api/chart', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://wanhotrading.github.io', 'CF-Connecting-IP': '192.0.2.8'}, body: JSON.stringify({context: {market: 'CL', window: '03:00-05:00', date: null}, image: {dataUrl: RASTER_FIXTURES.png}, observation})}), {OPENROUTER_API_KEY: 'dummy-test-key', ASSISTANT_QUOTA: {getByName: () => ({reserve: async () => ({allowed: true})})}});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.analysis, prose); assert.equal(validateVisualTags(body.visualTags), true);
    assert.equal(rowFor(body.shapeTags, 'LONDON').tag, 'DOWN_FINISH'); assert.equal(rowFor(body.shapeTags, 'LONDON').status, 'provisional');
    assert.ok(body.visualTags.every(row => row.tag === null && row.source === 'visual'));
    assert.equal(Object.hasOwn(body, 'pathCode'), false);
  }
});

test('generic visual workflow permits qualitative reading without embedding target answers', () => {
  assert.match(CHART_READING_SYSTEM, /printed OWN-session Q2 or Q3/u);
  assert.match(CHART_READING_SYSTEM, /Check Narrow first/u);
  assert.match(CHART_READING_SYSTEM, /first actual session high/u);
  assert.match(CHART_READING_SYSTEM, /Missing exact H, L or C stays null/u);
  assert.match(CHART_READING_SYSTEM, /observations before choosing a candidate/u);
  assert.doesNotMatch(CHART_READING_SYSTEM, /2026-11-05|November 5|Nov 5|archive outcomes/u);
});

test('generic scope instructions keep checkpoint anchors and cumulative extremes separate from session evidence', () => {
  assert.match(CHART_READING_SYSTEM, /every printed table field attached to its own labelled checkpoint and measurement scope/u);
  assert.match(CHART_READING_SYSTEM, /current WEBSITE INPUTS decision open cannot anchor an earlier, ended SessionPath forecast window/u);
  assert.match(CHART_READING_SYSTEM, /from its own printed label or code/u);
  assert.match(CHART_READING_SYSTEM, /cumulative high or low since 19:30 belongs to the running combined range/u);
  assert.match(CHART_READING_SYSTEM, /Trace the actual extreme candle's time before attributing/u);
  assert.match(CHART_READING_SYSTEM, /describe it as excluded, not absent/u);
  assert.match(CHART_READING_SYSTEM, /explicitly name NARROW as a competing interpretation/u);
  assert.doesNotMatch(CHART_READING_SYSTEM, /2026-11-05|November 5|Nov 5|89\.54|86\.65/u);
});
