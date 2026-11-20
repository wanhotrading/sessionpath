import {instrument} from './instrument.mjs';
import {mountPersonalTradingView} from './tradingview-live-core.mjs?v=study-return-20261120';
const endpoint=document.querySelector('meta[name="sessionpath-personal-endpoint"]')?.content;
mountPersonalTradingView({instrument,endpoint,automaticOnly:true,managedReadURL:new URL('/api/autofill',endpoint).href});
