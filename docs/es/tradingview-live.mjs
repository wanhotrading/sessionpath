import {instrument} from './instrument.mjs';
import {mountPersonalTradingView} from '../tradingview-live-core.mjs?v=feed-watermark-20261118';
const endpoint=document.querySelector('meta[name="sessionpath-personal-endpoint"]')?.content;
mountPersonalTradingView({instrument,endpoint,automaticOnly:true,managedReadURL:new URL('/api/autofill',endpoint).href});
