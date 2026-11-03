export function decideFeedUpdate(current,incoming){
  if(current&&incoming.packet.session_date===current.packet.session_date){
    for(const [cutoff,hash] of Object.entries(current.snapshotHashes))if(incoming.snapshotHashes[cutoff]!==hash)return {status:'conflict',code:'IMMUTABLE_SNAPSHOT'};
  }
  if(current&&incoming.observedMs<=current.observedMs)return {status:incoming.packetHash===current.packetHash?'duplicate':'ignored'};
  if(current&&incoming.packet.session_date<current.packet.session_date)return {status:'ignored'};
  return {status:'accepted'};
}
// SQLite-backed Durable Objects also expose the transactional KV storage API.
// Only one latest receipt per market is retained, with no history or token.
export class PersonalFeedStore {
  constructor(storage){this.storage=storage;}
  async getLatest(){return (await this.storage.get('latest'))??null;}
  async accept(incoming){return this.storage.transaction(async tx=>{const result=decideFeedUpdate(await tx.get('latest'),incoming);if(result.status==='accepted')await tx.put('latest',incoming);return result;});}
}
