import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';

const scriptPath = fileURLToPath(new URL('../worker.bundle.mjs', import.meta.url));
function runtime(persistence) {
  // Existing bundled Miniflare supports dates through 2026-08-06. Production
  // retains today's 2026-11-04 date in deploy-metadata.json; no new runtime APIs
  // are required here, and the deployed endpoint must also receive smoke tests.
  return new Miniflare({modules: true, scriptPath, compatibilityDate: '2026-08-06',
    durableObjects: {ASSISTANT_QUOTA: {className: 'AssistantQuota', useSQLite: true}},
    durableObjectsPersist: persistence,
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
