// Run on the Grok Bot computer. Only the public key leaves the bot during pairing.
import {generateKeyPairSync,createPublicKey,sign} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=path.join(os.homedir(),'.sessionpath-news');
const file=path.join(dir,'sender.pem');
const endpoint='https://sessionpath-grok-news.jjj-jason2345.workers.dev';
function localKey(){
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  if(!fs.existsSync(file)){
    const {privateKey}=generateKeyPairSync('ed25519');
    fs.writeFileSync(file,privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600,flag:'wx'});
  }
  return fs.readFileSync(file);
}
const encodeKey=key=>createPublicKey(key).export({format:'der',type:'spki'}).toString('base64');
if(process.argv[2]==='pair'){
  console.log(encodeKey(localKey()));
} else if(process.argv[2]==='enroll'){
  const token=fs.readFileSync(0,'utf8').trim();
  if(!/^[a-f0-9]{64}$/.test(token))throw Error('A valid one-time pairing code is required.');
  const key=localKey(),publicKey=encodeKey(key);
  const signature=sign(null,Buffer.from('sessionpath-news-pair:'+publicKey),key).toString('base64');
  const response=await fetch(endpoint+'/pair',{method:'POST',headers:{
    Authorization:'Bearer '+token,'X-SessionPath-Public-Key':publicKey,'X-SessionPath-Signature':signature
  }});
  console.log(response.status,await response.text());if(!response.ok)process.exitCode=1;
} else if(process.argv[2]==='send'){
  const {events,citations}=JSON.parse(fs.readFileSync(0,'utf8'));
  if(!Array.isArray(events)||!Array.isArray(citations))throw Error('Supply events and citations arrays');
  const body=JSON.stringify({sentAt:Date.now(),events,citations});
  const signature=sign(null,Buffer.from(body),fs.readFileSync(file)).toString('base64');
  const response=await fetch(endpoint+'/submit',{
    method:'POST',headers:{'Content-Type':'application/json','X-SessionPath-Signature':signature},body
  });
  console.log(response.status,await response.text());if(!response.ok)process.exitCode=1;
} else throw Error('Choose enroll, pair or send');
