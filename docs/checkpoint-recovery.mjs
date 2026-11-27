// One recovery cycle refreshes the live feed and the dated lookup for this market.
export function createCheckpointRecovery({notify, now=Date.now}) {
  let attempts=0, next=0;
  return {
    success(){attempts=0;next=0;},
    missing(){
      const t=now();
      if(t>=next){
        const wait=[5000,15000,30000,60000][Math.min(attempts++,3)];
        next=t+wait;
        notify();
      }
      return Math.max(1000,next-t);
    }
  };
}
