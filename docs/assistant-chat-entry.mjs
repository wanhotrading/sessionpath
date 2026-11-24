import {instrument} from './instrument.mjs';
import {loadChartConfiguration,mountAssistantChat} from './assistant-chat.mjs?v=repeat-reading-20261124';
mountAssistantChat({instrument,getChartConfiguration:loadChartConfiguration});
