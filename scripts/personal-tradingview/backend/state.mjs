import {DECISION_OPEN_TIMING} from './validation.mjs';

function enrichesSameObservation(current,incoming){
  if (incoming.observedMs !== current.observedMs || incoming.packet.session_date !== current.packet.session_date || incoming.packet.checkpoint_timing !== DECISION_OPEN_TIMING) return false;
  const boundary = incoming.packet.snapshots.at(-1);
  return boundary?.as_of === incoming.packet.observed_at && !Object.hasOwn(current.snapshotHashes,boundary.cutoff);
}

export function decideFeedUpdate(current,incoming){
  // A historical-feed correction must not stop a fresh transport heartbeat.
  // Snapshot immutability is enforced by retaining first-accepted values below.
  if(current&&incoming.observedMs<=current.observedMs&&!enrichesSameObservation(current,incoming))return {status:incoming.packetHash===current.packetHash||incoming.packetHash===current.reconciliation?.sourcePacketHash?'duplicate':'ignored'};
  if(current&&incoming.packet.session_date<current.packet.session_date)return {status:'ignored'};
  return {status:'accepted'};
}
const frozenCutoffs=['03:00','05:00','08:30'];
async function stateHash(value){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function initialProvenance(entry,cutoff,basis){
  return {sourceObservedAt:entry.packet.observed_at,receivedAt:entry.receivedAt,sourcePacketHash:entry.reconciliation?.sourcePacketHash??entry.packetHash,snapshotHash:entry.snapshotHashes[cutoff],basis};
}
export async function reconcileFrozenCheckpoints(current,incoming){
  const sameDay=current?.packet.session_date===incoming.packet.session_date;
  const prior=new Map((sameDay?current.packet.snapshots:[]).map(snapshot=>[snapshot.cutoff,snapshot]));
  const supplied=new Map(incoming.packet.snapshots.map(snapshot=>[snapshot.cutoff,snapshot]));
  const snapshots=[],snapshotHashes={},checkpointProvenance={},retainedCutoffs=[],revisedCutoffs=[],missingCutoffs=[],addedCutoffs=[],changedFields={};
  for(const cutoff of frozenCutoffs){
    const original=prior.get(cutoff),candidate=supplied.get(cutoff);
    if(original){
      snapshots.push(original);snapshotHashes[cutoff]=current.snapshotHashes[cutoff];retainedCutoffs.push(cutoff);
      checkpointProvenance[cutoff]=current.checkpointProvenance?.[cutoff]??initialProvenance(current,cutoff,'legacy-receipt');
      if(!candidate)missingCutoffs.push(cutoff);
      else if(incoming.snapshotHashes[cutoff]!==current.snapshotHashes[cutoff]){
        revisedCutoffs.push(cutoff);
        changedFields[cutoff]=Object.keys(original).filter(key=>JSON.stringify(original[key])!==JSON.stringify(candidate[key]));
      }
    }else if(candidate){
      // The caller independently validated this fresh publisher packet before
      // storage. The first verified value for a NEW decision is kept verbatim,
      // including source corrections; never fabricate an older baseline into it.
      snapshots.push(candidate);snapshotHashes[cutoff]=incoming.snapshotHashes[cutoff];addedCutoffs.push(cutoff);
      checkpointProvenance[cutoff]=initialProvenance(incoming,cutoff,'first-received');
    }
  }
  // A legacy heartbeat can arrive just before the exact-open packet at the
  // same boundary. Retain its transport and add only verified frozen values.
  const sameObservation = current && enrichesSameObservation(current,incoming);
  const packet = sameObservation
    ? {...current.packet,checkpoint_timing:DECISION_OPEN_TIMING,snapshots}
    : {...incoming.packet,snapshots};
  const reconciliation={schema:'sessionpath.tradingview.reconciliation.v1',policy:'first-accepted-per-checkpoint',status:revisedCutoffs.length||missingCutoffs.length?'preserved_frozen':'aligned',sourceObservedAt:incoming.packet.observed_at,sourcePacketHash:incoming.packetHash,retainedCutoffs,revisedCutoffs,missingCutoffs,addedCutoffs,changedFields};
  // The composite can contain first-accepted checkpoints from different source
  // revisions. Its own hash must describe the stored packet, not a rejected
  // replacement; per-cutoff provenance identifies each authenticated source.
  const packetHash=JSON.stringify(packet)===JSON.stringify(incoming.packet)?incoming.packetHash:await stateHash(packet);
  const transport = sameObservation ? current : incoming;
  return {...transport,packet,packetHash,snapshotHashes,checkpointProvenance,reconciliation};
}
// SQLite-backed Durable Objects also expose the transactional KV storage API.
// Keep frozen daily inputs separately from the live heartbeat. Neither record
// contains a token; unchanged five-minute heartbeats do not rewrite history.
export const MAX_HISTORY_DATES=1024;
export class PersonalFeedStore {
  constructor(storage,{historyLimit=MAX_HISTORY_DATES}={}){this.storage=storage;this.historyLimit=historyLimit;}
  async getLatest(){return (await this.storage.get('latest'))??null;}
  async getHistory(date){
    const saved=await this.storage.get('history:'+date);
    if(saved)return saved;
    const latest=await this.getLatest();
    return latest?.packet.session_date===date&&latest.packet.snapshots.length?latest:null;
  }
  async archive(tx,entry){
    if(!entry?.packet.snapshots.length)return;
    const date=entry.packet.session_date,key='history:'+date,prior=await tx.get(key);
    if(prior&&JSON.stringify(prior.snapshotHashes)===JSON.stringify(entry.snapshotHashes))return;
    if(prior&&decideFeedUpdate(prior,entry).status!=='accepted')return;
    await tx.put(key,entry);
    if(prior)return;
    const dates=[...new Set([...(await tx.get('history-dates')??[]),date])].sort();
    while(dates.length>this.historyLimit)await tx.delete('history:'+dates.shift());
    await tx.put('history-dates',dates);
  }
  async accept(incoming){return this.storage.transaction(async tx=>{
    const current=await tx.get('latest'),result=decideFeedUpdate(current,incoming);
    if(result.status==='accepted'){
      const reconciled=await reconcileFrozenCheckpoints(current,incoming);
      // Upgrade old deployments lazily: save their last complete day before
      // the next session replaces it, even when the new packet is a heartbeat.
      await this.archive(tx,current);await this.archive(tx,reconciled);
      await tx.put('latest',reconciled);
    }
    return result;
  });}
}

