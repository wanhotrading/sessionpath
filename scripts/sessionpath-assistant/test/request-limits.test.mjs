import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssistantHandler, ASSISTANT_ORIGIN, FREE_MODEL} from '../router.mjs';
import {CHART_MODEL} from '../chart-vision.mjs';
import {RASTER_FIXTURES} from './chart-fixtures.mjs';

const NOW = Date.parse('2026-11-08T15:00:00Z');
const context = {market: 'CL', window: '03:00-05:00', date: null};
const intent = {action: 'clarify', ...context, concept: null};
const analysis = {
  summary: 'Visible price initially rises and later retraces.',
  sequence: ['The first candles rise.', 'The later candles retrace.'],
  bbox: 'The prior BBOX labels are not legible.',
  sessionpath: 'A red and green box is visible.',
  uncertainties: ['The exact boundaries cannot be read.'],
};
const keyEnv = {OPENROUTER_API_KEY: 'dummy-test-only-key'};
const paths = ['/api/chat', '/api/chart'];
const payload = path => path === '/api/chart'
  ? {context, image: {dataUrl: RASTER_FIXTURES.png}}
  : {context, message: 'Could you help me make sense of this?'};

function post(path, {ip = '192.0.2.19', origin = ASSISTANT_ORIGIN, body = JSON.stringify(payload(path)), contentType = 'application/json'} = {}) {
  return new Request('https://assistant.test' + path, {
    method: 'POST',
    headers: {'Content-Type': contentType, Origin: origin, ...(ip === null ? {} : {'CF-Connecting-IP': ip})},
    body,
  });
}

function success(_url, init) {
  const sent = JSON.parse(init.body);
  assert.ok([FREE_MODEL, CHART_MODEL].includes(sent.model));
  return Response.json({
    model: sent.model,
    choices: [{finish_reason: 'stop', message: {content: JSON.stringify(sent.model === CHART_MODEL ? analysis : intent)}}],
  });
}

test('one client exceeds the old global, daily and burst request counts without using the legacy quota', async () => {
  let quotaCalls = 0, chatCalls = 0, chartCalls = 0;
  const env = {...keyEnv, ASSISTANT_QUOTA: {getByName() {
    quotaCalls++;
    return {reserve: async () => ({allowed: false, retryAfter: 86_400})};
  }}};
  const handler = createAssistantHandler({now: () => NOW, fetcher: (...args) => {
    if (JSON.parse(args[1].body).model === CHART_MODEL) chartCalls++;
    else chatCalls++;
    return success(...args);
  }});
  // Every request has the same address and timestamp, exceeding the former
  // 40 global/day, 10 client/day and 5 client/10-minute thresholds.
  for (const [path, count] of [['/api/chat', 41], ['/api/chart', 11]]) {
    for (let i = 0; i < count; i++) {
      const response = await handler(post(path), env);
      assert.equal(response.status, 200, `${path} request ${i + 1}`);
      assert.equal(response.headers.get('Retry-After'), null);
      assert.equal((await response.json()).ok, true);
    }
  }
  assert.equal(chatCalls, 41);
  assert.equal(chartCalls, 11);
  assert.equal(quotaCalls, 0);
});

test('both AI routes work without a quota binding or a trusted client address', async () => {
  let calls = 0;
  const handler = createAssistantHandler({now: () => NOW, fetcher: (...args) => {calls++; return success(...args);}});
  for (const path of paths) {
    for (const ip of [null, 'x'.repeat(65)]) {
      const response = await handler(post(path, {ip}), keyEnv);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);
    }
  }
  assert.equal(calls, 4);
});

test('a failing legacy quota service cannot block either AI route', async () => {
  let quotaCalls = 0, calls = 0;
  const env = {...keyEnv, ASSISTANT_QUOTA: {getByName() {
    quotaCalls++;
    throw new Error('Legacy quota unavailable');
  }}};
  const handler = createAssistantHandler({now: () => NOW, fetcher: (...args) => {calls++; return success(...args);}});
  const responses = await Promise.all(Array.from({length: 6}, (_, i) => handler(post(paths[i % 2]), env)));
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
  }
  assert.equal(calls, 6);
  assert.equal(quotaCalls, 0);
});

test('missing API credentials still block both AI routes before any provider call', async () => {
  let calls = 0;
  const handler = createAssistantHandler({now: () => NOW, fetcher: () => {calls++; throw new Error('Unexpected provider request');}});
  for (const path of paths) {
    const response = await handler(post(path, {ip: null}), {});
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'AI_NOT_CONFIGURED');
  }
  assert.equal(calls, 0);
});

test('health reports that application request counts are disabled without a provider call', async () => {
  let calls = 0;
  const handler = createAssistantHandler({fetcher: () => {calls++; throw new Error('Health must remain local');}});
  const response = await handler(new Request('https://assistant.test/health'), {});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).appRequestCountLimits, false);
  assert.equal(calls, 0);
});

test('removing request counts preserves origin, JSON and body validation before upstream', async () => {
  let calls = 0;
  const handler = createAssistantHandler({now: () => NOW, fetcher: () => {calls++; throw new Error('Unexpected provider request');}});
  for (const path of paths) {
    for (const [options, status, code] of [
      [{origin: 'https://untrusted.example'}, 403, 'ORIGIN_NOT_ALLOWED'],
      [{contentType: 'text/plain'}, 415, 'JSON_REQUIRED'],
      [{body: '{'}, 400, 'INVALID_REQUEST'],
      [{body: '{}'}, 400, path === '/api/chart' ? 'INVALID_CHART_REQUEST' : 'INVALID_REQUEST'],
    ]) {
      const response = await handler(post(path, options), keyEnv);
      assert.equal(response.status, status);
      assert.equal((await response.json()).error.code, code);
    }
  }
  assert.equal(calls, 0);
});

test('provider rate and credit restrictions remain provider errors with no retry', async () => {
  for (const path of paths) {
    for (const [status, expectedStatus, code] of [[429, 429, 'FREE_MODEL_BUSY'], [402, 503, 'AI_CREDIT_RESTRICTED']]) {
      let calls = 0;
      const handler = createAssistantHandler({now: () => NOW, fetcher: async () => {
        calls++;
        return Response.json({error: {message: 'private-provider-detail'}}, {status});
      }});
      const response = await handler(post(path, {ip: null}), keyEnv);
      assert.equal(response.status, expectedStatus);
      assert.equal(response.headers.get('Retry-After'), status === 429 ? '60' : null);
      const body = await response.json();
      assert.equal(body.error.code, code);
      assert.doesNotMatch(JSON.stringify(body), /private-provider-detail|dummy-test-only-key/);
      assert.equal(calls, 1);
    }
  }
});
