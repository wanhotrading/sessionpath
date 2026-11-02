// Dedicated CL NY history; the main overnight matching engine stays unchanged.
export function validateCLNYHistory(history){
 const fail=()=>{throw Error('The CL NY research reference could not be verified.');};
 if(history?.schema!=='sessionpath.ny-reference-cl-history.v1'||history.instrument!=='CL'||!history.rows)fail();
 for(const basis of ['own','bbox'])for(const end of [630,960]){
  const rows=history.rows[basis+':'+end];
  if(!Array.isArray(rows)||!rows.length)fail();
  const dates=new Set();
  for(const item of rows){
   const day=item?.day,row=item?.row;
   if(!/^\d{4}-\d{2}-\d{2}$/.test(day?.date??'')||day.year!==Number(day.date.slice(0,4))||!Number.isInteger(day.index)||!Array.isArray(day.phaseTags)||!day.phaseTags.every(x=>typeof x==='string')||dates.has(day.date))fail();
   if(!['BELOW','Q1','Q2','Q3','Q4','ABOVE'].includes(item.asia)||!['BELOW','Q1','Q2','Q3','Q4','ABOVE'].includes(item.london)||typeof item.shape!=='string'||!day.phaseTags.includes('NY:'+item.shape))fail();
   if(!['nextHighAvr','nextLowAvr','extensionUpAvr','extensionDownAvr'].every(key=>Number.isFinite(row?.[key]))||row.nextHighAvr<0||row.nextLowAvr>0||row.extensionUpAvr<0||row.extensionDownAvr<0)fail();
   dates.add(day.date);
  }
 }
 return history;
}
