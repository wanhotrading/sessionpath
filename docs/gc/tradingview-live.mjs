import {instrument} from './instrument.mjs';
import {mountPersonalTradingView} from '../tradingview-live-core.mjs?v=personal-only-20261103';
mountPersonalTradingView({instrument,endpoint:document.querySelector('meta[name="sessionpath-personal-endpoint"]')?.content,pineURL:new URL('../SessionPath-personal-TradingView-sender.pine',import.meta.url).href});
