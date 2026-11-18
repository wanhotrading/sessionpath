import {instrument} from './instrument.mjs';
import {loadChartConfiguration,mountAssistantChat} from './assistant-chat.mjs?v=single-session-20261118';
mountAssistantChat({instrument,getChartConfiguration:loadChartConfiguration});
