import {readFile, writeFile} from 'node:fs/promises';
import {buildChartShapeArchive} from './build-chart-shape-archive.mjs';
const parts = [];
for (const file of ['../../docs/chart-day-review-knowledge.mjs', '../../docs/chart-reading-reference.mjs', 'intent.mjs', 'quota.mjs', 'chart-shape-archive.mjs', 'chart-vision.mjs', 'router.mjs', 'worker.mjs']) {
  let source = await readFile(new URL(file, import.meta.url), 'utf8');
  if (file === 'chart-shape-archive.mjs') {
    const archive = await buildChartShapeArchive();
    const tags = [null,'DOWN_FINISH','DOWN_THEN_BOUNCE','DROP_RECOVERY','UP_FINISH','UP_THEN_PULLBACK','RALLY_FADE','NARROW','ORDER_UNRESOLVED'];
    const encoded = Object.fromEntries(Object.entries(archive).map(([key,row])=>[key,[...row.slice(0,3),row.slice(3).map(tag=>tags.indexOf(tag)).join('')]]));
    source = source.replace('const CHART_SHAPE_ARCHIVE = {};', `const CHART_SHAPE_ARCHIVE = ${JSON.stringify(encoded)};`);
  }
  source = source.replace(/^import .* from ['"]\.\.?\/.*['"];\r?\n/gm, '');
  if (file !== 'worker.mjs') source = source.replace(/^export /gm, '');
  parts.push(`// ${file}\n${source}`);
}
await writeFile(new URL('worker.bundle.mjs', import.meta.url), parts.join('\n'));
console.log('Built SessionPath assistant Worker (no secrets).');
