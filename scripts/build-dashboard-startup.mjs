import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { transformPrices } from '../docs/dashboard-data.mjs';

const root = path.resolve(process.argv[2] || 'docs');
const output = path.join(root, 'startup-data');
await mkdir(output, { recursive: true });
const markets = {};
for (const [market, dir, tick] of [
  ['CL','data',1], ['NQ','data/nq',25], ['ES','es/data/es',25], ['GC','gc/data/gc',10],
]) {
  const [days,tags,timeline,extra] = await Promise.all(['days','tags','timeline','planner-extra'].map(async file =>
    JSON.parse(await readFile(path.join(root,dir,file+'.json'),'utf8'))));
  const rawRows = Array.isArray(timeline) ? timeline : timeline.rows;
  const { rows: ignored, ...meta } = Array.isArray(timeline) ? {} : timeline;
  const files = [];
  async function emit(data) {
    const compressed = gzipSync(JSON.stringify(data), { level: 9 });
    const hash = createHash('sha256').update(compressed).digest('hex').slice(0,24);
    const filename = market+'-'+hash+'.bin';
    await writeFile(path.join(output,filename),compressed);
    files.push(filename);
    return JSON.parse(gunzipSync(compressed).toString());
  }
  const core = { days, tags, extra, timelineMeta: Array.isArray(timeline) ? null : meta };
  assert.deepEqual(await emit(core),core);
  for (let i = 0; i < rawRows.length; i += 180) {
    const source = rawRows.slice(i, i+180);
    const encoded = transformPrices(structuredClone(source),tick,false);
    assert.deepEqual(transformPrices(await emit(encoded),tick,true), source);
  }
  markets[market] = {tick, rows:rawRows.length, files};
}
for (const [page, pageMarket] of [['index.html','CL'],['es/index.html','ES'],['gc/index.html','GC']]) {
  const filename = path.join(root,page);
  let html = await readFile(filename,'utf8');
  const base = pageMarket === 'CL' ? './' : '../';
  const marker = '<!-- sessionpath-startup-data -->';
  assert(html.includes(marker), page+' is missing the startup data slot');
  const version = html.match(/rel="modulepreload" href="\.\/app-v5\.js(\?v=[^"]+)"/)?.[1];
  assert(version, 'Dashboard module preload missing');
  const apps = Object.fromEntries(Object.keys(markets).map(m => [
    m, '../'+({ES:'es/',GC:'gc/'}[m] || '')+'app-v5.js'+version,
  ]));
  const config = JSON.stringify({root:base+'startup-data/',markets,apps});
  const head = '<script>window.sessionPathStartup='+config+';{const m=new URL(location.href).searchParams.get("instrument")||"'+pageMarket+'";if('+ (pageMarket==='CL'?'["NQ","CL"].includes(m)':'m==="'+pageMarket+'"') +')import("'+base+'dashboard-data.mjs?v=fast-switch-1").then(x=>x.warmDashboard(m)).catch(()=>{});}</script>';
  html = html.replace(marker, head);
  await writeFile(filename,html);
}
