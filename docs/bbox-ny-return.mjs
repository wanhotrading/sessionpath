import { rate } from './research-core.mjs';

export const afternoonStart = 510;
export const afternoonEnd = 960;
const step = 5;
const closes = (afternoonEnd - afternoonStart) / step;
export const minimumQuartileSample = 25;

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
  const distanceReturns = Array.from({ length: 5 }, () => []);
  const groupReturns = Array.from({ length: 5 }, () => Array.from({ length: 4 }, () => []));
  const band = bboxDistanceBand(distance);
  for (const { date: priorDate, bytes } of days) {
    if (priorDate >= date || (year && priorDate.slice(0, 4) !== String(year))) continue;
    // The first byte packs side, box relation and distance. The second stores the first return index.
    const condition = bytes[2 * index] - 1;
    if (condition < 0 || condition >= 40 || (condition < 20 ? 1 : -1) !== side) continue;
    const returnIndex = bytes[2 * index + 1];
    sideReturns.push(returnIndex);
    const caseBand = condition % 5;
    const caseGroup = Math.floor((condition % 20) / 5);
    distanceReturns[caseBand].push(returnIndex);
    groupReturns[caseBand][caseGroup].push(returnIndex);
  }

  const sameDistance = distanceReturns[band];
  const sameGroup = group ? groupReturns[band][group] : null;
  const matchesGroup = band > 0 && (sameGroup?.length ?? 0) >= minimumQuartileSample;
  const matchesDistance = matchesGroup || (band > 0 && sameDistance.length >= minimumQuartileSample);
  const returns = matchesGroup ? sameGroup : matchesDistance ? sameDistance : sideReturns;
  const criteria = matchesGroup ? 'BBOX side, AVR distance and SessionPath position' :
    matchesDistance ? 'BBOX side and AVR distance' : 'BBOX side';
  const peers = matchesGroup ? groupReturns.slice(1).flatMap(groups => groups.slice(1)) :
    matchesDistance ? distanceReturns.slice(1) : [];
  const decay = returnCurve(returns, index);
  const peerCurves = peers.filter(pool => pool.length >= minimumQuartileSample)
    .map(pool => pool === returns ? decay : returnCurve(pool, index));
  return { decay, remaining: decay[0], criteria, peerCurves };
}

function returnCurve(returns, index) {
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
  return decay;
}

export function returnQuartile(point, peers) {
  if (!Number.isFinite(point?.p) || point.n < minimumQuartileSample) return null;
  const eligible = peers.filter(peer => Number.isFinite(peer?.p) && peer.n >= minimumQuartileSample);
  if (eligible.length < 2) return null;
  // Weight each conditional rate by the number of dates still at risk, splitting ties.
  let below = 0;
  let total = 0;
  for (const peer of eligible) {
    const difference = point.k * peer.n - peer.k * point.n;
    below += difference > 0 ? peer.n : difference === 0 ? peer.n / 2 : 0;
    total += peer.n;
  }
  const rank = below / total;
  return { rank, band: rank >= .75 ? 'upper' : rank <= .25 ? 'lower' : 'middle' };
}
