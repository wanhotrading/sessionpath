import {classifyNews,cleanNewsText,normalizeNewsDate,safeNewsURL} from './news-feed.mjs?v=discord-topics-20261023';
import {analyzeNews} from './news-analysis.mjs?v=discord-topics-20261023';
import {connectPrivateNews} from './news-discord-client.mjs?v=discord-recovery-20261030';
export {discordConnectionView} from './news-discord-client.mjs?v=discord-recovery-20261030';

export const DISCORD_SESSION_KEY='sessionpath-discord-read-key-v1';

export function discordFeedResult(packet,{now=Date.now()}={}) {
  if(packet?.version!==1 || !Array.isArray(packet.records) || packet.records.length>400)throw Error('Invalid Discord feed.');
  const items=packet.records.flatMap(record=>{
    if(record?.source!=='financialjuice' || record.transport!=='discord' || !/^financialjuice:discord:\d{17,20}:\d{1,2}$/.test(record.id || ''))return [];
    const url=safeNewsURL(record.url,'financialjuice');
    const title=cleanNewsText(record.title).replace(/\s+/g,' ').trim().slice(0,1000);
    const publishedAt=normalizeNewsDate(record.publishedAt,now);
    const receivedAt=normalizeNewsDate(record.receivedAt,now) || new Date(now).toISOString();
    const categories=classifyNews(title);
    if(!url || !url.startsWith('https://discord.com/channels/') || !title || !publishedAt || !categories.length)return [];
    return [{id:record.id,source:'financialjuice',transport:'discord',title,url,publishedAt,receivedAt,categories,raw_text:title,analysis:analyzeNews({title,url,publishedAt,source:'financialjuice',categories},{now})}];
  });
  const connected=packet.status?.connected===true;
  return {items,source:{id:'financialjuice',name:'FinancialJuice',transport:'discord',status:connected?'ok':'error',fetchedAt:new Date(now).toISOString(),latestAt:items.at(-1)?.publishedAt || null,error:connected?null:String(packet.status?.message || 'Discord listener is reconnecting').slice(0,160)}};
}

export function connectDiscordNews({accessKey,onResult,onStatus,fetchImpl}) {
  return connectPrivateNews({accessKey,fetchImpl,onStatus,onFeed:packet=>{
    try {onResult(discordFeedResult(packet));}catch {onStatus('invalid');}
  }});
}
