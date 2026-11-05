import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
import {RASTER_FIXTURES} from './chart-fixtures.mjs';

const scriptPath = fileURLToPath(new URL('../worker.bundle.mjs', import.meta.url));
function runtime(persistence, extras = {}) {
  // Existing bundled Miniflare supports dates through 2026-08-06. Production
  // retains today's 2026-11-04 date in deploy-metadata.json; no new runtime APIs
  // are required here, and the deployed endpoint must also receive smoke tests.
  return new Miniflare({modules: true, scriptPath, compatibilityDate: '2026-08-06',
    durableObjects: {ASSISTANT_QUOTA: {className: 'AssistantQuota', useSQLite: true}},
    durableObjectsPersist: persistence,
    ...extras,
  });
}

test('real Workers runtime exports DO RPC, serializes concurrent quota reservations and retains budget after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sessionpath-assistant-test-'));
  let mf;
  try {
    mf = runtime(directory);
    const health = await mf.dispatchFetch('https://assistant.test/health');
    assert.equal(health.status, 200); assert.equal((await health.json()).freeModelsOnly, true);
    const exact = await mf.dispatchFetch('https://assistant.test/api/chat', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({message: 'CL 03-05 range', context: {market: 'GC', window: '08:30-16:00'}})});
    assert.equal(exact.status, 200); assert.equal((await exact.json()).market, 'CL');
    const dated = await mf.dispatchFetch('https://assistant.test/api/chat', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({message: 'Can you fetch CL 03-05 code of February 29th, 2024?', context: {market: 'GC', window: '08:30-16:00', date: null}})});
    assert.equal(dated.status, 200);
    const datedBody = await dated.json();
    assert.equal(datedBody.date, '2024-02-29'); assert.equal(datedBody.action, 'forecast'); assert.equal(datedBody.interpreter, 'rules');
    let namespace = await mf.getDurableObjectNamespace('ASSISTANT_QUOTA');
    let stub = namespace.get(namespace.idFromName('global-free-ai-v1'));
    const results = await Promise.all(Array.from({length: 20}, () => stub.reserve({ip: '192.0.2.4'})));
    assert.equal(results.filter(result => result.allowed).length, 5);
    const manyClients = await Promise.all(Array.from({length: 45}, (_, i) => stub.reserve({ip: `192.0.2.${i + 20}`})));
    assert.equal(manyClients.filter(result => result.allowed).length, 35);
    await mf.dispose(); mf = null;
    mf = runtime(directory);
    namespace = await mf.getDurableObjectNamespace('ASSISTANT_QUOTA');
    stub = namespace.get(namespace.idFromName('global-free-ai-v1'));
    assert.equal((await stub.reserve({ip: '198.51.100.200'})).allowed, false);
  } finally {
    if (mf) await mf.dispose();
    await rm(directory, {recursive: true, force: true});
  }
});

test('real chart and text HTTP routes share one persistent quota and use actual image_url multipart requests', async () => {
  let upstreamCalls = 0;
  const result = {summary: 'The visible chart is not readable.', sequence: ['No candle path can be established.'], bbox: 'No readable BBOX boundaries.', sessionpath: 'No readable SessionPath boundaries.', uncertainties: ['Readable candles and time labels are needed.']};
  const mf = runtime(undefined, {bindings: {OPENROUTER_API_KEY: 'dummy-runtime-key'}, outboundService: async request => {
    upstreamCalls++;
    assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
    const body = await request.json();
    assert.equal(body.model, 'nvidia/nemotron-3.5-super-vl:free');
    let content;
    if (Array.isArray(body.messages[1].content)) {
      assert.equal(body.messages[1].content[1].type, 'image_url');
      assert.equal(body.messages[1].content[1].image_url.url, RASTER_FIXTURES.jpeg);
      content = result;
    } else content = {action: 'explain', market: 'CL', window: '03:00-05:00', concept: 'mean_box', date: null};
    return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(content)}}]});
  }});
  const headers = {'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.8', Origin: 'https://wanhotrading.github.io'};
  const context = {market: 'CL', window: '03:00-05:00', date: null};
  const chart = () => mf.dispatchFetch('https://assistant.test/api/chart', {method: 'POST', headers, body: JSON.stringify({message: '', context, image: {dataUrl: RASTER_FIXTURES.jpeg}})});
  try {
    const first = await chart(); assert.equal(first.status, 200);
    const body = await first.json(); assert.equal(body.schema, 'sessionpath.assistant.chart.v1'); assert.deepEqual(body.analysis, result);
    const text = await mf.dispatchFetch('https://assistant.test/api/chat', {method: 'POST', headers, body: JSON.stringify({message: 'Explain the mean box, please.', context})});
    assert.equal(text.status, 200); assert.equal((await text.json()).interpreter, 'openrouter');
    for (let i = 0; i < 3; i++) assert.equal((await chart()).status, 200);
    const blocked = await chart(); assert.equal(blocked.status, 429); assert.equal((await blocked.json()).error.code, 'FREE_USAGE_LIMIT');
    assert.equal(upstreamCalls, 5);
  } finally {await mf.dispose();}
});
