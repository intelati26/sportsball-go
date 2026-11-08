import React, { useState, useEffect, useRef } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { gameProgress } from './progress.js';
import { OFFICIAL_SOURCES } from './officialApis.js';

/**
 * SPORTSBALL DASHBOARD v2
 * Standalone React + Vite Component
 * Features:
 *  - Top Live Ticker Banner
 *  - Direct ESPN API Football Plugin (NFL & CFB)
 *  - Plugin Manager Modal
 *  - Team sports, NASCAR/F1/IndyCar and golf widgets
 */

// date: 'YYYY-MM-DD' for a past day (history), or '' for today's live board.
// ---- Polling: fast while something is live, slow when idle, and backing off on errors ----
export const IDLE_POLL_MS = 60000; // no live games on the board
const MAX_BACKOFF_MS = 5 * 60000;

// Turns a bad HTTP response into an error that remembers any Retry-After (seconds).
export function httpError(res) {
  const err = new Error(`HTTP error! status: ${res.status}`);
  const retry = Number(res.headers?.get?.('Retry-After'));
  if (retry > 0) err.retryAfterMs = retry * 1000;
  return err;
}

// Runs fetchOnce() on a timer until the returned stop() is called.
//  - fetchOnce resolves true when something is live (poll fast), false otherwise (poll every 60 s)
//  - fetchOnce rejects on failure: wait 60 s, then double each time up to 5 min (a Retry-After
//    from the server wins if longer); the first success goes back to the normal pace.
//  - once: a single fetch and no timer (a past date never changes).
export function startPolling(fetchOnce, { fastMs, idleMs = IDLE_POLL_MS, once = false }) {
  let timer = null;
  let stopped = false;
  let failures = 0;

  const tick = async () => {
    let next;
    try {
      const live = await fetchOnce();
      failures = 0;
      next = live ? fastMs : idleMs;
    } catch (err) {
      failures += 1;
      next = Math.min(MAX_BACKOFF_MS, idleMs * 2 ** (failures - 1));
      if (err?.retryAfterMs) next = Math.min(MAX_BACKOFF_MS, Math.max(next, err.retryAfterMs));
    }
    if (!stopped && !once) timer = setTimeout(tick, next);
  };

  tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

export function useFootballScoreboard(league = 'nfl', pollIntervalMs = 5000, date = '') {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);
    const fetchScores = async () => {
      try {
        const domainParts = ['site', 'api', 'espn', 'com'];
        const host = domainParts.join('.');
        const url = `https://${host}/apis/site/v2/sports/football/${league}/scoreboard${date ? `?dates=${date.replace(/-/g, '')}` : ''}`;
        const res = await fetch(url);
        if (!res.ok) throw httpError(res);
        const data = await res.json();
        
        const normalized = (data.events || []).map((evt) => {
          const competition = evt.competitions?.[0] || {};
          const statusType = evt.status?.type || {};
          const competitors = competition.competitors || [];
          
          const homeTeam = competitors.find((c) => c.homeAway === 'home') || {};
          const awayTeam = competitors.find((c) => c.homeAway === 'away') || {};

          const isLive = statusType.state === 'in';
          const situation = competition.situation || {};

          let downDistance = '';
          if (isLive && situation.downText && situation.distance) {
            downDistance = `${situation.downText} & ${situation.distance}`;
            if (situation.possessionText) {
              downDistance += ` at ${situation.possessionText}`;
            }
          }

          return {
            id: evt.id,
            sport: 'Football',
            league: league.toUpperCase(),
            leagueSlug: league,
            sportSlug: 'football',
            regPeriods: 4,
            progress: gameProgress({
              state: statusType.state,
              period: evt.status?.period,
              clock: evt.status?.displayClock,
              regPeriods: 4,
              periodMins: 15,
            }),
            title: evt.name,
            status: isLive ? 'LIVE' : statusType.state === 'post' ? 'FINAL' : 'PREGAME',
            summary: {
              primaryLabel: evt.status?.type?.detail || 'Scheduled',
              secondaryLabel: downDistance || statusType.description || '',
              scoreOrLeader: `${awayTeam.team?.abbreviation || 'AWAY'} ${awayTeam.score || 0} - ${homeTeam.score || 0} ${homeTeam.team?.abbreviation || 'HOME'}`
            },
            details: {
              football: {
                quarter: evt.status?.period || 0,
                clock: evt.status?.displayClock || '0:00',
                down: situation.down || 0,
                distance: situation.distance || 0,
                possession: situation.possession || null,
                inRedZone: situation.isRedZone || false,
                teams: {
                  away: {
                    code: awayTeam.team?.abbreviation || 'AWAY',
                    name: awayTeam.team?.displayName || 'Away',
                    logo: awayTeam.team?.logo,
                    score: awayTeam.score || 0,
                    linescores: (awayTeam.linescores || []).map((l) => l.displayValue ?? l.value),
                  },
                  home: {
                    code: homeTeam.team?.abbreviation || 'HOME',
                    name: homeTeam.team?.displayName || 'Home',
                    logo: homeTeam.team?.logo,
                    score: homeTeam.score || 0,
                    linescores: (homeTeam.linescores || []).map((l) => l.displayValue ?? l.value),
                  }
                }
              }
            }
          };
        });

        if (isMounted) {
          setGames(normalized);
          setError(null);
          setLoading(false);
        }
        return normalized.some((g) => g.status === 'LIVE');
      } catch (err) {
        // Keep what is already on screen; only the error note changes.
        if (isMounted) {
          setError(err.message);
          setLoading(false);
        }
        throw err;
      }
    };

    // A past date never changes: one fetch, no timer.
    const stop = startPolling(fetchScores, { fastMs: pollIntervalMs, once: Boolean(date) });
    return () => {
      isMounted = false;
      stop();
    };
  }, [league, pollIntervalMs, date]);

  return { games, loading, error };
}

// NASCAR national series via ESPN's racing scoreboard (same date rules as football).
// Field names are read defensively: ESPN omits fields between sessions.
export const NASCAR_SERIES = {
  nascar: { slug: 'nascar-premier', name: 'NASCAR Cup Series', short: 'CUP', top: 5 },
  'nascar-oreilly': { slug: 'nascar-secondary', name: "NASCAR O'Reilly Auto Parts Series", short: "O'REILLY", top: 1 },
  'nascar-truck': { slug: 'nascar-truck', name: 'NASCAR Truck Series', short: 'TRUCK', top: 1 },
  f1: { slug: 'f1', name: 'Formula 1', short: 'F1', top: 5 },
  indycar: { slug: 'irl', name: 'IndyCar Series', short: 'INDYCAR', top: 5 },
};

const toDrivers = (comp = {}) =>
  (comp.competitors || [])
    .map((c) => ({
      id: c.id || c.athlete?.id,
      position: Number(c.order ?? c.position ?? 0) || 0,
      name: c.athlete?.displayName || c.athlete?.shortName || 'Driver',
      number: c.vehicle?.number || c.athlete?.number || '',
      winner: !!c.winner,
    }))
    .sort((a, b) => (a.position || 99) - (b.position || 99));

export function useNascarSeries(seriesId = 'nascar', pollIntervalMs = 15000, date = '', enabled = true) {
  const [races, setRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const slug = NASCAR_SERIES[seriesId]?.slug;

  useEffect(() => {
    if (!slug || !enabled) return undefined;
    let isMounted = true;
    setLoading(true);
    setRaces([]);
    const fetchRaces = async () => {
      try {
        const host = ['site', 'api', 'espn', 'com'].join('.');
        const url = `https://${host}/apis/site/v2/sports/racing/${slug}/scoreboard${
          date ? `?dates=${date.replace(/-/g, '')}` : ''
        }`;
        const res = await fetch(url);
        if (!res.ok) throw httpError(res);
        const data = await res.json();

        const normalized = (data.events || []).map((evt) => {
          const comps = evt.competitions || [];
          const typeText = (c) =>
            [c?.type?.abbreviation, c?.type?.text, c?.type?.name, c?.description].filter(Boolean).join(' ');
          const qual = comps.find((c) => /qual/i.test(typeText(c)));
          // ESPN does not always label the race: an unlabelled last session is the race.
          const lastComp = comps[comps.length - 1];
          const race =
            comps.find((c) => /race/i.test(typeText(c))) || (lastComp && lastComp !== qual ? lastComp : undefined);
          const evtState = evt.status?.type?.state;
          const stateOf = (c) => c?.status?.type?.state || (c === race ? evtState : undefined);

          // Phase: the race decides once it has started; otherwise qualifying.
          let phase = 'UPCOMING';
          let source = qual || race || lastComp;
          if (stateOf(race) === 'post') { phase = 'RESULT'; source = race; }
          else if (stateOf(race) === 'in') { phase = 'LIVE'; source = race; }
          else if (stateOf(qual) === 'in') { phase = 'QUALIFYING LIVE'; source = qual; }
          else if (stateOf(qual) === 'post') { phase = 'QUALIFYING'; source = qual; }

          // Drivers: from the session shown, else from any session that lists competitors.
          const driverSource = source?.competitors?.length ? source : comps.find((c) => c.competitors?.length);

          const poleDriver = toDrivers(qual)[0];
          return {
            id: evt.id,
            title: evt.name || evt.shortName || 'NASCAR race',
            track: evt.circuit?.fullName || evt.venues?.[0]?.fullName || '',
            phase,
            detail: source?.status?.type?.detail || source?.status?.type?.description || evt.status?.type?.detail || '',
            drivers: toDrivers(driverSource),
            pole: poleDriver && stateOf(qual) === 'post' ? poleDriver : null,
          };
        });

        if (isMounted) {
          setRaces(normalized);
          setError(null);
          setLoading(false);
        }
        return normalized.some((r) => r.phase === 'LIVE' || r.phase === 'QUALIFYING LIVE');
      } catch (err) {
        // Keep what is already on screen; only the error note changes.
        if (isMounted) {
          setError(err.message);
          setLoading(false);
        }
        throw err;
      }
    };

    // A past date never changes: one fetch, no timer.
    const stop = startPolling(fetchRaces, { fastMs: pollIntervalMs, once: Boolean(date) });
    return () => {
      isMounted = false;
      stop();
    };
  }, [slug, pollIntervalMs, date, enabled]);

  return { races, loading, error };
}

const driverLabel = (d) => `${d.number ? `#${d.number} ` : ''}${d.name}`;

const raceHasPinnedDriver = (race, favorites) =>
  race.drivers.some((d) => favorites.includes(driverKey(d.name)));

export const pinRacesFirst = (races, favorites) => [
  ...races.filter((r) => raceHasPinnedDriver(r, favorites)),
  ...races.filter((r) => !raceHasPinnedDriver(r, favorites)),
];

export function NascarCard({ race, seriesId = 'nascar', favorites = [], onToggleFavorite }) {
  const series = NASCAR_SERIES[seriesId];
  const [showField, setShowField] = useState(false);
  const pinnedDrivers = race.drivers.filter((d) => favorites.includes(driverKey(d.name)));
  const driverStar = (d) => {
    const on = favorites.includes(driverKey(d.name));
    return (
      <button
        style={{ ...styles.starBtn, fontSize: '15px', color: on ? '#facc15' : '#64748b' }}
        onClick={() => onToggleFavorite?.(driverKey(d.name))}
        title={on ? `Unpin ${d.name}` : `Pin ${d.name} to the top`}
        aria-pressed={on}
      >
        {on ? '★' : '☆'}
      </button>
    );
  };
  const isLive = race.phase === 'LIVE' || race.phase === 'QUALIFYING LIVE';
  const color = isLive ? '#e53e3e' : race.phase === 'RESULT' ? '#2f855a' : '#4a5568';
  const top = race.drivers.slice(0, series.top);

  // Cup: top 5 of whichever session applies. O'Reilly / Truck: one headline driver.
  const headline = { 'QUALIFYING': 'Pole', 'QUALIFYING LIVE': 'Pole (live)', LIVE: 'Leader', RESULT: 'Winner' }[race.phase];
  const label = { 'QUALIFYING': 'Qualifying', 'QUALIFYING LIVE': 'Qualifying · live', LIVE: 'Live', RESULT: 'Result' }[race.phase];
  const winner = race.phase === 'RESULT' ? race.drivers.find((d) => d.winner) || race.drivers[0] : null;

  return (
    <div style={{ ...styles.card, borderColor: pinnedDrivers.length ? '#facc15' : '#334155' }}>
      <div style={styles.cardHeader}>
        <span style={styles.leagueTag}>{series.short}{label ? ` · ${label.toUpperCase()}` : ''}</span>
        <span style={{ ...styles.statusTag, backgroundColor: color }}>
          {isLive ? '🔴 LIVE' : race.phase === 'RESULT' ? 'FINAL' : race.phase === 'UPCOMING' ? 'UPCOMING' : 'POLE SET'}
        </span>
      </div>
      <div style={styles.teamName}>{race.title}</div>
      {race.track && <div style={styles.pluginDesc}>{race.track}</div>}
      {race.detail && <div style={styles.situationBox}>{race.detail}</div>}

      {series.top > 1 && top.length > 0 && (
        <ol style={styles.driverList}>
          {top.map((d) => (
            <li key={d.id || d.name} style={styles.driverRow}>
              <span style={styles.driverPos}>{d.position || '–'}</span>
              <span>{driverLabel(d)}{d.winner ? ' 🏆' : ''}</span>
              {driverStar(d)}
            </li>
          ))}
        </ol>
      )}

      {series.top === 1 && headline && top.length > 0 && (
        <div style={styles.driverList}>
          <div style={styles.driverRow}>
            <span style={styles.headlineTag}>{headline}</span>
            <span>{driverLabel(winner || top[0])}{winner ? ' 🏆' : ''}</span>
          </div>
          {race.phase !== 'QUALIFYING' && race.phase !== 'QUALIFYING LIVE' && race.pole && (
            <div style={styles.driverRow}>
              <span style={styles.headlineTag}>Pole</span>
              <span>{driverLabel(race.pole)}</span>
            </div>
          )}
        </div>
      )}

      {pinnedDrivers.length > 0 && (
        <div style={styles.driverList}>
          {pinnedDrivers.map((d) => (
            <div key={d.id || d.name} style={styles.driverRow}>
              <span style={{ ...styles.headlineTag, color: '#facc15' }}>★ P{d.position || '–'}</span>
              <span>{driverLabel(d)}</span>
              {driverStar(d)}
            </div>
          ))}
        </div>
      )}

      {race.drivers.length > 0 && (
        <button style={styles.boxBtn} onClick={() => setShowField((v) => !v)}>
          {showField ? 'Hide field' : '📋 Full field (pin drivers)'}
        </button>
      )}
      {showField && (
        <ol style={{ ...styles.driverList, maxHeight: '260px', overflowY: 'auto' }}>
          {race.drivers.map((d) => (
            <li key={d.id || d.name} style={styles.driverRow}>
              <span style={styles.driverPos}>{d.position || '–'}</span>
              <span>{driverLabel(d)}</span>
              {driverStar(d)}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// Basketball and hockey: same ESPN scoreboard, simple team-vs-team games.
export const TEAM_FEEDS = {
  ncaab: { sport: 'basketball', league: 'mens-college-basketball', label: "NCAA Men's Basketball", tag: 'NCAAM', icon: '🏀', regPeriods: 2, query: 'groups=50&limit=200' },
  ncaaw: { sport: 'basketball', league: 'womens-college-basketball', label: "NCAA Women's Basketball", tag: 'NCAAW', icon: '🏀', regPeriods: 4, query: 'groups=50&limit=200' },
  ncaabase: { sport: 'baseball', league: 'college-baseball', label: 'NCAA Baseball', tag: 'NCAA BSB', icon: '⚾', regPeriods: 9, query: 'limit=200' },
  ncaasoft: { sport: 'baseball', league: 'college-softball', label: 'NCAA Softball', tag: 'NCAA SB', icon: '🥎', regPeriods: 7, query: 'limit=200' },
  ncaamhockey: { sport: 'hockey', league: 'mens-college-hockey', label: "NCAA Men's Hockey", tag: 'NCAAM HKY', icon: '🏒', regPeriods: 3, query: 'limit=200' },
  ncaawhockey: { sport: 'hockey', league: 'womens-college-hockey', label: "NCAA Women's Hockey", tag: 'NCAAW HKY', icon: '🏒', regPeriods: 3, query: 'limit=200' },
  ncaamsoccer: { sport: 'soccer', league: 'usa.ncaa.m.1', label: "NCAA Men's Soccer", tag: 'NCAAM SOC', icon: '⚽', regPeriods: 2, query: 'limit=200' },
  ncaawsoccer: { sport: 'soccer', league: 'usa.ncaa.w.1', label: "NCAA Women's Soccer", tag: 'NCAAW SOC', icon: '⚽', regPeriods: 2, query: 'limit=200' },
  ncaawvolley: { sport: 'volleyball', league: 'womens-college-volleyball', label: "NCAA Women's Volleyball", tag: 'NCAAW VB', icon: '🏐', regPeriods: 5, query: 'limit=200' },
  ncaamvolley: { sport: 'volleyball', league: 'mens-college-volleyball', label: "NCAA Men's Volleyball", tag: 'NCAAM VB', icon: '🏐', regPeriods: 5, query: 'limit=200' },
  ncaamlax: { sport: 'lacrosse', league: 'mens-college-lacrosse', label: "NCAA Men's Lacrosse", tag: 'NCAAM LAX', icon: '🥍', regPeriods: 4, query: 'limit=200' },
  ncaawlax: { sport: 'lacrosse', league: 'womens-college-lacrosse', label: "NCAA Women's Lacrosse", tag: 'NCAAW LAX', icon: '🥍', regPeriods: 2, query: 'limit=200' },
  nhl: { sport: 'hockey', league: 'nhl', label: 'NHL Hockey', tag: 'NHL', icon: '🏒', regPeriods: 3, query: '' },
  nba: { sport: 'basketball', league: 'nba', label: 'NBA Basketball', tag: 'NBA', icon: '🏀', regPeriods: 4, query: '' },
  wnba: { sport: 'basketball', league: 'wnba', label: 'WNBA Basketball', tag: 'WNBA', icon: '🏀', regPeriods: 4, query: '' },
  mlb: { sport: 'baseball', league: 'mlb', label: 'MLB Baseball', tag: 'MLB', icon: '⚾', regPeriods: 9, query: '' },
  mls: { sport: 'soccer', league: 'usa.1', label: 'MLS', tag: 'MLS', icon: '⚽', regPeriods: 2, query: '' },
  epl: { sport: 'soccer', league: 'eng.1', label: 'Premier League', tag: 'EPL', icon: '⚽', regPeriods: 2, query: '' },
  laliga: { sport: 'soccer', league: 'esp.1', label: 'La Liga', tag: 'LA LIGA', icon: '⚽', regPeriods: 2, query: '' },
  bundesliga: { sport: 'soccer', league: 'ger.1', label: 'Bundesliga', tag: 'BUNDES', icon: '⚽', regPeriods: 2, query: '' },
  seriea: { sport: 'soccer', league: 'ita.1', label: 'Serie A', tag: 'SERIE A', icon: '⚽', regPeriods: 2, query: '' },
  ligue1: { sport: 'soccer', league: 'fra.1', label: 'Ligue 1', tag: 'LIGUE 1', icon: '⚽', regPeriods: 2, query: '' },
  ligamx: { sport: 'soccer', league: 'mex.1', label: 'Liga MX', tag: 'LIGA MX', icon: '⚽', regPeriods: 2, query: '' },
  ucl: { sport: 'soccer', league: 'uefa.champions', label: 'Champions League', tag: 'UCL', icon: '⚽', regPeriods: 2, query: '' },
  worldcup: { sport: 'soccer', league: 'fifa.world', label: 'FIFA World Cup', tag: 'WORLD CUP', icon: '🌍', regPeriods: 2, query: '' },
  cfl: { sport: 'football', league: 'cfl', label: 'CFL Football', tag: 'CFL', icon: '🏈', regPeriods: 4, query: '' },
  ufl: { sport: 'football', league: 'ufl', label: 'UFL Football', tag: 'UFL', icon: '🏈', regPeriods: 4, query: '' },
};

// Shown on by default; the rest are one tap away in the plugin manager.
const DEFAULT_PLUGINS = ['nfl', 'cfb', 'ncaab', 'nba', 'nhl', 'nascar', 'nascar-oreilly', 'nascar-truck'];

const OFFICIAL_RETRY_MS = 5 * 60000;
const officialDownUntil = {};

// ESPN scoreboard (backup source) for team-vs-team feeds.
async function fetchEspnTeamGames(feed, date) {
  const host = ['site', 'api', 'espn', 'com'].join('.');
  const params = [feed.query, date ? `dates=${date.replace(/-/g, '')}` : ''].filter(Boolean).join('&');
  const url = `https://${host}/apis/site/v2/sports/${feed.sport}/${feed.league}/scoreboard${params ? `?${params}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw httpError(res);
  const data = await res.json();
  return (data.events || []).map((evt) => {
    const comp = evt.competitions?.[0] || {};
    const statusType = evt.status?.type || {};
    const competitors = comp.competitors || [];
    const side = (ha) => {
      const c = competitors.find((x) => x.homeAway === ha) || {};
      return {
        code: c.team?.abbreviation || ha.toUpperCase(),
        name: c.team?.displayName || ha,
        logo: c.team?.logo,
        score: c.score || 0,
        linescores: (c.linescores || []).map((l) => l.displayValue ?? l.value),
      };
    };
    const away = side('away');
    const home = side('home');
    const isLive = statusType.state === 'in';
    return {
      id: evt.id,
      source: 'espn',
      sportSlug: feed.sport,
      leagueSlug: feed.league,
      regPeriods: feed.regPeriods,
      league: feed.tag,
      title: evt.name,
      status: isLive ? 'LIVE' : statusType.state === 'post' ? 'FINAL' : 'PREGAME',
      summary: {
        primaryLabel: statusType.detail || 'Scheduled',
        secondaryLabel: '',
        scoreOrLeader: `${away.code} ${away.score} - ${home.score} ${home.code}`,
      },
      progress: gameProgress({
        state: statusType.state,
        period: evt.status?.period,
        clock: evt.status?.displayClock,
        regPeriods: feed.regPeriods,
        periodMins: periodMinutesFor(feed),
        countsUp: feed.sport === 'soccer',
      }),
      details: {},
      teams: { away, home },
    };
  });
}

export function useTeamScoreboard(feedId, pollIntervalMs = 10000, date = '', enabled = true) {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const feed = TEAM_FEEDS[feedId];

  useEffect(() => {
    if (!feed || !enabled) return undefined; // off in the plugin manager: no requests
    let isMounted = true;
    setLoading(true);
    setGames([]);
    const fetchScores = async () => {
      try {
        // Official league API first; ESPN is only the backup (on any error from the official feed).
        const official = OFFICIAL_SOURCES[feedId];
        let normalized = null;
        if (official && Date.now() >= (officialDownUntil[feedId] || 0)) {
          try {
            normalized = await official.fetch(feed, date);
            officialDownUntil[feedId] = 0;
          } catch (e) {
            // Back off the official feed for a while so a blocked/down API isn't hit every poll.
            officialDownUntil[feedId] = Date.now() + OFFICIAL_RETRY_MS;
            normalized = null; // fall through to ESPN
          }
        }
        if (!normalized) normalized = await fetchEspnTeamGames(feed, date);

        if (isMounted) {
          setGames(normalized);
          setError(null);
          setLoading(false);
        }
        return normalized.some((g) => g.status === 'LIVE');
      } catch (err) {
        // Keep what is already on screen; only the error note changes.
        if (isMounted) {
          setError(err.message);
          setLoading(false);
        }
        throw err;
      }
    };

    // A past date never changes: one fetch, no timer.
    const stop = startPolling(fetchScores, { fastMs: pollIntervalMs, once: Boolean(date) });
    return () => {
      isMounted = false;
      stop();
    };
  }, [feedId, pollIntervalMs, date, enabled]);

  return { games, loading, error };
}

// ---- Golf: PGA / LPGA tournament leaderboards ----
export const GOLF_TOURS = {
  pga: { slug: 'pga', name: 'PGA Tour', short: 'PGA' },
  lpga: { slug: 'lpga', name: 'LPGA Tour', short: 'LPGA' },
};
export const playerKey = (name) => `player:${name}`;

export function useGolfTour(tourId = 'pga', pollIntervalMs = 30000, date = '', enabled = true) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const slug = GOLF_TOURS[tourId]?.slug;

  useEffect(() => {
    if (!slug || !enabled) return undefined;
    let isMounted = true;
    setLoading(true);
    setEvents([]);
    const fetchEvents = async () => {
      try {
        const host = ['site', 'api', 'espn', 'com'].join('.');
        const url = `https://${host}/apis/site/v2/sports/golf/${slug}/scoreboard${
          date ? `?dates=${date.replace(/-/g, '')}` : ''
        }`;
        const res = await fetch(url);
        if (!res.ok) throw httpError(res);
        const data = await res.json();

        const normalized = (data.events || []).map((evt) => {
          const comp = evt.competitions?.[0] || {};
          const statusType = evt.status?.type || comp.status?.type || {};
          const players = (comp.competitors || [])
            .map((c, i) => ({
              id: c.id || c.athlete?.id,
              position: Number(c.order ?? c.sortOrder ?? i + 1) || i + 1,
              name: c.athlete?.displayName || c.athlete?.shortName || 'Player',
              score: c.score?.displayValue ?? c.score ?? '',
              thru: c.status?.thru ?? c.status?.displayThru ?? '',
            }))
            .sort((a, b) => a.position - b.position);
          return {
            id: evt.id,
            title: evt.name || evt.shortName || 'Tournament',
            course: comp.venue?.fullName || evt.courses?.[0]?.name || '',
            status: statusType.state === 'in' ? 'LIVE' : statusType.state === 'post' ? 'FINAL' : 'UPCOMING',
            detail: statusType.detail || statusType.description || '',
            players,
          };
        });

        if (isMounted) {
          setEvents(normalized);
          setError(null);
          setLoading(false);
        }
        return normalized.some((e) => e.status === 'LIVE');
      } catch (err) {
        if (isMounted) {
          setError(err.message);
          setLoading(false);
        }
        throw err;
      }
    };

    const stop = startPolling(fetchEvents, { fastMs: pollIntervalMs, once: Boolean(date) });
    return () => {
      isMounted = false;
      stop();
    };
  }, [slug, pollIntervalMs, date, enabled]);

  return { events, loading, error };
}

const eventHasPinnedPlayer = (e, favorites) =>
  e.players.some((p) => favorites.includes(playerKey(p.name)));

export const pinEventsFirst = (events, favorites) => [
  ...events.filter((e) => eventHasPinnedPlayer(e, favorites)),
  ...events.filter((e) => !eventHasPinnedPlayer(e, favorites)),
];

export function GolfCard({ event, tourId = 'pga', favorites = [], onToggleFavorite }) {
  const tour = GOLF_TOURS[tourId];
  const [showAll, setShowAll] = useState(false);
  const isLive = event.status === 'LIVE';
  const pinned = event.players.filter((p) => favorites.includes(playerKey(p.name)));
  const top = event.players.slice(0, 10);
  const rows = showAll ? event.players : top;
  const star = (pl) => {
    const on = favorites.includes(playerKey(pl.name));
    return (
      <button
        style={{ ...styles.starBtn, fontSize: '15px', color: on ? '#facc15' : '#64748b' }}
        onClick={() => onToggleFavorite?.(playerKey(pl.name))}
        title={on ? `Unpin ${pl.name}` : `Pin ${pl.name} to the top`}
        aria-pressed={on}
      >
        {on ? '★' : '☆'}
      </button>
    );
  };
  const row = (pl) => (
    <li key={pl.id || pl.name} style={styles.driverRow}>
      <span style={styles.driverPos}>{pl.position}</span>
      <span style={{ flex: 1 }}>{pl.name}</span>
      <span style={styles.pluginDesc}>{pl.thru ? `thru ${pl.thru}` : ''}</span>
      <span style={{ fontWeight: 'bold', width: '36px', textAlign: 'right' }}>{pl.score}</span>
      {star(pl)}
    </li>
  );

  return (
    <div style={{ ...styles.card, borderColor: pinned.length ? '#facc15' : '#334155' }}>
      <div style={styles.cardHeader}>
        <span style={styles.leagueTag}>{tour.short}</span>
        <span style={{ ...styles.statusTag, backgroundColor: isLive ? '#e53e3e' : event.status === 'FINAL' ? '#2f855a' : '#4a5568' }}>
          {isLive ? '🔴 LIVE' : event.status}
        </span>
      </div>
      <div style={styles.teamName}>{event.title}</div>
      {event.course && <div style={styles.pluginDesc}>{event.course}</div>}
      {event.detail && <div style={styles.situationBox}>{event.detail}</div>}

      {pinned.length > 0 && (
        <ol style={styles.driverList}>
          {pinned.map((pl) => (
            <li key={pl.id || pl.name} style={{ ...styles.driverRow, color: '#facc15' }}>
              <span style={styles.driverPos}>{pl.position}</span>
              <span style={{ flex: 1 }}>★ {pl.name}</span>
              <span style={{ fontWeight: 'bold' }}>{pl.score}</span>
            </li>
          ))}
        </ol>
      )}
      {rows.length > 0 && (
        <ol style={{ ...styles.driverList, maxHeight: showAll ? '320px' : 'none', overflowY: 'auto' }}>
          {rows.map(row)}
        </ol>
      )}
      {event.players.length > 10 && (
        <button style={styles.boxBtn} onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show top 10' : `📋 Full field (${event.players.length}) — pin players`}
        </button>
      )}
    </div>
  );
}

// ---- How far through a game is (0..1), so the ticker can lead with games about to finish ----
export { gameProgress };

const periodMinutesFor = (feed) =>
  ({ hockey: 20, soccer: 45, football: 15, lacrosse: 15 })[feed.sport] ??
  (feed.sport === 'basketball' ? (feed.regPeriods === 2 ? 20 : feed.league === 'nba' ? 12 : 10) : null);

// Ticker order: live games nearest the finish first (pinned teams win ties), then the rest.
export function tickerOrder(games, favorites = [], limit = 40) {
  const live = games.filter((g) => g.status === 'LIVE');
  const pool = live.length
    ? live
    : games.filter((g) => g.status === 'FINAL').concat(games.filter((g) => g.status === 'PREGAME'));
  return pool
    .map((g, i) => ({ g, i, fav: isFavoriteGame(g, favorites) }))
    .sort((a, b) => (b.g.progress ?? 0) - (a.g.progress ?? 0) || Number(b.fav) - Number(a.fav) || a.i - b.i)
    .map((x) => x.g)
    .slice(0, limit);
}

const TICKER_CSS = `
@keyframes sportsball-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.sportsball-marquee { display: flex; width: max-content; animation: sportsball-marquee var(--marquee-secs, 60s) linear infinite; }
.sportsball-marquee:hover { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) { .sportsball-marquee { animation: none; } }
`;

// Scrolls on its own (pauses on hover/touch-hold). Pass games already ordered by priority.
export function TickerBanner({ games = [] }) {
  if (!games || games.length === 0) return null;
  const anyLive = games.some((g) => g.status === 'LIVE');
  const items = games.map((g) => {
    const isLive = g.status === 'LIVE';
    return (
      <div key={g.id} style={styles.tickerItem}>
        <span style={{ ...styles.tickerStatus, backgroundColor: isLive ? '#e53e3e' : '#4a5568' }}>
          {isLive ? '🔴 LIVE' : g.status}
        </span>
        <span style={styles.tickerLeague}>{g.league}</span>
        <span style={styles.tickerScore}>{g.summary?.scoreOrLeader}</span>
        {(g.summary?.secondaryLabel || (isLive && g.summary?.primaryLabel)) && (
          <span style={styles.tickerDetail}>({g.summary.secondaryLabel || g.summary.primaryLabel})</span>
        )}
      </div>
    );
  });
  // Two copies side by side so the loop is seamless; ~4 s per game keeps it readable.
  return (
    <div style={styles.tickerContainer}>
      <style>{TICKER_CSS}</style>
      <div style={styles.tickerBadge}>{anyLive ? 'LIVE · NEAREST FINISH FIRST' : 'SCORES'}</div>
      <div style={{ overflow: 'hidden', flex: 1 }}>
        <div className="sportsball-marquee" style={{ '--marquee-secs': `${Math.max(20, games.length * 4)}s` }}>
          <div style={styles.tickerHalf}>{items}</div>
          <div style={styles.tickerHalf} aria-hidden="true">{items}</div>
        </div>
      </div>
    </div>
  );
}

// ---- Alerts for pinned teams / drivers / players: scores, starts and finals ----
// Works while the app or tab is open (polling feeds it). A first sighting of a game is only a
// baseline, so opening the app never fires a burst of old news.
const ALERTS_KEY = 'sportsball.alertsOn';

export function useAlertsSetting() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(ALERTS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = async () => {
    const next = !on;
    if (next && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        /* in-app toasts still work */
      }
    }
    try {
      localStorage.setItem(ALERTS_KEY, next ? '1' : '0');
    } catch {
      /* not remembered */
    }
    setOn(next);
  };
  return [on, toggle];
}

// candidates: [{ id, status: 'PREGAME'|'LIVE'|'FINAL', scoreKey, describe(kind, prev) -> {title, body} }]
export function useScoreAlerts(candidates, enabled, onAlert) {
  const prevRef = useRef(new Map());
  useEffect(() => {
    const seen = new Set();
    candidates.forEach((c) => {
      seen.add(c.id);
      const p = prevRef.current.get(c.id);
      if (p && enabled) {
        let kind = null;
        if (c.status === 'FINAL' && p.status !== 'FINAL') kind = 'final';
        else if (c.status === 'LIVE' && p.status === 'PREGAME') kind = 'start';
        else if (c.status !== 'PREGAME' && c.scoreKey !== p.scoreKey) kind = 'score';
        if (kind) onAlert(c.describe(kind, p), c.id);
      }
      prevRef.current.set(c.id, c);
    });
    // Forget unpinned / gone games so pinning one later starts from a fresh baseline.
    [...prevRef.current.keys()].forEach((k) => {
      if (!seen.has(k)) prevRef.current.delete(k);
    });
  });
}

export function gameAlertCandidate(g) {
  const { away, home } = gameTeams(g);
  const num = (v) => Number(v) || 0;
  return {
    id: `g:${g.leagueSlug}:${g.id}`,
    status: g.status,
    scoreKey: `${away?.score}-${home?.score}`,
    away,
    home,
    describe(kind, prev) {
      const line = `${away?.code} ${away?.score} - ${home?.score} ${home?.code}`;
      if (kind === 'start') return { title: `▶ ${g.league}: game started`, body: `${away?.name} at ${home?.name}` };
      if (kind === 'final') return { title: `🏁 Final · ${g.league}`, body: line };
      const scorer =
        num(away?.score) > num(prev?.away?.score) ? away : num(home?.score) > num(prev?.home?.score) ? home : null;
      return {
        title: `${scorer ? `★ ${scorer.code} scores` : `Score update`} · ${g.league}`,
        body: `${line}${g.summary?.primaryLabel ? ` · ${g.summary.primaryLabel}` : ''}`,
      };
    },
  };
}

// Races and tournaments: start and final only (positions change too often to announce).
export function fieldAlertCandidate({ id, status, title, pinned, noun }) {
  const list = pinned.map((x) => `★ ${x.name} ${x.position ? `P${x.position}` : ''}${x.score ? ` (${x.score})` : ''}`).join(', ');
  return {
    id,
    status,
    scoreKey: '',
    describe(kind) {
      return kind === 'final'
        ? { title: `🏁 Final · ${title}`, body: list }
        : { title: `▶ ${noun} underway · ${title}`, body: list };
    },
  };
}

// Football games keep teams under details.football; other sports put them at game.teams.
const gameTeams = (g) => g.teams || g.details?.football?.teams || {};

// ---- Android: favorites + persistent background watcher (native foreground service) ----
// Favorites are also kept in the app's native storage, which Android Auto Backup restores
// after a reinstall. In a browser or on desktop these are all no-ops.
export const nativeWatcher = Capacitor.isNativePlatform() ? registerPlugin('Watcher') : null;

// What the background service needs to know, built from the pins and the switched-on widgets.
export function buildWatchConfig(favorites, activePlugins) {
  const feedForLeague = (league) => {
    if (league === 'nfl') return activePlugins.includes('nfl') ? { sport: 'football', league, query: '' } : null;
    if (league === 'college-football') return activePlugins.includes('cfb') ? { sport: 'football', league, query: '' } : null;
    const hit = Object.entries(TEAM_FEEDS).find(([, f]) => f.league === league);
    return hit && activePlugins.includes(hit[0]) ? { sport: hit[1].sport, league, query: hit[1].query } : null;
  };
  const teams = favorites
    .filter((k) => !k.startsWith('driver:') && !k.startsWith('player:'))
    .map((k) => {
      const i = k.indexOf(':');
      const feed = feedForLeague(k.slice(0, i));
      return feed ? { ...feed, code: k.slice(i + 1) } : null;
    })
    .filter(Boolean);
  return {
    teams,
    drivers: favorites.filter((k) => k.startsWith('driver:')).map((k) => k.slice(7)),
    players: favorites.filter((k) => k.startsWith('player:')).map((k) => k.slice(7)),
    racing: Object.entries(NASCAR_SERIES).filter(([id]) => activePlugins.includes(id)).map(([, sr]) => sr.slug),
    golf: Object.entries(GOLF_TOURS).filter(([id]) => activePlugins.includes(id)).map(([, t]) => t.slug),
  };
}

// ---- Favorites (pinned teams and drivers), remembered on this device ----
const FAV_KEY = 'sportsball.favoriteTeams';
export const teamKey = (leagueSlug, code) => `${leagueSlug}:${code}`;
export const driverKey = (name) => `driver:${name}`;

export function useFavorites() {
  const [favorites, setFavorites] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const [nativeReady, setNativeReady] = useState(!nativeWatcher);
  const [watcherOn, setWatcherOn] = useState(false);

  const remember = (list) => {
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(list));
    } catch {
      /* storage unavailable: pins last for this session only */
    }
  };

  // Android: merge in what native storage kept (e.g. restored after a reinstall).
  useEffect(() => {
    if (!nativeWatcher) return;
    nativeWatcher
      .getState()
      .then((st) => {
        setWatcherOn(Boolean(st.enabled));
        setFavorites((prev) => {
          const merged = [...new Set([...prev, ...(st.favorites || [])])];
          remember(merged);
          return merged;
        });
      })
      .catch(() => {})
      .finally(() => setNativeReady(true));
  }, []);

  // Keep native storage in step, but only after the merge above so an empty list never wins.
  useEffect(() => {
    if (nativeWatcher && nativeReady) nativeWatcher.save({ favorites }).catch(() => {});
  }, [favorites, nativeReady]);

  const toggleFavorite = (key) =>
    setFavorites((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      remember(next);
      return next;
    });

  const toggleWatcher = async () => {
    if (!nativeWatcher) return;
    const next = !watcherOn;
    await nativeWatcher.setEnabled({ enabled: next });
    setWatcherOn(next);
  };

  return { favorites, toggleFavorite, nativeReady, watcherOn, toggleWatcher };
}

const isFavoriteGame = (g, favorites) => {
  const { away, home } = gameTeams(g);
  return (
    favorites.includes(teamKey(g.leagueSlug, away?.code)) ||
    favorites.includes(teamKey(g.leagueSlug, home?.code))
  );
};

// Pinned teams' games first; otherwise keep ESPN's order.
export const pinFavoritesFirst = (games, favorites) => [
  ...games.filter((g) => isFavoriteGame(g, favorites)),
  ...games.filter((g) => !isFavoriteGame(g, favorites)),
];

// ---- Box score: line score from the scoreboard, team stats + leaders from the game summary ----
function useGameSummary(game, enabled) {
  const [state, setState] = useState({ loading: false, error: null, data: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let isMounted = true;
    setState({ loading: true, error: null, data: null });
    (async () => {
      try {
        const host = ['site', 'api', 'espn', 'com'].join('.');
        const res = await fetch(
          `https://${host}/apis/site/v2/sports/${game.sportSlug || 'football'}/${game.leagueSlug}/summary?event=${game.id}`
        );
        if (!res.ok) throw httpError(res);
        const data = await res.json();
        if (isMounted) setState({ loading: false, error: null, data });
      } catch (err) {
        if (isMounted) setState({ loading: false, error: err.message, data: null });
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [enabled, game.id, game.leagueSlug]);
  return state;
}

export function BoxScore({ game }) {
  const { loading, error, data } = useGameSummary(game, game.source !== 'official');
  const { away, home } = gameTeams(game);
  const periods = Math.max(away?.linescores?.length || 0, home?.linescores?.length || 0);

  const boxTeams = data?.boxscore?.teams || [];
  const statsFor = (code) =>
    boxTeams.find((t) => t.team?.abbreviation === code)?.statistics || [];
  const awayStats = statsFor(away?.code);
  const homeStats = statsFor(home?.code);

  const playerGroups = data?.boxscore?.players || [];
  const leaders = playerGroups.flatMap((tp) =>
    (tp.statistics || []).map((cat) => {
      const top = cat.athletes?.[0];
      return top
        ? {
            key: `${tp.team?.abbreviation}-${cat.name}`,
            team: tp.team?.abbreviation,
            category: cat.name,
            name: top.athlete?.displayName,
            line: (top.stats || []).join(' · '),
          }
        : null;
    })
  ).filter(Boolean);

  return (
    <div style={styles.boxScore}>
      {periods > 0 && (
        <table style={styles.boxTable}>
          <thead>
            <tr>
              <th style={styles.boxTeamCell} />
              {Array.from({ length: periods }, (_, i) => (
                <th key={i} style={styles.boxNum}>{i < (game.regPeriods || 4) ? i + 1 : 'OT'}</th>
              ))}
              <th style={styles.boxNum}>T</th>
            </tr>
          </thead>
          <tbody>
            {[away, home].map((t) => (
              <tr key={t?.code}>
                <td style={styles.boxTeamCell}>{t?.code}</td>
                {Array.from({ length: periods }, (_, i) => (
                  <td key={i} style={styles.boxNum}>{t?.linescores?.[i] ?? '–'}</td>
                ))}
                <td style={{ ...styles.boxNum, fontWeight: 800 }}>{t?.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {loading && <div style={styles.pluginDesc}>Loading box score…</div>}
      {error && <div style={styles.pluginDesc}>Full box score unavailable ({error}).</div>}

      {awayStats.length > 0 && (
        <table style={styles.boxTable}>
          <thead>
            <tr>
              <th style={styles.boxNum}>{away?.code}</th>
              <th style={styles.boxStatCell} />
              <th style={styles.boxNum}>{home?.code}</th>
            </tr>
          </thead>
          <tbody>
            {awayStats.map((st, i) => (
              <tr key={st.name || i}>
                <td style={styles.boxNum}>{st.displayValue}</td>
                <td style={styles.boxStatCell}>{st.label || st.name}</td>
                <td style={styles.boxNum}>
                  {homeStats.find((h) => h.name === st.name)?.displayValue ?? '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {leaders.length > 0 && (
        <div style={styles.leaderList}>
          {leaders.map((l) => (
            <div key={l.key} style={styles.leaderRow}>
              <span style={{ ...styles.headlineTag, width: '110px' }}>{l.team} {l.category}</span>
              <span>{l.name} <span style={styles.pluginDesc}>{l.line}</span></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function FootballCard({ game, favorites = [], onToggleFavorite }) {
  const fb = game.details?.football || {};
  const { away, home } = gameTeams(game);
  const isLive = game.status === 'LIVE';
  const [showBox, setShowBox] = useState(false);
  const pinned = isFavoriteGame(game, favorites);
  const star = (t) => {
    const k = teamKey(game.leagueSlug, t?.code);
    const on = favorites.includes(k);
    return (
      <button
        style={{ ...styles.starBtn, color: on ? '#facc15' : '#64748b' }}
        onClick={() => onToggleFavorite?.(k)}
        title={on ? `Unpin ${t?.name}` : `Pin ${t?.name} to the top`}
        aria-pressed={on}
      >
        {on ? '★' : '☆'}
      </button>
    );
  };

  return (
    <div style={{
      ...styles.card,
      borderColor: fb.inRedZone ? '#f56565' : pinned ? '#facc15' : '#2d3748',
      boxShadow: fb.inRedZone ? '0 0 12px rgba(245, 101, 101, 0.4)' : 'none'
    }}>
      <div style={styles.cardHeader}>
        <span style={styles.leagueTag}>{game.league}</span>
        {fb.inRedZone && <span style={styles.redZoneBadge}>🚨 RED ZONE</span>}
        <span style={{
          ...styles.statusTag,
          backgroundColor: isLive ? '#e53e3e' : game.status === 'FINAL' ? '#4a5568' : '#3182ce'
        }}>
          {game.summary?.primaryLabel || game.status}
        </span>
      </div>

      <div style={styles.matchupRow}>
        <div style={styles.teamCol}>
          {away?.logo ? <img src={away.logo} alt={away.code} style={styles.logo} /> : <div style={styles.logoPlaceholder}>{away?.code?.[0]}</div>}
          {star(away)}
          <span style={styles.teamName}>{away?.name}</span>
          <span style={styles.teamScore}>{away?.score}</span>
        </div>
        <div style={styles.vsCol}>VS</div>
        <div style={styles.teamCol}>
          <span style={styles.teamScore}>{home?.score}</span>
          <span style={styles.teamName}>{home?.name}</span>
          {star(home)}
          {home?.logo ? <img src={home.logo} alt={home.code} style={styles.logo} /> : <div style={styles.logoPlaceholder}>{home?.code?.[0]}</div>}
        </div>
      </div>

      {isLive && game.summary?.secondaryLabel && (
        <div style={styles.situationBox}>
          <span>🏈 {game.summary.secondaryLabel}</span>
        </div>
      )}

      {game.status !== 'PREGAME' && (
        <button style={styles.boxBtn} onClick={() => setShowBox((v) => !v)}>
          {showBox ? 'Hide box score' : '📋 Box score'}
        </button>
      )}
      {showBox && <BoxScore game={game} />}
    </div>
  );
}

const AVAILABLE_PLUGINS = [
  { id: 'nfl', name: 'NFL Football', category: 'Gridiron', desc: 'Live scores, clock & down/distance' },
  { id: 'cfb', name: 'College Football (CFB)', category: 'Gridiron', desc: 'AP Top 25 & FBS games' },
  ...Object.entries(TEAM_FEEDS).map(([id, f]) => ({
    id,
    name: f.label,
    category: f.league.includes('college') || f.league.includes('ncaa') ? 'NCAA' : f.sport === 'soccer' ? 'Soccer' : 'Pro',
    desc: 'Scores, line scores & box scores',
  })),
  ...Object.entries(NASCAR_SERIES).map(([id, sr]) => ({
    id,
    name: sr.name,
    category: 'Motorsport',
    desc: sr.top > 1 ? 'Qualifying / live / result top 5' : 'Pole / live leader / winner',
  })),
  ...Object.entries(GOLF_TOURS).map(([id, t]) => ({
    id,
    name: t.name,
    category: 'Golf',
    desc: 'Leaderboard with pinned players on top',
  })),
];

export function PluginModal({ isOpen, onClose, activePlugins, onTogglePlugin }) {
  if (!isOpen) return null;

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modalContent}>
        <div style={styles.modalHeader}>
          <h3 style={{ margin: 0 }}>🧩 Manage Sportsball Plugins</h3>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={styles.pluginList}>
          {AVAILABLE_PLUGINS.map((p) => {
            const isEnabled = activePlugins.includes(p.id);
            return (
              <div key={p.id} style={styles.pluginRow}>
                <div>
                  <div style={styles.pluginTitle}>{p.name} <span style={styles.categoryBadge}>{p.category}</span></div>
                  <div style={styles.pluginDesc}>{p.desc}</div>
                </div>
                <button
                  style={{
                    ...styles.toggleBtn,
                    backgroundColor: isEnabled ? '#38a169' : '#4a5568'
                  }}
                  onClick={() => onTogglePlugin(p.id)}
                >
                  {isEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function SportsballDashboard() {
  const [activePlugins, setActivePlugins] = useState(DEFAULT_PLUGINS);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { favorites, toggleFavorite, nativeReady, watcherOn, toggleWatcher } = useFavorites();
  const [selectedDate, setSelectedDate] = useState(''); // '' = today / live
  const isHistory = selectedDate !== '';
  const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

  const { games: nflGames, loading: nflLoading } = useFootballScoreboard('nfl', 5000, selectedDate);
  const { games: cfbGames, loading: cfbLoading } = useFootballScoreboard('college-football', 10000, selectedDate);
  // Fixed list of feeds, so the hook order never changes; switched-off feeds make no requests.
  const teamFeeds = Object.fromEntries(
    Object.keys(TEAM_FEEDS).map((id) => [
      id,
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useTeamScoreboard(id, 10000, selectedDate, activePlugins.includes(id)),
    ])
  );
  const nascarFeeds = Object.fromEntries(
    Object.keys(NASCAR_SERIES).map((id) => [
      id,
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useNascarSeries(id, 15000, selectedDate, activePlugins.includes(id)),
    ])
  );
  const golfFeeds = Object.fromEntries(
    Object.keys(GOLF_TOURS).map((id) => [
      id,
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useGolfTour(id, 30000, selectedDate, activePlugins.includes(id)),
    ])
  );
  const emptyText = (name) =>
    isHistory ? `No ${name} games on ${selectedDate}.` : `No live ${name} games right now.`;

  const allActiveGames = [
    ...(activePlugins.includes('nfl') ? nflGames : []),
    ...(activePlugins.includes('cfb') ? cfbGames : []),
    ...Object.keys(TEAM_FEEDS).flatMap((id) => (activePlugins.includes(id) ? teamFeeds[id].games : [])),
  ];

  const [alertsOn, toggleAlerts] = useAlertsSetting();
  const [toasts, setToasts] = useState([]);
  const pushAlert = (a, id) => {
    const toast = { key: `${id}-${Date.now()}`, ...a };
    setToasts((prev) => [...prev, toast].slice(-4));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.key !== toast.key)), 9000);
    try {
      if (!watcherOn && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(a.title, { body: a.body, tag: id });
      }
    } catch {
      /* some webviews cannot construct Notification: the toast above still shows */
    }
  };
  const alertCandidates = isHistory
    ? []
    : [
        ...allActiveGames.filter((g) => isFavoriteGame(g, favorites)).map(gameAlertCandidate),
        ...Object.entries(NASCAR_SERIES).flatMap(([sid, sr]) =>
          activePlugins.includes(sid)
            ? nascarFeeds[sid].races
                .map((r) => ({ r, pinned: r.drivers.filter((d) => favorites.includes(driverKey(d.name))) }))
                .filter((x) => x.pinned.length)
                .map(({ r, pinned }) =>
                  fieldAlertCandidate({
                    id: `r:${sid}:${r.id}`,
                    status: r.phase === 'RESULT' ? 'FINAL' : r.phase === 'LIVE' || r.phase === 'QUALIFYING LIVE' ? 'LIVE' : 'PREGAME',
                    title: r.title,
                    pinned,
                    noun: 'Race',
                  })
                )
            : []
        ),
        ...Object.keys(GOLF_TOURS).flatMap((gid) =>
          activePlugins.includes(gid)
            ? golfFeeds[gid].events
                .map((e) => ({ e, pinned: e.players.filter((pl) => favorites.includes(playerKey(pl.name))) }))
                .filter((x) => x.pinned.length)
                .map(({ e, pinned }) =>
                  fieldAlertCandidate({
                    id: `t:${gid}:${e.id}`,
                    status: e.status === 'UPCOMING' ? 'PREGAME' : e.status,
                    title: e.title,
                    pinned,
                    noun: 'Tournament',
                  })
                )
            : []
        ),
      ];
  useScoreAlerts(alertCandidates, alertsOn, pushAlert);

  // Tell the background service what to watch whenever pins or widgets change.
  useEffect(() => {
    if (nativeWatcher && nativeReady) {
      nativeWatcher.save({ config: buildWatchConfig(favorites, activePlugins) }).catch(() => {});
    }
  }, [favorites, activePlugins, nativeReady]);

  const skipTo = (id) =>
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const togglePlugin = (id) => {
    setActivePlugins((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  return (
    <div style={styles.container}>
      {!isHistory && <TickerBanner games={tickerOrder(allActiveGames, favorites)} />}

      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>🏟️ Sportsball Dashboard</h1>
          <p style={styles.subtitle}>Open-source live sports scoreboard & local ticker</p>
        </div>
        <div style={styles.dateControls}>
          <label style={styles.dateLabel}>
            📅
            <input
              type="date"
              style={styles.dateInput}
              value={selectedDate}
              max={todayStr}
              onChange={(e) => setSelectedDate(e.target.value)}
              aria-label="Show games on this date"
            />
          </label>
          {isHistory && (
            <button style={styles.todayBtn} onClick={() => setSelectedDate('')}>
              Today
            </button>
          )}
        </div>
        <button
          style={{ ...styles.todayBtn, backgroundColor: alertsOn ? '#2f855a' : '#334155', marginRight: '12px' }}
          onClick={toggleAlerts}
          aria-pressed={alertsOn}
          title="Alerts for pinned teams, drivers and players: scores, starts and finals"
        >
          🔔 Alerts {alertsOn ? 'on' : 'off'}
        </button>
        {nativeWatcher && (
          <button
            style={{ ...styles.todayBtn, backgroundColor: watcherOn ? '#2f855a' : '#334155', marginRight: '12px' }}
            onClick={toggleWatcher}
            aria-pressed={watcherOn}
            title="Keep watching your pins with the app closed (shows a persistent notification)"
          >
            📡 Background {watcherOn ? 'on' : 'off'}
          </button>
        )}
        <button style={styles.pluginMgrBtn} onClick={() => setIsModalOpen(true)}>
          ⚙️ Manage Plugins ({activePlugins.length})
        </button>
      </header>

      <nav style={styles.skipNav} aria-label="Skip to a widget">
        <button style={styles.skipBtn} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          ↑ Top
        </button>
        {AVAILABLE_PLUGINS.filter((pl) => activePlugins.includes(pl.id)).map((pl) => (
          <button key={pl.id} style={styles.skipBtn} onClick={() => skipTo(pl.id)}>
            {pl.name}
          </button>
        ))}
      </nav>

      <main style={styles.mainGrid}>
        {activePlugins.includes('nfl') && (
          <section id="section-nfl" style={styles.section}>
            <h2 style={styles.sectionTitle}>🏈 NFL Football</h2>
            <div style={styles.cardsGrid}>
              {nflGames.length > 0 ? (
                pinFavoritesFirst(nflGames, favorites).map((g) => (
                  <FootballCard key={g.id} game={g} favorites={favorites} onToggleFavorite={toggleFavorite} />
                ))
              ) : (
                <div style={styles.emptyCard}>{nflLoading ? 'Loading…' : emptyText('NFL')}</div>
              )}
            </div>
          </section>
        )}

        {activePlugins.includes('cfb') && (
          <section id="section-cfb" style={styles.section}>
            <h2 style={styles.sectionTitle}>🎓 College Football (CFB)</h2>
            <div style={styles.cardsGrid}>
              {cfbGames.length > 0 ? (
                pinFavoritesFirst(cfbGames, favorites).map((g) => (
                  <FootballCard key={g.id} game={g} favorites={favorites} onToggleFavorite={toggleFavorite} />
                ))
              ) : (
                <div style={styles.emptyCard}>{cfbLoading ? 'Loading…' : emptyText('CFB')}</div>
              )}
            </div>
          </section>
        )}

        {Object.keys(TEAM_FEEDS).map((id) => {
          const { games: list, loading: isLoading } = teamFeeds[id];
          return activePlugins.includes(id) ? (
            <section key={id} id={`section-${id}`} style={styles.section}>
              <h2 style={styles.sectionTitle}>{TEAM_FEEDS[id].icon} {TEAM_FEEDS[id].label}</h2>
              <div style={styles.cardsGrid}>
                {list.length > 0 ? (
                  pinFavoritesFirst(list, favorites).map((g) => (
                    <FootballCard key={g.id} game={g} favorites={favorites} onToggleFavorite={toggleFavorite} />
                  ))
                ) : (
                  <div style={styles.emptyCard}>
                    {isLoading ? 'Loading…' : isHistory ? `No ${TEAM_FEEDS[id].label} games on ${selectedDate}.` : `No ${TEAM_FEEDS[id].label} games today.`}
                  </div>
                )}
              </div>
            </section>
          ) : null;
        })}

        {Object.entries(NASCAR_SERIES).map(([id, series]) =>
          activePlugins.includes(id) ? (
            <section key={id} id={`section-${id}`} style={styles.section}>
              <h2 style={styles.sectionTitle}>🏎️ {series.name}</h2>
              <div style={styles.cardsGrid}>
                {nascarFeeds[id].races.length > 0 ? (
                  pinRacesFirst(nascarFeeds[id].races, favorites).map((r) => (
                    <NascarCard key={r.id} race={r} seriesId={id} favorites={favorites} onToggleFavorite={toggleFavorite} />
                  ))
                ) : (
                  <div style={styles.emptyCard}>
                    {nascarFeeds[id].loading
                      ? 'Loading…'
                      : isHistory
                        ? `No ${series.name} race on ${selectedDate}.`
                        : `No ${series.name} session on the schedule today.`}
                  </div>
                )}
              </div>
            </section>
          ) : null
        )}

        {Object.entries(GOLF_TOURS).map(([id, tour]) =>
          activePlugins.includes(id) ? (
            <section key={id} id={`section-${id}`} style={styles.section}>
              <h2 style={styles.sectionTitle}>⛳ {tour.name}</h2>
              <div style={styles.cardsGrid}>
                {golfFeeds[id].events.length > 0 ? (
                  pinEventsFirst(golfFeeds[id].events, favorites).map((e) => (
                    <GolfCard key={e.id} event={e} tourId={id} favorites={favorites} onToggleFavorite={toggleFavorite} />
                  ))
                ) : (
                  <div style={styles.emptyCard}>
                    {golfFeeds[id].loading
                      ? 'Loading…'
                      : isHistory
                        ? `No ${tour.name} event on ${selectedDate}.`
                        : `No ${tour.name} event this week.`}
                  </div>
                )}
              </div>
            </section>
          ) : null
        )}
      </main>

      <div style={styles.toastStack} aria-live="polite">
        {toasts.map((t) => (
          <div key={t.key} style={styles.toast}>
            <div style={{ fontWeight: 'bold' }}>{t.title}</div>
            <div style={styles.pluginDesc}>{t.body}</div>
          </div>
        ))}
      </div>

      <PluginModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        activePlugins={activePlugins}
        onTogglePlugin={togglePlugin}
      />
    </div>
  );
}

const styles = {
  container: { backgroundColor: '#0f172a', color: '#f8fafc', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' },
  tickerContainer: { display: 'flex', alignItems: 'center', backgroundColor: '#1e293b', borderBottom: '1px solid #334155', height: '40px', overflow: 'hidden' },
  tickerBadge: { backgroundColor: '#e53e3e', color: '#fff', fontWeight: 'bold', fontSize: '11px', padding: '0 12px', height: '100%', display: 'flex', alignItems: 'center' },
  tickerScrollTrack: { display: 'flex', gap: '24px', overflowX: 'auto', padding: '0 16px', whiteSpace: 'nowrap', alignItems: 'center' },
  tickerHalf: { display: 'flex', gap: '24px', alignItems: 'center', flexShrink: 0, paddingRight: '24px', paddingLeft: '8px' },
  tickerLeague: { fontSize: '10px', color: '#64748b', fontWeight: 'bold' },
  tickerItem: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' },
  tickerStatus: { fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' },
  tickerScore: { fontWeight: '600' },
  tickerDetail: { color: '#94a3b8', fontSize: '12px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 32px', borderBottom: '1px solid #1e293b' },
  title: { margin: 0, fontSize: '24px' },
  subtitle: { margin: '4px 0 0', color: '#94a3b8', fontSize: '14px' },
  toastStack: { position: 'fixed', right: '16px', bottom: '16px', display: 'flex', flexDirection: 'column', gap: '8px', zIndex: 2000, maxWidth: '340px' },
  toast: { backgroundColor: '#1e293b', border: '1px solid #facc15', borderRadius: '10px', padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,0.5)', fontSize: '13px' },
  dateControls: { display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto', marginRight: '16px' },
  dateLabel: { display: 'flex', alignItems: 'center', gap: '6px' },
  dateInput: { backgroundColor: '#1e293b', color: '#f8fafc', border: '1px solid #334155', borderRadius: '8px', padding: '8px 10px', colorScheme: 'dark' },
  todayBtn: { backgroundColor: '#2563eb', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' },
  driverList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px' },
  driverRow: { display: 'flex', gap: '10px' },
  headlineTag: { width: '56px', color: '#94a3b8', fontWeight: 'bold', fontSize: '12px', textTransform: 'uppercase' },
  driverPos: { width: '22px', color: '#94a3b8', fontWeight: 'bold', textAlign: 'right' },
  starBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', padding: 0, lineHeight: 1 },
  boxBtn: { backgroundColor: '#334155', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '12px' },
  boxScore: { display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '12px' },
  boxTable: { width: '100%', borderCollapse: 'collapse' },
  boxTeamCell: { textAlign: 'left', fontWeight: 'bold', padding: '3px 6px' },
  boxStatCell: { textAlign: 'center', color: '#94a3b8', padding: '3px 6px' },
  boxNum: { textAlign: 'center', padding: '3px 6px' },
  leaderList: { display: 'flex', flexDirection: 'column', gap: '4px' },
  leaderRow: { display: 'flex', gap: '10px' },
  pluginMgrBtn: { backgroundColor: '#334155', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' },
  mainGrid: { padding: '32px', display: 'flex', flexDirection: 'column', gap: '32px' },
  skipNav: { position: 'sticky', top: 0, zIndex: 50, display: 'flex', gap: '8px', overflowX: 'auto', padding: '10px 32px', backgroundColor: '#0f172a', borderBottom: '1px solid #1e293b' },
  skipBtn: { flex: '0 0 auto', backgroundColor: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: '999px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap' },
  section: { scrollMarginTop: '64px', display: 'flex', flexDirection: 'column', gap: '16px' },
  sectionTitle: { fontSize: '18px', color: '#cbd5e1', margin: 0 },
  cardsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' },
  card: { backgroundColor: '#1e293b', borderRadius: '12px', padding: '16px', border: '1px solid #334155', display: 'flex', flexDirection: 'column', gap: '12px' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  leagueTag: { fontSize: '11px', fontWeight: 'bold', color: '#94a3b8' },
  redZoneBadge: { backgroundColor: '#9b2c2c', color: '#fff', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' },
  statusTag: { color: '#fff', fontSize: '11px', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold' },
  matchupRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0' },
  teamCol: { display: 'flex', alignItems: 'center', gap: '8px', flex: 1 },
  vsCol: { color: '#64748b', fontWeight: 'bold', padding: '0 8px' },
  teamName: { fontWeight: 'bold', fontSize: '15px' },
  teamScore: { fontSize: '20px', fontWeight: '800', marginLeft: 'auto', marginRight: 'auto' },
  logo: { width: '28px', height: '28px', objectFit: 'contain' },
  logoPlaceholder: { width: '28px', height: '28px', backgroundColor: '#334155', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' },
  situationBox: { backgroundColor: '#0f172a', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', color: '#cbd5e1', textAlign: 'center' },
  emptyCard: { backgroundColor: '#1e293b', color: '#94a3b8', borderRadius: '12px', padding: '24px', textAlign: 'center', border: '1px dashed #334155' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modalContent: { backgroundColor: '#1e293b', borderRadius: '16px', padding: '24px', width: '480px', maxWidth: '90vw' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  closeBtn: { background: 'none', border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer' },
  pluginList: { display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '60vh', overflowY: 'auto' },
  pluginRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0f172a', padding: '12px 16px', borderRadius: '8px' },
  pluginTitle: { fontWeight: 'bold', fontSize: '14px' },
  categoryBadge: { fontSize: '10px', backgroundColor: '#334155', color: '#cbd5e1', padding: '2px 6px', borderRadius: '4px', marginLeft: '6px' },
  pluginDesc: { fontSize: '12px', color: '#94a3b8', marginTop: '2px' },
  toggleBtn: { border: 'none', color: '#fff', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' },
};
