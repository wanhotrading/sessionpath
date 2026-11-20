// Run on the Grok Bot computer. Only the public key leaves the bot during pairing.
import {generateKeyPairSync,createPublicKey,sign} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=path.join(os.homedir(),'.sessionpath-news');
const file=path.join(dir,'sender.pem');
if(process.argv[2]==='pair'){
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  if(!fs.existsSync(file)){
    const {privateKey}=generateKeyPairSync('ed25519');
    fs.writeFileSync(file,privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600,flag:'wx'});
  }
  console.log(createPublicKey(fs.readFileSync(file)).export({format:'der',type:'spki'}).toString('base64'));
} else if(process.argv[2]==='send'){
  const {events,citations}=JSON.parse(fs.readFileSync(0,'utf8'));
  if(!Array.isArray(events)||!Array.isArray(citations))throw Error('Supply events and citations arrays');
  const body=JSON.stringify({sentAt:Date.now(),events,citations});
  const signature=sign(null,Buffer.from(body),fs.readFileSync(file)).toString('base64');
  const response=await fetch('https://sessionpath-grok-news.jjj-jason2345.workers.dev/submit',{
    method:'POST',headers:{'Content-Type':'application/json','X-SessionPath-Signature':signature},body
  });
  console.log(response.status,await response.text());if(!response.ok)process.exitCode=1;
} else throw Error('Choose pair or send');
