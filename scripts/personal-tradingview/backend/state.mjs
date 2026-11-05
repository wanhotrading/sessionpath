export function decideFeedUpdate(current,incoming){
  if(current&&incoming.packet.session_date===current.packet.session_date){
    for(const [cutoff,hash] of Object.entries(current.snapshotHashes))if(incoming.snapshotHashes[cutoff]!==hash)return {status:'conflict',code:'IMMUTABLE_SNAPSHOT'};
  }
  if(current&&incoming.observedMs<=current.observedMs)return {status:incoming.packetHash===current.packetHash?'duplicate':'ignored'};
  if(current&&incoming.packet.session_date<current.packet.session_date)return {status:'ignored'};
  return {status:'accepted'};
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
      // Upgrade old deployments lazily: save their last complete day before
      // the next session replaces it, even when the new packet is a heartbeat.
      await this.archive(tx,current);await this.archive(tx,incoming);
      await tx.put('latest',incoming);
    }
    return result;
  });}
}
