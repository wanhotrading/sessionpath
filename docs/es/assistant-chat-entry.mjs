import {instrument} from './instrument.mjs';
import {loadChartConfiguration,mountAssistantChat} from '../assistant-chat.mjs?v=study-return-20261120';
mountAssistantChat({instrument,getChartConfiguration:loadChartConfiguration});
