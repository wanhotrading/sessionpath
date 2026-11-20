import {instrument} from './instrument.mjs';
import {loadChartConfiguration,mountAssistantChat} from '../assistant-chat.mjs?v=elf-fill-20261120b';
mountAssistantChat({instrument,getChartConfiguration:loadChartConfiguration});
