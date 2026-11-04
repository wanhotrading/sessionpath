import {DurableObject} from 'cloudflare:workers';
import {QuotaStore} from './quota.mjs';
import {createAssistantHandler} from './router.mjs';

export class AssistantQuota extends DurableObject {
  async reserve({ip}) { return new QuotaStore(this.ctx.storage).reserve(ip); }
}

export default {fetch: createAssistantHandler()};
