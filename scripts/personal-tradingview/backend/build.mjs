import {readFile,writeFile} from 'node:fs/promises';
const pieces=[];
for(const file of ['../../../docs/prior-ny-coverage.mjs','recovery.mjs','validation.mjs','state.mjs','overnight-timing.mjs','router.mjs','worker.mjs']){
  let source=await readFile(new URL(file,import.meta.url),'utf8');
  source=source.replace(/^import .* from ['"]\.{1,2}\/.*['"];\r?\n/gm,'');
  if(file!=='worker.mjs')source=source.replace(/^export /gm,'');
  pieces.push('// '+file+'\n'+source);
}
await writeFile(new URL('worker.bundle.mjs',import.meta.url),pieces.join('\n'));
console.log('Built worker.bundle.mjs (no secrets).');

