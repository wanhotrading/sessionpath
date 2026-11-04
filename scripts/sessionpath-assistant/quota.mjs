export const QUOTA_LIMITS = Object.freeze({globalDay: 40, clientDay: 10, clientWindow: 5, windowMs: 600_000});

export function utcDay(now) { return new Date(now).toISOString().slice(0, 10); }

export async function hashClient(ip, day, nonce) {
  const bytes = new TextEncoder().encode(`${nonce}\n${day}\n${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function decideQuota(current, clientHash, now) {
  const day = utcDay(now);
  const resetAt = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
  const state = current?.day === day ? structuredClone(current) : {day, count: 0, clients: {}};
  const client = state.clients[clientHash] ?? {count: 0, recent: []};
  const recent = client.recent.filter(time => time > now - QUOTA_LIMITS.windowMs);
  const wait = seconds => ({allowed: false, retryAfter: Math.max(1, Math.ceil(seconds)), day});
  if (state.count >= QUOTA_LIMITS.globalDay) return {decision: wait((resetAt - now) / 1000), state: null};
  if (client.count >= QUOTA_LIMITS.clientDay) return {decision: wait((resetAt - now) / 1000), state: null};
  if (recent.length >= QUOTA_LIMITS.clientWindow) return {decision: wait((recent[0] + QUOTA_LIMITS.windowMs - now) / 1000), state: null};
  state.count += 1;
  state.clients[clientHash] = {count: client.count + 1, recent: [...recent, now]};
  return {decision: {allowed: true, day}, state};
}

// A single object coordinates the deliberately small global free-model budget.
// At most 40 client hashes and 5 recent timestamps per client are retained.
// No prompt, response, raw IP address or API key is persisted here.
export class QuotaStore {
  constructor(storage) { this.storage = storage; }
  async reserve(ip, now = Date.now()) {
    if (typeof ip !== 'string' || !ip || ip.length > 64) throw new Error('Missing trusted client address');
    const nonce = await this.storage.transaction(async tx => {
      let value = await tx.get('nonce');
      if (!value) {
        value = crypto.randomUUID();
        await tx.put('nonce', value);
      }
      return value;
    });
    const clientHash = await hashClient(ip, utcDay(now), nonce);
    return this.storage.transaction(async tx => {
      const {decision, state} = decideQuota(await tx.get('budget'), clientHash, now);
      if (state) await tx.put('budget', state);
      return decision;
    });
  }
}
