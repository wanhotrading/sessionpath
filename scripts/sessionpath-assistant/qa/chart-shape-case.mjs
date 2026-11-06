// Independently verified from the existing native NQ1! five-minute export
// (outputs/mobile-autofill-fix/NQ1-5m-native-wide-20261103.csv). This is a
// metadata-only fixture: no image, account identifier, or later NY outcome.
export const OCT19_NQ_SHAPE_CASE = Object.freeze({
  market: 'NQ',
  ticker: 'NQ1!',
  date: '2026-10-19',
  cutoff: '2026-10-19T10:45',
  timezone: 'America/New_York',
  intervalMinutes: 5,
  priorNyHigh: 30045.75,
  priorNyLow: 29268.75,
  open1930: 29612.25,
  sessions: Object.freeze([
    Object.freeze({session: 'NTA', high: 29624.50, low: 29226, close: 29612, order: 'low_first', complete: true}),
    Object.freeze({session: 'ASIA', high: 29804.25, low: 29599.50, close: 29801.50, order: 'low_first', complete: true}),
    Object.freeze({session: 'LONDON', high: 29800, low: 29665.50, close: 29765.50, order: 'high_first', complete: true}),
    Object.freeze({session: 'NY', high: null, low: null, close: null, order: null, complete: false}),
  ]),
});

export const OCT19_NQ_EXPECTED_TAGS = Object.freeze({NTA: 'UP_FINISH', ASIA: 'UP_FINISH', LONDON: 'NARROW', NY: null});
