import {DurableObject} from 'cloudflare:workers';
import {PersonalFeedStore} from './state.mjs';
import {createPersonalHandler} from './router.mjs';

export class PersonalFeed extends DurableObject {
  async getLatest(){return new PersonalFeedStore(this.ctx.storage).getLatest();}
  async accept(envelope){return new PersonalFeedStore(this.ctx.storage).accept(envelope);}
}
export default {fetch:createPersonalHandler()};
