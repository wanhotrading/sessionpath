import {instrument} from './instrument.mjs';
import {loadChartConfiguration,mountAssistantChat} from './assistant-chat.mjs?v=midnight-elf-20261119';
mountAssistantChat({instrument,getChartConfiguration:loadChartConfiguration});
