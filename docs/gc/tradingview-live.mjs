import {instrument} from './instrument.mjs';
import {mountPersonalTradingView} from '../tradingview-live-core.mjs?v=checkpoint-open-20261113';
const endpoint=document.querySelector('meta[name="sessionpath-personal-endpoint"]')?.content;
mountPersonalTradingView({instrument,endpoint,managedReadURL:new URL('/api/autofill',endpoint).href});
