import {validateVisualTags} from './chart-visual-contract.mjs?v=visual-reading-20261108';

const sessionNames=Object.freeze({NTA:'NTA · NY to Asia',ASIA:'Asia',LONDON:'London',NY:'New York'});
const tagNames=Object.freeze({DOWN_FINISH:'Down finish',DOWN_THEN_BOUNCE:'Down then bounce',DROP_RECOVERY:'Trend down, then recover',UP_FINISH:'Up finish',UP_THEN_PULLBACK:'Up then pullback',RALLY_FADE:'Trend up, then fade',NARROW:'Narrow range',ORDER_UNRESOLVED:'Order unresolved'});

// This view consumes visual candidates only. Formal classification and path
// controls remain in the chat renderer and use shapeTags exclusively.
export function createChartVisualReading(doc,body){
 const element=(tag,className,text)=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
 const section=element('section','sp-chat-visual-reading');section.setAttribute('aria-label','Visual reading');
 section.append(element('h3','sp-chat-section-title','Visual reading'),element('p','sp-chat-note','Experimental AI reading · verify prices and completed-close times against the chart.'));
 if(validateVisualTags(body.visualTags)){
  const list=element('ul','sp-chat-visual-tags');list.setAttribute('aria-label','Visual session candidates');
  for(const row of body.visualTags){
   const item=element('li','sp-chat-visual-tag');item.dataset.session=row.session;item.dataset.status=row.status;
   const heading=element('div','sp-chat-visual-tag-heading');
   const candidate=row.status==='candidate',inProgress=row.status==='in_progress';
   heading.append(element('strong','sp-chat-visual-tag-name',`${sessionNames[row.session]} · ${candidate?tagNames[row.tag]:inProgress?'Session in progress':'No visual candidate'}`));
   const badge=element('span','sp-chat-visual-badge',candidate?(row.confidence==='clear'?'Clear visual read':'Tentative'):inProgress?'In progress':'Unclassified');badge.dataset.confidence=row.confidence;heading.append(badge);item.append(heading);
   if(row.evidence){const observation=element('p','sp-chat-visual-observation');observation.append(element('strong','','Observed · '),doc.createTextNode(row.evidence));item.append(observation);}
   if(row.uncertainty){const uncertainty=element('p','sp-chat-visual-uncertainty');uncertainty.append(element('strong','','Uncertainty · '),doc.createTextNode(row.uncertainty));item.append(uncertainty);}
   if(inProgress)item.append(element('p','sp-chat-note','No final visual tag while this session is incomplete.'));
   list.append(item);
  }
  section.append(list);
 }else if(body.visualTags!==undefined){section.append(element('p','sp-chat-note sp-chat-visual-unavailable','Visual candidates are unavailable for this response.'));}
 const analysis=body.analysis;section.append(element('p','sp-chat-chart-summary',analysis.summary));
 const sequence=element('ol','sp-chat-sequence');for(const step of analysis.sequence)sequence.append(element('li','',step));section.append(sequence);
 for(const [label,text]of [['BBOX',analysis.bbox],['SessionPath',analysis.sessionpath]]){const detail=element('p','sp-chat-chart-detail');detail.append(element('strong','',label+' · '),doc.createTextNode(text));section.append(detail);}
 section.append(element('strong','sp-chat-uncertainty-title','What cannot be confirmed'));const uncertainty=element('ul','sp-chat-uncertainties');for(const text of analysis.uncertainties)uncertainty.append(element('li','',text));section.append(uncertainty,element('p','sp-chat-note',`${body.model} · ${body.referenceVersion}. No TradingView forecast code is calculated from the image.`));
 return section;
}
