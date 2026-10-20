/** Decoration only; formatted values and research calculations stay unchanged. */
export function probabilityMarkup(formatted) {
 const text=String(formatted??'—');
 return /^\d+(?:\.\d+)?%$/.test(text)?`<span class="probability-value">${text}</span>`:text;
}

if(typeof document!=='undefined'){
 const selector='.probability-value,.probability-row b,.br-bars b';
 const visibility=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
  for(const entry of entries)entry.target.classList.toggle('probability-visible',entry.isIntersecting);
 },{threshold:0}):null;
 const seen=new WeakSet();
 const elements=root=>root.nodeType===1?[...(root.matches(selector)?[root]:[]),...root.querySelectorAll(selector)]:[];
 const add=root=>{for(const node of elements(root)){
  if(seen.has(node)||node.querySelector('.probability-value'))continue;
  seen.add(node);node.classList.add('probability-value');visibility?.observe(node);
 }};
 const start=()=>{
  add(document.body);
  new MutationObserver(records=>{for(const record of records){
   for(const node of record.removedNodes)for(const el of elements(node))if(!el.isConnected)visibility?.unobserve(el);
   for(const node of record.addedNodes)add(node);
  }}).observe(document.body,{childList:true,subtree:true});
 };
 if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
}
