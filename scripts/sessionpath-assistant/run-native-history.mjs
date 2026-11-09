import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {buildNativeHistory} from './build-native-history.mjs';

// Source identity and its path belong to the manifest. The runner supplies no
// implicit market, date range, source file or output destination.
const args=process.argv.slice(2);
if(args.length!==3)throw Error('Usage: node run-native-history.mjs <manifest.json> <output.json> <audit.json>');
const [manifestPath,output,auditOutput]=args.map(path=>resolve(path));
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
if(typeof manifest.csv_path!=='string'||!manifest.csv_path.trim())throw Error('The source manifest must provide csv_path.');
const sourcePath=resolve(dirname(manifestPath),manifest.csv_path);
if(new Set([manifestPath,sourcePath,output,auditOutput]).size!==4)throw Error('Source, manifest, output and audit paths must be distinct.');
const bytes=await readFile(sourcePath);
const {asset,audit}=buildNativeHistory(bytes,manifest);
await mkdir(dirname(output),{recursive:true});await mkdir(dirname(auditOutput),{recursive:true});
await writeFile(output,JSON.stringify(asset,null,2)+'\n');await writeFile(auditOutput,JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify({source:manifest.source_symbol,...audit.summary,sourceSHA256:manifest.sha256,output,auditOutput,apiCostUSD:0}));
