// How far through a game is (0..1), so the ticker can lead with games about to finish.
const parseClockSeconds = (clock) => {
  if (!clock) return null;
  const c = String(clock);
  const mmss = c.match(/^(\d+):(\d+)/);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  const mins = c.match(/^(\d+)/); // soccer "67'" or hockey/basketball "12.3"
  if (mins) return Number(c.replace(/[^0-9.]/g, '')) * (c.includes("'") ? 60 : 1);
  return null;
};

export function gameProgress({ state, period = 0, clock, regPeriods, periodMins, countsUp = false }) {
  if (state === 'post') return 1;
  if (state !== 'in') return 0;
  if (!regPeriods || !period) return 0.5;
  if (period > regPeriods) return 0.99; // overtime / extras: as late as it gets
  const secs = parseClockSeconds(clock);
  const hasClock = Boolean(periodMins) && secs !== null;
  // Soccer's clock runs the whole match (e.g. 67'): progress is minutes over regulation.
  if (countsUp && hasClock) return Math.min(0.98, secs / (periodMins * regPeriods * 60));
  // Otherwise the clock counts down within a period; with no clock (innings, sets) assume mid-period.
  const within = hasClock ? 1 - Math.min(1, secs / (periodMins * 60)) : 0.5;
  return Math.min(0.98, (period - 1 + within) / regPeriods);
}
