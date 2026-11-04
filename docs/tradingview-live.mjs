import {instrument} from './instrument.mjs';
import {mountPersonalTradingView} from './tradingview-live-core.mjs?v=button-only-20261104';
const endpoint=document.querySelector('meta[name="sessionpath-personal-endpoint"]')?.content;
mountPersonalTradingView({instrument,endpoint,managedReadURL:new URL('/api/autofill',endpoint).href});
