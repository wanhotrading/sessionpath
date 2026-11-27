// A shortened reference needs the exchange's final-bar timestamp, carried by the
// authenticated sender. The ten-day AVR continues to use full 78-bar sessions.
const coverageClock = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',
  year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
export function validPriorCoverage(snapshot) {
  const {prior_ny_count: count, prior_ny_date: date, prior_exchange_close: close, avr_dates: dates} = snapshot;
  if (!Array.isArray(dates) || dates.length !== 10) return false;
  if (count === 78) return !close && dates[9] === date;
  if (!Number.isInteger(count) || count < 1 || count >= 78 || typeof close !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:00(?:\.000)?Z$/.test(close) || !(dates[9] < date)) return false;
  const ms = Date.parse(close);
  if (!Number.isFinite(ms)) return false;
  const p = Object.fromEntries(coverageClock.formatToParts(ms).map(v => [v.type,v.value]));
  return [p.year,p.month,p.day].join('-') === date && Number(p.hour)*60+Number(p.minute) === 570+5*count;
}
