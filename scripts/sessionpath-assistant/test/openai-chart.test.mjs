import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssistantHandler, OPENROUTER_URL, FREE_MODEL} from '../router.mjs';
import {CHART_ANALYSIS_SCHEMA} from '../chart-vision.mjs';
import {OPENAI_CHART_ENDPOINT, OPENAI_CHART_MODEL} from '../openai-chart.mjs';
import {CHART_REFERENCE_VERSION, CHART_READING_SYSTEM} from '../../../docs/chart-reading-reference.mjs';
import {RASTER_FIXTURES} from './chart-fixtures.mjs';

const now = Date.parse('2026-11-07T15:00:00Z');
const context = {market: 'NQ', window: '05:00-08:30', date: null};
const observation = {mode: 'historical', date: '2026-11-06', cutoff: '2026-11-06T08:30'};
const message = 'Did the price wick above the prior BBOX high?';
const analysis = {
  summary: 'The upper wick appears to pass the marked prior BBOX high.',
  sequence: ['Price approached the line and later traded back below it.'],
  bbox: 'A wick beyond the upper boundary is visible.',
  sessionpath: 'The forecast box is shown separately.',
  uncertainties: ['The screenshot does not establish whether the candle closed above the boundary.'],
};
const chartBody = {context, message, image: {dataUrl: RASTER_FIXTURES.jpeg}, observation, referenceVersion: CHART_REFERENCE_VERSION};

function post(path, body, headers = {}) {
  return new Request(`https://assistant.test${path}`, {
    method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://wanhotrading.github.io', ...headers},
    body: JSON.stringify(body),
  });
}

function success({model = OPENAI_CHART_MODEL, content = [{type: 'output_text', text: JSON.stringify(analysis)}]} = {}) {
  return Response.json({status: 'completed', model, output: [
    {type: 'reasoning', summary: []}, {type: 'message', role: 'assistant', status: 'completed', content},
  ]});
}

function setup(fetcher = () => success(), options = {}) {
  const calls = [];
  const reservations = [];
  const env = {
    OPENAI_API_KEY: 'test-only-credential', OPENAI_CHART_MODEL,
    OPENROUTER_API_KEY: 'test-only-legacy-credential',
    ASSISTANT_QUOTA: {getByName(name) {
      reservations.push(name);
      throw new Error('The chart route must not call a request counter.');
    }},
    ...options.env,
  };
  const handler = createAssistantHandler({now: () => now, fetcher: (url, init) => {
    calls.push({url, init});
    return fetcher(url, init);
  }});
  return {handler, env, calls, reservations};
}

test('uses Responses for the screenshot question and returns the existing chart contract', async () => {
  const s = setup(() => success({model: 'gpt-6.1-sol-2026-11-13'}));
  const reply = await s.handler(post('/api/chart', chartBody), s.env);
  assert.equal(reply.status, 200);
  const body = await reply.json();
  assert.equal(body.schema, 'sessionpath.assistant.chart.v1');
  assert.equal(body.model, OPENAI_CHART_MODEL);
  assert.deepEqual(body.observationContext, observation);
  assert.deepEqual(body.analysis, analysis);
  assert.equal(body.visualTags.length, 4);
  assert.deepEqual(s.reservations, []);
  assert.equal(s.calls.length, 1);
  const [{url, init}] = s.calls;
  assert.equal(url, OPENAI_CHART_ENDPOINT);
  assert.equal(init.headers.Authorization, 'Bearer test-only-credential');
  const sent = JSON.parse(init.body);
  assert.equal(sent.model, OPENAI_CHART_MODEL);
  assert.equal(sent.store, false);
  assert.equal(sent.max_output_tokens, 1800);
  assert.deepEqual(sent.reasoning, {effort: 'low'});
  assert.equal(sent.service_tier, 'default');
  assert.ok(sent.instructions.startsWith(CHART_READING_SYSTEM));
  assert.match(sent.instructions, /Answer the user's question/u);
  assert.deepEqual(sent.input, [{role: 'user', content: [
    {type: 'input_text', text: JSON.stringify({request: message, observation})},
    {type: 'input_image', image_url: RASTER_FIXTURES.jpeg, detail: 'high'},
  ]}]);
  assert.deepEqual(sent.text.format.schema, CHART_ANALYSIS_SCHEMA);
  assert.equal(sent.text.format.strict, true);
  for (const unsupported of ['temperature', 'top_p', 'models', 'provider', 'tools', 'previous_response_id']) assert.equal(sent[unsupported], undefined);
  assert.ok(!JSON.stringify(body).includes('data:image'));
  assert.ok(!JSON.stringify(body).includes(s.env.OPENAI_API_KEY));
});

test('retains the event stream and sends a single validated result', async () => {
  const s = setup();
  const reply = await s.handler(post('/api/chart', chartBody, {Accept: 'text/event-stream'}), s.env);
  assert.match(reply.headers.get('Content-Type'), /text\/event-stream/u);
  const result = await reply.text();
  assert.match(result, /^: connected/u);
  const results = [...result.matchAll(/^data: (.+)$/gmu)].map(match => JSON.parse(match[1]));
  assert.equal(results.length, 1);
  assert.equal(results[0].model, OPENAI_CHART_MODEL);
  assert.deepEqual(results[0].analysis, analysis);
  assert.equal(s.calls.length, 1);
});

test('validates images and fails closed without the configured chart model or its credentials', async () => {
  const invalidImage = setup();
  const invalid = await invalidImage.handler(post('/api/chart', {...chartBody, image: {dataUrl: 'https://example.test/image.png'}}), invalidImage.env);
  assert.equal(invalid.status, 400);
  assert.equal(invalidImage.reservations.length, 0);
  assert.equal(invalidImage.calls.length, 0);
  for (const [options, status, code] of [
    [{env: {OPENAI_CHART_MODEL: 'user-controlled-model'}}, 503, 'AI_NOT_CONFIGURED'],
    [{env: {OPENAI_API_KEY: undefined}}, 503, 'AI_NOT_CONFIGURED'],
  ]) {
    const s = setup(undefined, options);
    const response = await s.handler(post('/api/chart', chartBody), s.env);
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
    assert.equal(s.calls.length, 0);
  }
});

test('translates safe OpenAI errors, incomplete output, refusal and unsupported results without retrying or leaking provider text', async () => {
  const upstreamError = (status, code) => Response.json({error: {code, message: 'Confidential provider diagnostics.'}}, {status});
  const incomplete = reason => Response.json({status: 'incomplete', model: OPENAI_CHART_MODEL, incomplete_details: {reason}});
  for (const [factory, status, code] of [
    [() => upstreamError(401, 'invalid_api_key'), 503, 'AI_KEY_REJECTED'],
    [() => upstreamError(429, 'insufficient_quota'), 503, 'AI_CREDIT_RESTRICTED'],
    [() => upstreamError(429, 'rate_limit_exceeded'), 429, 'CHART_AI_BUSY'],
    [() => upstreamError(404, 'model_not_found'), 503, 'AI_ACCESS_RESTRICTED'],
    [() => incomplete('max_output_tokens'), 503, 'CHART_AI_OUTPUT_LIMIT'],
    [() => incomplete('content_filter'), 422, 'CHART_AI_IMAGE_UNAVAILABLE'],
    [() => success({content: [{type: 'refusal', refusal: 'Confidential provider diagnostics.'}]}), 422, 'CHART_AI_IMAGE_UNAVAILABLE'],
    [() => success({model: 'unexpected-provider-model'}), 503, 'INVALID_CHART_RESPONSE'],
    [() => success({content: [{type: 'output_text', text: JSON.stringify({...analysis, summary: 'Buy now with a stop-loss.'})}]}), 503, 'INVALID_CHART_RESPONSE'],
  ]) {
    const s = setup(factory);
    const response = await s.handler(post('/api/chart', chartBody), s.env);
    assert.equal(response.status, status);
    const result = await response.json();
    assert.equal(result.error.code, code);
    assert.doesNotMatch(result.error.message, /Confidential provider diagnostics/u);
    assert.equal(s.calls.length, 1);
    assert.equal(s.reservations.length, 0);
  }
});

test('health reports the active chart provider while ordinary text uses the legacy OpenRouter path', async () => {
  const s = setup((url, init) => {
    assert.equal(url, OPENROUTER_URL);
    assert.equal(JSON.parse(init.body).model, FREE_MODEL);
    const intent = {action: 'clarify', ...context, concept: null};
    return Response.json({model: FREE_MODEL, choices: [{finish_reason: 'stop', message: {content: JSON.stringify(intent)}}]});
  });
  const health = await (await s.handler(new Request('https://assistant.test/health'), s.env)).json();
  assert.equal(health.chartProvider, 'openai');
  assert.equal(health.chartModel, OPENAI_CHART_MODEL);
  assert.equal(health.appRequestCountLimits, false);
  const reply = await s.handler(post('/api/chat', {context, message: 'Could you help me make sense of this?'}), s.env);
  assert.equal(reply.status, 200);
  assert.equal(s.calls.length, 1);
  assert.equal(s.reservations.length, 0);
});
