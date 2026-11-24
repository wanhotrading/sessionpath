import {instrument} from './instrument.mjs';
import {loadChartConfiguration,mountAssistantChat} from './assistant-chat.mjs?v=apply-chart-paths-20261124';
mountAssistantChat({instrument,getChartConfiguration:loadChartConfiguration});
