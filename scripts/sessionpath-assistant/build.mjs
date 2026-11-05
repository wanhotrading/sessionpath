import {readFile, writeFile} from 'node:fs/promises';
const parts = [];
for (const file of ['../../docs/chart-reading-reference.mjs', 'intent.mjs', 'quota.mjs', 'chart-vision.mjs', 'router.mjs', 'worker.mjs']) {
  let source = await readFile(new URL(file, import.meta.url), 'utf8');
  source = source.replace(/^import .* from ['"]\.\.?\/.*['"];\r?\n/gm, '');
  if (file !== 'worker.mjs') source = source.replace(/^export /gm, '');
  parts.push(`// ${file}\n${source}`);
}
await writeFile(new URL('worker.bundle.mjs', import.meta.url), parts.join('\n'));
console.log('Built SessionPath assistant Worker (no secrets).');
