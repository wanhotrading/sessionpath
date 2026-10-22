// Conservative headline rules, not a language model or a trading signal.
// Publisher text is always data. Unknown facts are never filled from assumptions.
const match = (text, pattern) => pattern.test(text);
const OIL = /\b(?:crude|wti|brent|opec|petroleum|oilfield|cushing)\b|原油|石油|油田|欧佩克|歐佩克/iu;
const INDICES = /\b(?:cpi|pce|ppi|fomc|fed|federal reserve|payrolls?|nfp|unemployment|jobless|jolts|adp|gdp|ism|pmi|retail sales|nasdaq|s&p|dow jones|russell|treasur\w*|tariffs?|duties|export controls|debt ceiling|bank failure|circuit breaker)\b|美联储|美聯儲|非农|非農|失业|失業|关税|關稅|纳指|納指|标普|標普|通胀|通脹/iu;
const TRUMP = /\btrump\b|特朗普|川普/iu;
const POLICY = /\b(?:tariffs?|duties|trade|sanctions?|iran|oil|fed|rates?|tax|military|ceasefire|china|export|budget|spending|troops|blockade|chips)\b|关税|關稅|制裁|伊朗|石油|利率|贸易|貿易|停火|中国|中國|军|軍|税|稅/iu;
export function extraNewsCategories(text) {
  const foreign = /\b(?:china|chinese|russia|russian|uk|britain|eurozone|germany|japan|canada|australia)\b|中国|中國|日本|欧元区|歐元區/iu.test(text) && !/\b(?:us|u\.s\.|united states|fed|fomc|nasdaq|tariffs?|duties|export controls)\b|美国|美國|美联储|美聯儲|关税|關稅/iu.test(text);
  const genericMacro = /^(?:retail sales|gdp|pmi|ism)$/iu.test(text.trim());
  return [...(INDICES.test(text) && !foreign && !genericMacro ? ['indices'] : []), ...(TRUMP.test(text) && POLICY.test(text) ? ['trump'] : [])];
}
function inventoryNumbers(text) {
  // Only explicit crude inventory changes with explicit barrel scale. Never b/d.
  if (/\b(?:bpd|barrels? per day|b\/d)\b/iu.test(text)) return null;
  const re = /(?:(draw|build|fell|rose|decreased|increased)\s*(?:of|by)?\s*)?([+−-]?\d+(?:\.\d+)?)\s*(million|thousand|mn|mln|mb|kb|m|k)\b(?:\s*(?:barrels?|bbl))?/giu;
  const values = [...text.matchAll(re)].map(m => {
    const value = Number(m[2].replace('−', '-')) * (/^(?:k|kb|thousand)$/iu.test(m[3]) ? .001 : 1);
    const prefix = text.slice(Math.max(0, m.index - 48), m.index);
    return {value: /draw|fell|decreased/i.test(m[1] || '') ? -Math.abs(value) : value,
      kind: /(?:expected|forecast|consensus|exp\.?|est\.?)\s*(?::|of|at)?\s*$/iu.test(prefix) ? 'consensus' : /(?:previous|prior|api)\s*:?\s*$/iu.test(prefix) ? 'other' : 'actual'};
  });
  const actual = values.filter(v => v.kind === 'actual');
  const expected = values.filter(v => v.kind === 'consensus');
  if (actual.length !== 1 || expected.length > 1) return null;
  return {metric: 'crude inventory change', actual: actual[0].value, consensus: expected[0]?.value ?? null,
    surprise: expected.length ? Number((actual[0].value - expected[0].value).toFixed(6)) : null, unit: 'million barrels', consensus_status: expected.length ? 'As reported in headline; pre-release snapshot unverified' : 'Unavailable'};
}
export function analyzeNews(item, {now = Date.now()} = {}) {
  const text = String(item.raw_text || item.title || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const categories = [...new Set([...(item.categories || []), ...extraNewsCategories(text)])];
  let event = 'Relevant report', priority = 'P3', direction = 'unknown', rationale = 'Headline context is insufficient for a directional interpretation.';
  let status = 'reported', numbers = null;
  const rules = [], missing = ['Independent primary-source confirmation'];
  const apply = (id, label, p, d, why) => { rules.push(id); event = label; priority = p; direction = d; rationale = why; };
  const oil = OIL.test(text) || categories.includes('oil');
  const trump = TRUMP.test(text);
  const forecast = (/\b(?:expects?|forecasts?|preview|ahead of|due tomorrow|analyst|could|may|might|considering|proposes?)\b|预计|預計|可能|拟议|擬議/iu.test(text) || /\bexpected\b/iu.test(text) && !/\b(?:actual|comes? in|draw|build|cuts?|raises?|holds?|hikes?|rose|fell|beat|miss)\b/iu.test(text));
  const question = /\b(?:reporter|journalist)\b.{0,35}\basks?\b|\basked whether\b|记者提问|記者提問/iu.test(text);
  const historical = /\b(?:last year|last month|in 20[0-2]\d|recap|previously announced|reiterates?|repeats?)\b|去年|回顾|回顧|重申/iu.test(text);
  const correction = /\b(?:correction|corrects?|retracts?|retraction)\b|更正|纠正|糾正/iu.test(text);
  const denial = /\b(?:denies?|denial|not interrupted|no disruption|will not (?:impose|raise|cut|attack|invade)|won't (?:impose|raise|cut|attack|invade)|rules? out)\b|否认|否認|不会|不會|未中断|未中斷/iu.test(text);
  const rumor = /\b(?:rumou?r|unconfirmed|sources say|reportedly)\b|传闻|傳聞|据悉|據悉/iu.test(text);
  if (oil && /\b(?:eia|api|wpsr)\b|能源信息署|能源資訊署/iu.test(text) && /stocks?|inventor|\bdraw\b|\bbuild\b|库存|庫存/iu.test(text)) {
    const eia = /\beia\b|能源信息署|能源資訊署/iu.test(text);
    const crudeOnly = /\bcrude\b|原油/iu.test(text) && !/gasoline|distillate|diesel|\bspr\b|汽油|馏分|餾分|柴油|战略|戰略/iu.test(text);
    numbers = crudeOnly ? inventoryNumbers(text) : null;
    apply('inventory', eia ? 'EIA inventories' : 'API inventories', !forecast && /[0-9]/u.test(text) ? (eia ? 'P1' : 'P2') : 'P3', 'unknown', 'Reported inventory change; comparable consensus is unavailable. A draw alone does not establish bullish surprise.');
    if (numbers?.surprise != null) {
      direction = numbers.surprise < 0 ? 'bullish_conditional' : numbers.surprise > 0 ? 'bearish_conditional' : 'neutral';
      rationale = numbers.surprise === 0 ? 'Reported crude change matches reported consensus.' : numbers.surprise > 0 ? 'Stocks are higher than the reported expectation—even if the headline reports a draw.' : 'Stocks are lower than the reported expectation—even if the headline reports a build.';
    }
    if (!crudeOnly) rationale = 'Inventory components must be read separately; no crude surprise is calculated from product or strategic-reserve figures.';
    missing.push('Comparable release period and pre-release consensus verification', 'Products, refinery runs and API comparator');
  } else if (oil && /demand.{0,35}(?:forecast|outlook|growth)|需求.{0,20}(?:预期|預期|增长|增長)/iu.test(text)) {
    apply('oil-demand', 'Oil demand outlook', 'P2', /cut|lower|downgrad|下调|下調/iu.test(text) ? 'bearish_conditional' : /rais|upgrad|上调|上調/iu.test(text) ? 'bullish_conditional' : 'unknown', 'A demand-growth revision is not a production cut. Compare with the previous forecast.');
  } else if (oil && /pace.{0,30}(?:output|production).{0,20}increases?|增产速度|增產速度/iu.test(text)) {
    apply('supply-path', 'Change in supply growth', 'P2', 'unknown', 'Slower output growth is not an outright production cut; the expected supply path is needed.');
  } else if (/refiner\w*|炼油|煉油/iu.test(text) && /fire|outage|shut|halt|火灾|火災|停产|停產/iu.test(text)) {
    apply('refinery', 'Refinery disruption', 'P2', 'mixed', 'Reduced refinery runs can weaken crude demand while tightening gasoline or diesel supply.');
  } else if (oil && /\b(?:cut\w*|reduc\w*)\b.{0,25}\b(?:output|production)\b|\b(?:production|output)\s+cuts?\b|减产|減產/iu.test(text)) {
    apply('output-cut', 'Production reduction report', 'P2', 'bullish_conditional', 'Less available oil could support crude, only if the reduction is new and exceeds the expected supply path.');
    missing.push('Incremental volume, baseline, compliance and effective date');
  } else if (oil && /\b(?:raise|increase|restore|resume|restart|unwind)\w*\b.{0,30}\b(?:output|production|exports?|field|cuts?)\b|增产|增產|恢复出口|恢復出口/iu.test(text)) {
    apply('output-up', 'Supply restoration / increase', 'P2', 'bearish_conditional', 'Additional available supply could pressure crude; announced capacity is not verified flow.');
  } else if (oil && /shut in|halt|force majeure|outage|export suspension|停产|停產|不可抗力|暂停出口|暫停出口/iu.test(text)) {
    apply('oil-outage', 'Oil supply disruption', 'P2', 'bullish_conditional', 'A verified physical supply loss could support crude; operator confirmation, size and duration remain necessary.');
  } else if (oil && /\bspr\b|strategic.{0,20}reserve|战略储备|戰略儲備/iu.test(text)) {
    apply('reserves', 'Strategic oil reserves', 'P2', /release|sell|释放|釋放/iu.test(text) ? 'bearish_conditional' : /refill|repurchase|补充|補充/iu.test(text) ? 'bullish_conditional' : 'unknown', 'Check new barrels, delivery dates, and sale versus exchange; previously announced barrels are not a new surprise.');
  } else if (/\b(?:tariffs?|duties|export controls)\b|关税|關稅|出口管制/iu.test(text)) {
    const relief = /pause|suspend|delay|exempt|rollback|reduce|blocks?|暂停|暫停|推迟|推遲|豁免|下调|下調/iu.test(text);
    const action = /impos|rais|announc|sign|effective|pause|suspend|block|实施|實施|宣布|签署|簽署/iu.test(text);
    apply('trade-policy', 'Trade policy', action ? 'P2' : 'P3', action && !forecast && !denial ? (relief ? 'bullish_conditional' : 'bearish_conditional') : 'unknown', relief ? 'Potential index relief relative to the previous tariff path; exclusions, scope and implementation must be checked.' : 'Trade restrictions can pressure earnings and raise costs; scope and the previously expected policy path matter.');
    status = /blocks?|court|法院/iu.test(text) ? 'court challenge' : /sign|签署|簽署/iu.test(text) ? 'signed instrument reported' : action ? 'announced commitment reported' : 'rhetoric';
  } else if (/\b(?:cpi|pce|ppi|payrolls?|nfp|unemployment|gdp|retail sales|jobless claims|jolts|ism|pmi)\b|非农|非農|通胀|通脹|失业|失業/iu.test(text)) {
    const actual = /\b(?:actual|comes? in|released|rose|fell|beat|miss|at)\b|\d|公布|录得|錄得/iu.test(text);
    apply('macro', 'US economic release', actual && !forecast ? 'P1' : 'P3', 'unknown', 'Compare the same metric, period, units and revisions. Equity direction depends on growth and inflation sensitivity.');
    missing.push('Matched pre-release consensus and units', 'Market regime and revisions');
  } else if (/\b(?:fed|fomc|federal reserve)\b|美联储|美聯儲/iu.test(text)) {
    const decision = /\b(?:cuts?|raises?|holds?|hikes?)\b.{0,35}(?:\brate|\bbp|basis point)|维持利率|維持利率|降息|加息/iu.test(text);
    apply('fed', trump ? 'Political pressure on rates' : 'Federal Reserve policy', !trump && decision && !forecast ? 'P1' : 'P2', 'unknown', trump ? 'A political request for a rate cut is not a Federal Reserve decision.' : 'The rate decision and future guidance must be compared with expectations separately.');
    missing.push('Expected decision and previous guidance');
  } else if (categories.includes('geopolitics')) {
    apply('geopolitics', 'Geopolitical development', 'P2', 'unknown', 'Check physical supply exposure and confirmation. Negotiations or a ceasefire do not establish restored oil flows.');
  } else if (categories.includes('indices')) {
    apply('index-context', 'US index context', 'P3', 'unknown', 'Relevant to indices; a specific new catalyst and its economic transmission need confirmation.');
  }
  if (/no longer ruling out/iu.test(text)) { status = 'possibility reopened'; priority = 'P2'; direction = 'unknown'; }
  if (forecast && !rules.includes('oil-demand')) { status = 'proposal / forecast'; priority = priority === 'P1' ? 'P2' : priority; direction = 'unknown'; rationale += ' This is prospective, not a completed release or action.'; }
  if (rumor) { status = 'unconfirmed report'; priority = priority === 'P1' ? 'P2' : priority; direction = 'unknown'; }
  if (denial) { status = 'denial / negated action'; priority = 'P2'; direction = 'unknown'; rationale = 'The action is denied or negated. Do not interpret this as a confirmed event; check the original claim and what has changed.'; }
  if (correction) { status = 'correction'; priority = 'P2'; direction = 'unknown'; rationale = 'Material correction reported. Recheck the original interpretation against this update.'; }
  if (question || historical) { status = question ? 'question' : 'historical / repeated'; priority = 'P3'; direction = 'unknown'; }
  // Ambiguous compound/negation clauses are deliberately not assigned a sign.
  if (/\b(?:not|no|except|unless|if|but|however)\b|并非|並非|但|除外/iu.test(text) && direction !== 'neutral') direction = 'unknown';
  if (text.includes('…') || text.endsWith('...')) { priority = priority === 'P1' ? 'P2' : priority; direction = 'unknown'; missing.push('Complete headline'); }
  const assets = categories.includes('oil') ? ['WTI', 'Brent'] : categories.includes('indices') || categories.includes('trump') ? ['ES', 'NQ', 'YM', 'RTY'] : ['Oil / US indices: exposure unverified'];
  if (categories.includes('oil') && categories.includes('indices')) assets.push('ES', 'NQ', 'YM', 'RTY');
  const published = Date.parse(item.publishedAt);
  return {event_type: event, priority, categories, policy_status: status, rule_ids: rules, assets,
    direction_by_asset: Object.fromEntries(assets.map(a => [a, (categories.includes('oil') && ['ES','NQ','YM','RTY'].includes(a) && !rules.includes('trade-policy')) ? 'unknown' : direction])), direction, rationale, numbers,
    missing_fields: [...new Set(missing)], evidence_excerpt: text, raw_text: text,
    source_authenticity: 'Publisher report; original source not authenticated', speaker_verified: false, source_url: item.url || null, source_name: item.source || null, published_at_utc: item.publishedAt || null,
    parse_confidence: 'Rule-based; not statistically calibrated', regime: 'unknown', observed_market_response: null,
    is_correction: correction, is_provisional: true, received_at_utc: item.receivedAt || new Date(now).toISOString(),
    detected_at_utc: new Date(now).toISOString(), delayed: Number.isFinite(published) && now - published > 10 * 60_000,
    invalidation_checks: ['A correction, denial, changed scope or implementation update can invalidate this reading.', 'Observed price response has not been measured.']};
}
export const directionLabel = value => ({bullish_conditional:'Potential upside',bearish_conditional:'Potential downside',mixed:'Mixed',neutral:'In line',unknown:'Direction unclear'}[value] || 'Direction unclear');
