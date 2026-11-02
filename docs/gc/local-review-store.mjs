import {appendReview,validateContext} from './local-import-core.mjs';
import {storageKey} from './instrument.mjs';

export const REVIEW_KEY=storageKey('sessionpath-local-reviews-v1');
const LOCK_NAME=REVIEW_KEY+'-write';
const conflict=()=>Object.assign(Error('Reviews changed in another tab. Reload the review and confirm your selection again.'),{code:'REVIEW_CONFLICT'});
export function readReviewSnapshot(storage){
  const raw=storage.getItem(REVIEW_KEY);let reviews;
  try{reviews=JSON.parse(raw??'[]');}catch{throw Error('Saved review store is unreadable; no changes were made.');}
  if(!Array.isArray(reviews)||reviews.some(r=>!r||typeof r.record_id!=='string'||!Array.isArray(r.selected)))throw Error('Saved review store is invalid; no changes were made.');
  for(const review of reviews)validateContext(review.context);
  if(new Set(reviews.map(r=>r.record_id)).size!==reviews.length)throw Error('Saved review store has duplicate identities; no changes were made.');
  return {raw,reviews};
}
export async function saveReview({storage,locks,review,expectedRaw,isCurrent=()=>true}){
  validateContext(review.context);
  // Web Locks serialize cooperating tabs on this origin. Without them, fail closed.
  if(typeof locks?.request!=='function')throw Error('This browser cannot coordinate review saves safely. Use a browser with Web Locks support on HTTPS or localhost.');
  return locks.request(LOCK_NAME,{mode:'exclusive'},()=>{
    if(!isCurrent())throw Error('The form or session changed while waiting to save. Review again.');
    const snapshot=readReviewSnapshot(storage);
    if(snapshot.raw!==expectedRaw)throw conflict();
    const prior=snapshot.reviews.find(r=>r.record_id===review.record_id);
    if(prior){
      if(JSON.stringify(prior.selected)!==JSON.stringify(review.selected))throw Error('This record already has a different approval; original review retained.');
      return {review:prior,raw:snapshot.raw,reused:true};
    }
    const nextRaw=JSON.stringify(appendReview(snapshot.reviews,review));
    storage.setItem(REVIEW_KEY,nextRaw);
    // Detect noncooperating writers when possible; never roll back over their data.
    if(storage.getItem(REVIEW_KEY)!==nextRaw)throw conflict();
    return {review,raw:nextRaw,reused:false};
  });
}
