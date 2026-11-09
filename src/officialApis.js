// Official league APIs (preferred source). ESPN is only the backup: see useTeamScoreboard.
//
// Each adapter returns games in the same shape the ESPN path produces, with
// `source: 'official'`. Team codes are mapped onto ESPN's abbreviations so pins, alerts and
// the ticker keep working whichever source answered.

import { gameProgress } from './progress.js';

export const OFFICIAL_SOURCES = {
  mlb: { name: 'MLB Stats API', fetch: fetchMlb },
  nhl: { name: 'NHL Web API', fetch: fetchNhl },
};

// Set from the Settings page: false = ESPN only.
export const dataPrefs = { officialFirst: true };

export const hasOfficialSource = (feedId) => Boolean(OFFICIAL_SOURCES[feedId]);

// official abbreviation -> ESPN abbreviation (only where they differ)
const NHL_TO_ESPN = { LAK: 'LA', NJD: 'NJ', SJS: 'SJ', TBL: 'TB', UTA: 'UTAH' };
const MLB_TO_ESPN = { AZ: 'ARI', CWS: 'CHW' };

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`HTTP error! status: ${res.status}`);
    const retry = Number(res.headers?.get?.('Retry-After'));
    if (retry > 0) err.retryAfterMs = retry * 1000;
    throw err;
  }
  return res.json();
}

const startText = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? 'Scheduled'
    : d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

// ---------------- MLB: statsapi.mlb.com ----------------
export function normalizeMlb(data, feed) {
  const games = (data?.dates || []).flatMap((d) => d.games || []);
  return games.map((g) => {
    const abs = g.status?.abstractGameState; // Preview | Live | Final
    const state = abs === 'Live' ? 'in' : abs === 'Final' ? 'post' : 'pre';
    const ls = g.linescore || {};
    const side = (k) => {
      const t = g.teams?.[k] || {};
      const raw = t.team?.abbreviation || k.toUpperCase();
      const code = MLB_TO_ESPN[raw] || raw;
      return {
        code,
        name: t.team?.name || k,
        logo: t.team?.id ? `https://www.mlbstatic.com/team-logos/${t.team.id}.svg` : undefined,
        score: t.score ?? 0,
        linescores: (ls.innings || []).map((inn) => inn[k]?.runs ?? '–'),
      };
    };
    const away = side('away');
    const home = side('home');
    let detail = g.status?.detailedState || 'Scheduled';
    if (state === 'pre' && !/postponed|suspended|cancel/i.test(detail)) detail = startText(g.gameDate);
    else if (state === 'in' && ls.currentInningOrdinal) detail = `${ls.inningState || ''} ${ls.currentInningOrdinal}`.trim();
    return {
      id: String(g.gamePk),
      source: 'official',
      start: g.gameDate,
      sportSlug: feed.sport,
      leagueSlug: feed.league,
      regPeriods: feed.regPeriods,
      league: feed.tag,
      title: `${away.name} at ${home.name}`,
      status: state === 'in' ? 'LIVE' : state === 'post' ? 'FINAL' : 'PREGAME',
      summary: {
        primaryLabel: detail,
        secondaryLabel: '',
        scoreOrLeader: `${away.code} ${away.score} - ${home.score} ${home.code}`,
      },
      progress: gameProgress({
        state,
        period: ls.currentInning,
        clock: null,
        regPeriods: feed.regPeriods,
        periodMins: null,
      }),
      details: {},
      teams: { away, home },
    };
  });
}

async function fetchMlb(feed, date) {
  const q = date ? `&date=${date}` : '';
  const data = await getJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1${q}&hydrate=linescore,team`);
  return normalizeMlb(data, feed);
}

// ---------------- NHL: api-web.nhle.com ----------------
const mmss = (s) => (/^\d+:\d+$/.test(s || '') ? s.replace(/^0/, '') : s);

export function normalizeNhl(data, feed) {
  return (data?.games || []).map((g) => {
    const st = g.gameState; // FUT PRE LIVE CRIT OFF FINAL
    const state = st === 'LIVE' || st === 'CRIT' ? 'in' : st === 'OFF' || st === 'FINAL' ? 'post' : 'pre';
    const goals = g.goals || [];
    const periods = Math.max(g.period || 0, ...goals.map((x) => x.period || 0), state === 'pre' ? 0 : 3);
    const side = (k) => {
      const t = g[k] || {};
      const raw = t.abbrev || k;
      const code = NHL_TO_ESPN[raw] || raw;
      const perPeriod = state === 'pre' ? [] : Array.from({ length: periods }, (_, i) =>
        goals.filter((x) => x.teamAbbrev === raw && x.period === i + 1).length);
      return {
        code,
        name: t.commonName?.default ? `${t.placeName?.default || ''} ${t.commonName.default}`.trim() : t.name?.default || k,
        logo: t.logo,
        score: t.score ?? 0,
        linescores: perPeriod,
      };
    };
    const awayT = side('awayTeam');
    const homeT = side('homeTeam');
    const pd = g.periodDescriptor || {};
    const ordinal = pd.periodType === 'SO' ? 'SO' : pd.periodType === 'OT' ? 'OT' : `P${pd.number || g.period || ''}`;
    let detail;
    if (state === 'pre') detail = startText(g.startTimeUTC);
    else if (state === 'post') detail = pd.periodType === 'OT' ? 'Final/OT' : pd.periodType === 'SO' ? 'Final/SO' : 'Final';
    else if (g.clock?.inIntermission) detail = `End of ${ordinal}`;
    else detail = `${ordinal} ${mmss(g.clock?.timeRemaining) || ''}`.trim();
    return {
      id: String(g.id),
      source: 'official',
      start: g.startTimeUTC,
      sportSlug: feed.sport,
      leagueSlug: feed.league,
      regPeriods: feed.regPeriods,
      league: feed.tag,
      title: `${awayT.name} at ${homeT.name}`,
      status: state === 'in' ? 'LIVE' : state === 'post' ? 'FINAL' : 'PREGAME',
      summary: {
        primaryLabel: detail,
        secondaryLabel: '',
        scoreOrLeader: `${awayT.code} ${awayT.score} - ${homeT.score} ${homeT.code}`,
      },
      progress: gameProgress({
        state,
        period: g.period,
        clock: g.clock?.timeRemaining,
        regPeriods: feed.regPeriods,
        periodMins: 20,
      }),
      details: {},
      teams: { away: awayT, home: homeT },
    };
  });
}

async function fetchNhl(feed, date) {
  const data = await getJson(`https://api-web.nhle.com/v1/score/${date || 'now'}`);
  return normalizeNhl(data, feed);
}

// ---------------- NASCAR: cf.nascar.com live feed ----------------
// The official live feed covers whichever race is running right now, for all three national
// series. It has no schedule/results history, so ESPN still serves past dates, qualifying
// and upcoming races.
export const NASCAR_OFFICIAL_SERIES = { nascar: 1, 'nascar-oreilly': 2, 'nascar-truck': 3 };

// Feed names carry rookie/champion markers ("Brandon Jones (C)", "Brent Crews # (C)").
const cleanDriverName = (n = '') => n.replace(/\s*\((?:[A-Z]+|i)\)/g, '').replace(/\s*[#*]\s*$/, '').replace(/\s+#\s*/g, ' ').trim();

export function normalizeNascarLive(feed, seriesNum) {
  if (!feed || feed.series_id !== seriesNum) return null;
  const running = feed.lap_number > 0 && feed.laps_to_go > 0 && feed.flag_state < 8 && (feed.vehicles || []).length > 0;
  if (!running) return null;
  const drivers = feed.vehicles
    .map((v) => ({
      id: v.driver?.driver_id,
      position: Number(v.running_position) || 0,
      name: cleanDriverName(v.driver?.full_name) || 'Driver',
      number: v.vehicle_number || '',
      winner: false,
    }))
    .sort((a, b) => (a.position || 99) - (b.position || 99));
  return {
    id: `nascar-live:${feed.race_id}`,
    source: 'official',
    title: feed.run_name || 'NASCAR race',
    track: feed.track_name || '',
    phase: 'LIVE',
    detail: `Lap ${feed.lap_number}/${feed.laps_in_race}`,
    drivers,
    pole: null,
  };
}

export async function fetchNascarLive(seriesId) {
  const num = NASCAR_OFFICIAL_SERIES[seriesId];
  if (!num) return null;
  const feed = await getJson('https://cf.nascar.com/live/feeds/live-feed.json');
  const race = normalizeNascarLive(feed, num);
  return race ? [race] : null;
}
