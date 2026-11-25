import { rate } from './research-core.mjs';

export const afternoonStart = 510;
export const afternoonEnd = 960;
const step = 5;
const closes = (afternoonEnd - afternoonStart) / step;
const minimumMatches = 25;

export function readAfternoonArchive(data, market) {
  if (data?.version !== 1 || data.market !== market || data.start !== afternoonStart ||
      data.end !== afternoonEnd || data.step !== step || !Array.isArray(data.days)) {
    throw new Error('Afternoon BBOX history could not be read.');
  }
  return data.days.map(([date, encoded]) => {
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || bytes.length !== closes * 2) {
      throw new Error('Afternoon BBOX history has invalid records.');
    }
    return { date, bytes };
  });
}

export function bboxDistanceBand(distance) {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  return distance < 0.10 ? 1 : distance < 0.25 ? 2 : distance < 0.50 ? 3 : 4;
}

export function afternoonReturnStats(days, { date, year, observation, side, group, distance }) {
  const index = (observation - afternoonStart) / step;
  if (!Number.isInteger(index) || index < 0 || index >= closes || ![1, -1].includes(side)) {
    throw new RangeError('Invalid afternoon BBOX observation.');
  }

  const sideReturns = [];
  const distanceReturns = [];
  const groupReturns = [];
  const band = bboxDistanceBand(distance);
  for (const { date: priorDate, bytes } of days) {
    if (priorDate >= date || (year && priorDate.slice(0, 4) !== String(year))) continue;
    // The first byte packs side, box relation and distance. The second stores the first return index.
    const condition = bytes[2 * index] - 1;
    if (condition < 0 || condition >= 40 || (condition < 20 ? 1 : -1) !== side) continue;
    const returnIndex = bytes[2 * index + 1];
    sideReturns.push(returnIndex);
    if (!band || condition % 5 !== band) continue;
    distanceReturns.push(returnIndex);
    if (group && Math.floor((condition % 20) / 5) === group) groupReturns.push(returnIndex);
  }

  const matchesGroup = groupReturns.length >= minimumMatches;
  const matchesDistance = matchesGroup || distanceReturns.length >= minimumMatches;
  const returns = matchesGroup ? groupReturns : matchesDistance ? distanceReturns : sideReturns;
  const criteria = matchesGroup ? 'BBOX side, AVR distance and SessionPath position' :
    matchesDistance ? 'BBOX side and AVR distance' : 'BBOX side';
  const counts = new Uint32Array(closes + 1);
  for (const close of returns) {
    if (close > index && close <= closes) counts[close]++;
  }
  let pending = returns.length;
  let remainingReturns = counts.reduce((total, count) => total + count, 0);
  const decay = [];
  for (let close = index; close <= closes; close++) {
    pending -= counts[close];
    remainingReturns -= counts[close];
    decay.push({ minute: afternoonStart + close * step, ...rate(remainingReturns, pending) });
  }
  return { decay, remaining: decay[0], criteria };
}
