import {instrument} from './instrument.mjs';
import {mountPersonalTradingView} from './tradingview-live-core.mjs?v=fixed-key-20261104';
mountPersonalTradingView({instrument,endpoint:document.querySelector('meta[name="sessionpath-personal-endpoint"]')?.content,pineURL:new URL('./SessionPath-personal-TradingView-sender.pine',import.meta.url).href});
