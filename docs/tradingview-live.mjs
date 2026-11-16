import {instrument} from './instrument.mjs';
import {mountPersonalTradingView} from './tradingview-live-core.mjs?v=bbox-history-20261116';
const endpoint=document.querySelector('meta[name="sessionpath-personal-endpoint"]')?.content;
mountPersonalTradingView({instrument,endpoint,managedReadURL:new URL('/api/autofill',endpoint).href});
