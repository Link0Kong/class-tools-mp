const PERIODS = [
  ['08:10', '08:50'], ['09:00', '09:40'], ['09:50', '10:30'], ['10:40', '11:20'],
  ['11:30', '12:10'], ['14:30', '15:10'], ['15:20', '16:00'], ['16:10', '16:50'],
  ['17:00', '17:40'], ['19:00', '19:40'], ['19:50', '20:30'], ['20:40', '21:20']
];

function focusPeriod(c, clock) {
  for (let p = c.start; p <= c.end && p <= PERIODS.length; p++) {
    if (PERIODS[p - 1] && clock < PERIODS[p - 1][1]) return p;
  }
  return null;
}

module.exports = { PERIODS, focusPeriod };
