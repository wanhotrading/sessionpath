import {instrument} from './instrument.mjs';
import {loadChartConfiguration,mountAssistantChat} from '../assistant-chat.mjs?v=chart-provider-20261117';
mountAssistantChat({instrument,getChartConfiguration:loadChartConfiguration});
