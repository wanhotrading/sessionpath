import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssistantHandler, FREE_MODEL, OPENROUTER_URL} from '../router.mjs';
import {validateChartImage, validateChartRequest, validateChartAnalysis, CHART_MAX_DATA_URL_LENGTH, CHART_MAX_REQUEST_BYTES} from '../chart-vision.mjs';
import {CHART_REFERENCE_VERSION, CHART_READING_SYSTEM} from '../../../docs/chart-reading-reference.mjs';
import {RASTER_FIXTURES} from './chart-fixtures.mjs';

const NOW = Date.parse('2026-11-05T13:00:00Z');
const context = {market: 'CL', window: '03:00-05:00', date: null};
const analysis = {summary: 'The visible candles initially rise, then retrace into the earlier range.', sequence: ['Price rises toward the visible upper area.', 'The latest visible candles retrace.'], bbox: 'The BBOX boundaries are not legible enough to identify a completed-close return.', sessionpath: 'A green and red region is visible, but its full labels and endpoint are unclear.', uncertainties: ['The chart timezone and latest candle completion status are not established.']};
const chartBody = (extras = {}) => ({message: '', context, image: {dataUrl: RASTER_FIXTURES.jpeg}, ...extras});
function chartPost(body = chartBody(), headers = {}) {return new Request('https://assistant.test/api/chart', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://wanhotrading.github.io', 'CF-Connecting-IP': '192.0.2.8', ...headers}, body: JSON.stringify(body)});}
const visionResponse = value => Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(value)}}]});
function setup(fetcher = async () => visionResponse(analysis), overrides = {}) {
  let count = 0;
  const env = {OPENROUTER_API_KEY: 'dummy-not-real-secret', ASSISTANT_QUOTA: {getByName(name) {assert.equal(name, 'global-free-ai-v1'); return {reserve: async ({ip}) => {assert.equal(ip, '192.0.2.8'); count++; return {allowed: true};}};}}};
  return {env, handler: createAssistantHandler({fetcher, now: () => NOW, ...overrides}), count: () => count};
}
function asDataUrl(bytes, mime = 'image/png') {return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;}

test('raster validation accepts genuine static PNG, JPEG and WebP fixture headers without decoding pixels', () => {
  for (const [kind, dataUrl] of Object.entries(RASTER_FIXTURES)) {
    const image = validateChartImage(dataUrl);
    assert.equal(image.width, 64, kind); assert.equal(image.height, 48, kind); assert.equal(image.dataUrl, dataUrl);
  }
  assert.equal(validateChartRequest(chartBody(), {now: NOW}).message, 'Describe the visible price movement so far.');
  const missing = chartBody(); delete missing.message;
  assert.equal(validateChartRequest(missing, {now: NOW}).message, 'Describe the visible price movement so far.');
});

test('reject URLs, SVG/GIF, invalid base64, MIME mismatch, truncated headers and excessive dimensions before AI', async () => {
  const large = Buffer.from(RASTER_FIXTURES.png.split(',')[1], 'base64'); large.writeUInt32BE(5000, 16);
  const tooManyPixels = Buffer.from(RASTER_FIXTURES.png.split(',')[1], 'base64'); tooManyPixels.writeUInt32BE(4000, 16); tooManyPixels.writeUInt32BE(4000, 20);
  const bad = ['https://private.example/chart.png', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/gif;base64,R0lGODlh', 'data:image/png;base64,@@@=', 'data:image/png;base64,AA=A', 'data:image/png;base64,AB==', RASTER_FIXTURES.png.replace('image/png', 'image/jpeg'), asDataUrl([137, 80, 78, 71]), asDataUrl(large), asDataUrl(tooManyPixels)];
  const s = setup(() => {throw new Error('No AI for bad input');});
  for (const dataUrl of bad) {
    const response = await s.handler(chartPost(chartBody({image: {dataUrl}})), s.env);
    assert.equal(response.status, 400, dataUrl.slice(0, 50));
    assert.match((await response.json()).error.code, /^(?:INVALID_CHART_IMAGE|CHART_IMAGE_DIMENSIONS)$/u);
  }
  assert.equal(s.count(), 0);
});

test('chart input has strict context and image shape and rejects future dates, model overrides and long prompts', async () => {
  const s = setup();
  for (const body of [chartBody({model: 'paid/model'}), chartBody({message: 'a'.repeat(601)}), chartBody({image: {dataUrl: RASTER_FIXTURES.jpeg, url: 'https://example.test'}}), chartBody({context: {...context, date: '2027-01-01'}}), chartBody({context: {...context, date: '2026-02-30'}}), chartBody({context: {market: 'CL', window: '03:00-05:00'}})]) {
    const response = await s.handler(chartPost(body), s.env); assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'INVALID_CHART_REQUEST');
  }
  assert.equal(s.count(), 0);
});

test('chart HTTP/dataURL limits are bounded independently of the small text chat limit', async () => {
  const s = setup();
  const tooLarge = chartBody({image: {dataUrl: 'x'.repeat(CHART_MAX_DATA_URL_LENGTH + 1)}});
  let response = await s.handler(chartPost(tooLarge), s.env); assert.equal(response.status, 413); assert.equal((await response.json()).error.code, 'CHART_IMAGE_TOO_LARGE');
  response = await s.handler(chartPost(chartBody(), {'Content-Length': String(CHART_MAX_REQUEST_BYTES + 1)}), s.env); assert.equal(response.status, 413);
  const bytes = Buffer.from(RASTER_FIXTURES.jpeg.split(',')[1], 'base64');
  const comment = Buffer.alloc(4004, 65); comment[0] = 255; comment[1] = 254; comment.writeUInt16BE(4002, 2);
  const paddedJpeg = asDataUrl(Buffer.concat([bytes.subarray(0, 2), comment, bytes.subarray(2)]), 'image/jpeg');
  assert.ok(paddedJpeg.length > 3072);
  response = await s.handler(chartPost(chartBody({image: {dataUrl: paddedJpeg}})), s.env); assert.equal(response.status, 200);
  assert.equal(s.count(), 1);
});

test('chart uses official multipart image_url format and same pinned free model, secret and shared quota', async () => {
  let calledUrl, sent;
  const s = setup(async (url, init) => {calledUrl = url; sent = JSON.parse(init.body); return visionResponse(analysis);});
  const response = await s.handler(chartPost(), s.env); assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {ok: true, schema: 'sessionpath.assistant.chart.v1', action: 'describe_chart', ...context, model: FREE_MODEL, referenceVersion: CHART_REFERENCE_VERSION, analysis});
  assert.equal(calledUrl, OPENROUTER_URL); assert.equal(sent.model, 'nvidia/nemotron-3.5-super-vl:free');
  assert.equal(sent.max_tokens, 1600); assert.deepEqual(sent.reasoning, {enabled: false}); assert.equal(sent.provider.require_parameters, true); assert.equal(sent.response_format.json_schema.strict, true);
  assert.ok(sent.messages[0].content.startsWith(CHART_READING_SYSTEM)); assert.ok(!sent.messages[0].content.includes('Omit all percentages'));
  assert.equal(sent.messages[1].content[0].type, 'text'); assert.match(sent.messages[1].content[0].text, /Describe the visible price movement so far/u);
  assert.deepEqual(sent.messages[1].content[1], {type: 'image_url', image_url: {url: RASTER_FIXTURES.jpeg}});
  assert.equal(s.count(), 1);
  for (const field of ['models', 'plugins', 'tools']) assert.equal(sent[field], undefined);
  assert.ok(!JSON.stringify(body).includes(s.env.OPENROUTER_API_KEY)); assert.ok(!JSON.stringify(body).includes('data:image'));
});

test('unreadable screenshot returns explicit uncertainty instead of invented chart observations', async () => {
  const blank = {summary: 'The supplied image is blank or not a readable chart.', sequence: ['No candle sequence can be established from this image.'], bbox: 'No identifiable BBOX boundaries are visible.', sessionpath: 'No identifiable SessionPath forecast box is visible.', uncertainties: ['A readable screenshot with candles, time axis and box labels is needed.']};
  const s = setup(async () => visionResponse(blank));
  const response = await s.handler(chartPost(chartBody({image: {dataUrl: RASTER_FIXTURES.png}})), s.env);
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).analysis, blank);
});

test('chart output rejects unexpected fields, invented probabilities/codes, markup, URLs and trade instructions', async () => {
  const invalid = [{...analysis, probability: 90}, {...analysis, summary: 'There is a 90% chance of expansion.'}, {...analysis, bbox: 'SP6|123|456'}, {...analysis, summary: '<script>bad()</script>'}, {...analysis, summary: 'Buy now with a stop-loss.'}, {...analysis, summary: '請做多並設定止損。'}, {...analysis, summary: 'Read https://secret.example'}, {...analysis, uncertainties: []}, {...analysis, sequence: Array(9).fill('A visible candle.')}, {...analysis, summary: 'x'.repeat(801)}];
  for (const value of invalid) {
    assert.equal(validateChartAnalysis(value), null);
    const s = setup(async () => visionResponse(value));
    const response = await s.handler(chartPost(), s.env); assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'INVALID_CHART_RESPONSE');
  }
});

test('legible percentage annotations remain descriptive evidence without becoming a probability forecast', async () => {
  const visible = {...analysis, sessionpath: 'The legible label shows 80% AVR printed. This is an annotation and does not establish a live return probability.'};
  assert.deepEqual(validateChartAnalysis(visible), visible);
  const s = setup(async () => visionResponse(visible));
  const response = await s.handler(chartPost(), s.env);
  assert.equal(response.status, 200); assert.equal((await response.json()).analysis.sessionpath, visible.sessionpath);
});

test('chart quota and missing credentials fail before upstream and never fall back to text forecasts', async () => {
  let calls = 0;
  const s = setup(async () => {calls++; throw new Error('Should not call');});
  assert.equal((await s.handler(chartPost(), {})).status, 503);
  const noIp = chartPost(); noIp.headers.delete('CF-Connecting-IP'); assert.equal((await s.handler(noIp, s.env)).status, 503);
  s.env.ASSISTANT_QUOTA = {getByName: () => ({reserve: async () => ({allowed: false, retryAfter: 90})})};
  const response = await s.handler(chartPost(), s.env); assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '90'); assert.equal(calls, 0);
});

test('chart fixed errors, timeout and output limits never expose provider text or retry', async () => {
  for (const [status, code] of [[400, 'FREE_MODEL_REASONING_UNSUPPORTED'], [401, 'AI_KEY_REJECTED'], [402, 'AI_CREDIT_RESTRICTED'], [403, 'AI_ACCESS_RESTRICTED'], [429, 'FREE_MODEL_BUSY'], [503, 'FREE_MODEL_UNAVAILABLE']]) {
    let calls = 0;
    const s = setup(async () => {calls++; return Response.json({error: {message: 'Unsupported reasoning. private-provider-detail'}}, {status});});
    const response = await s.handler(chartPost(), s.env); const body = await response.json(); assert.equal(body.error.code, code); assert.ok(!JSON.stringify(body).includes('private-provider-detail')); assert.equal(calls, 1); assert.equal(s.count(), 1);
  }
  const timeout = setup(async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('private-timeout-detail')))), {chartTimeoutMs: 10});
  const timed = await timeout.handler(chartPost(), timeout.env); assert.equal((await timed.json()).error.code, 'FREE_MODEL_TIMEOUT');
  for (const provider of [Response.json({choices: [{finish_reason: 'length', message: {content: null}}]}), new Response('x'.repeat(24577))]) {
    const s = setup(async () => provider); const response = await s.handler(chartPost(), s.env); assert.equal(response.status, 503); assert.equal(s.count(), 1);
  }
});

test('chart endpoint uses the same restricted CORS and POST-only policy', async () => {
  const s = setup();
  const allowed = new Request('https://assistant.test/api/chart', {method: 'OPTIONS', headers: {Origin: 'https://wanhotrading.github.io', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type'}});
  const response = await s.handler(allowed, s.env); assert.equal(response.status, 204); assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://wanhotrading.github.io');
  assert.equal((await s.handler(chartPost(chartBody(), {Origin: 'https://evil.test'}), s.env)).status, 403);
  assert.equal((await s.handler(new Request('https://assistant.test/api/chart'), s.env)).status, 405);
});
