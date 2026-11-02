// Shared client boundary: a Gold feed must use the reviewed Gold conventions,
// the GC reference contract and its $0.10 price increment. Never infer a session
// from a neighboring instrument, nor substitute MGC executions for GC bars.
export function requireGoldConvention(convention){
 if(!convention||!String(convention.status||'').startsWith('FROZEN')||!String(convention.id||'').trim()||convention.timeZone!=='America/New_York'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(convention.frozenUTC||'')||!Number.isFinite(Date.parse(convention.frozenUTC||'')))throw Error('Gold Auto-fill is waiting for its reviewed AVR and prior-session reference windows.');
 for(const key of ['bboxSession','avrSession']){const w=convention[key];if(!w||!Number.isInteger(w.startMinute)||!Number.isInteger(w.endMinute)||w.startMinute<0||w.startMinute>=w.endMinute||w.endMinute>1440||w.startMinute%5||w.endMinute%5)throw Error('Gold reference windows are not ready.');}
 return convention;
}
export function assertGoldConvention(observed,expected){
 requireGoldConvention(expected);requireGoldConvention(observed);
 if(observed.id!==expected.id||observed.frozenUTC!==expected.frozenUTC||['bboxSession','avrSession'].some(key=>['startMinute','endMinute'].some(field=>observed[key][field]!==expected[key][field])))throw Error('The Gold data service uses a different session reference. Refresh after the matching service is connected.');
}
export function validateGoldAutoFill(result,expected){
 assertGoldConvention(result.convention,expected);
 if(result.market!=='GC'||!/^GC[FGHJKMNQUVXZ]\d{4}$/.test(result.contract||''))throw Error('Auto-fill requires the GC reference contract.');
 const symbol=result.contract.slice(0,3)+result.contract.slice(-2)+'.CMX';
 if(result.sourceSymbol!==symbol)throw Error('The Gold feed does not identify the matching COMEX delivery contract.');
 if(result.snapshotRule!=='completed-context-plus-cutoff-open-v1'||!Number.isFinite(result.values?.decisionOpen)||result.values.rangeHigh<result.values.decisionOpen||result.values.rangeLow>result.values.decisionOpen)throw Error('Gold context must include the known decision open in its running high/low.');
 for(const number of Object.values(result.values||{}))if(typeof number!=='number'||!Number.isFinite(number)||Math.abs(number*10-Math.round(number*10))>1e-6)throw Error('Gold Auto-fill prices must use the $0.10 GC increment.');
 return result;
}
