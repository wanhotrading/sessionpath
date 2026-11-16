import {BBOX_OVERNIGHT_MODELS, BBOX_TRAINING_THROUGH} from './bbox-overnight-coefficients.mjs?v=bbox-history-20261116';

const tolerance = 1e-8;
const phaseCounts = {'03:00': 2, '05:00': 3, '08:30': 4};

function apply(model, features) {
  let logOdds = model.beta[0];
  for (const [index, feature] of features.entries()) {
    logOdds += model.beta[index + 1] * (feature - model.means[index]) / model.scales[index];
  }
  return 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, logOdds))));
}

export function bboxOvernightForecast(market, snapshot) {
  const cutoff = snapshot?.cutoff;
  const models = BBOX_OVERNIGHT_MODELS[market]?.[cutoff];
  const history = snapshot?.bbox_history;
  if (!models || history?.v !== 1 || !Array.isArray(history.phases) || history.phases.length !== 4) return null;
  if (history.phases.some((value, index) => index < phaseCounts[cutoff]
    ? !Number.isInteger(value) || value < 0 || value > 3 : value !== null)) return null;
  const {reference_price: open, prior_low: low, prior_high: high, open_1930: start, avr} = snapshot;
  const {past_high: pastHigh, past_low: pastLow, last_hour_rv: volatility,
    latest_minutes: age, attempts_up: attemptsUp, attempts_down: attemptsDown} = history;
  if (![open, low, high, start, avr, pastHigh, pastLow, volatility].every(Number.isFinite)
    || high <= low || avr <= 0 || pastHigh < pastLow || volatility < 0) return null;
  const prior = Number(history.phases.some(value => value > 0));
  if (prior ? !Number.isInteger(age) || age < 0 || age % 5 !== 0 : age !== null) return null;
  if (![attemptsUp, attemptsDown].every(n => Number.isInteger(n) && n >= 0)) return null;
  const state = open > high + tolerance ? 'U' : open < low - tolerance ? 'D' : 'INSIDE';
  const end = market === 'CL' ? '09:00' : '09:30';
  const date = typeof snapshot.as_of === 'string' ? snapshot.as_of.slice(0, 10) : '';
  const output = {cutoff, end, state, baseline: null, adjusted: null, trainingThrough: BBOX_TRAINING_THROUGH};
  // Historical replays must avoid coefficients fitted after the replay date.
  // The NY morning checkpoints share their calendar date with their UTC timestamps.
  if (state !== 'INSIDE' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= BBOX_TRAINING_THROUGH) return output;
  const upper = Math.log1p(Math.max(0, (high - open) / avr));
  const lower = Math.log1p(Math.max(0, (open - low) / avr));
  const baseline = [upper, lower, upper ** 2, lower ** 2, Math.log1p((pastHigh - pastLow) / avr),
    Math.log1p(volatility / avr), (open - start) / avr, prior];
  const repeats = Math.max(0, Math.max(attemptsUp, attemptsDown) - 1);
  const adjusted = [...baseline, age === null ? 0 : Math.log1p(age / 5), Math.log1p(repeats), Number(repeats > 0)];
  return {...output, baseline: apply(models.baseline, baseline), adjusted: apply(models.adjusted, adjusted), trainingN: models.n};
}
