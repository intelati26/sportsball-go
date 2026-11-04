import React, { useState, useEffect } from 'react';

/**
 * SPORTSBALL DASHBOARD v2
 * Standalone React + Vite Component
 * Features:
 *  - Top Live Ticker Banner
 *  - Direct ESPN API Football Plugin (NFL & CFB)
 *  - Plugin Manager Modal
 *  - Offseason status for MLB & NASCAR
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

export function useNascarSeries(seriesId = 'nascar', pollIntervalMs = 15000, date = '') {
  const [races, setRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const slug = NASCAR_SERIES[seriesId]?.slug;

  useEffect(() => {
    if (!slug) return undefined;
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
          const qual = comps.find((c) => /qual/i.test(c.type?.abbreviation || c.type?.text || ''));
          const race = comps.find((c) => /race/i.test(c.type?.abbreviation || c.type?.text || ''));
          const stateOf = (c) => c?.status?.type?.state;

          // Phase: the race decides once it has started; otherwise qualifying.
          let phase = 'UPCOMING';
          let source = qual || race || comps[comps.length - 1];
          if (stateOf(race) === 'post') { phase = 'RESULT'; source = race; }
          else if (stateOf(race) === 'in') { phase = 'LIVE'; source = race; }
          else if (stateOf(qual) === 'in') { phase = 'QUALIFYING LIVE'; source = qual; }
          else if (stateOf(qual) === 'post') { phase = 'QUALIFYING'; source = qual; }

          const poleDriver = toDrivers(qual)[0];
          return {
            id: evt.id,
            title: evt.name || evt.shortName || 'NASCAR race',
            track: evt.circuit?.fullName || evt.venues?.[0]?.fullName || '',
            phase,
            detail: source?.status?.type?.detail || source?.status?.type?.description || '',
            drivers: toDrivers(source),
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
  }, [slug, pollIntervalMs, date]);

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
};

// Shown on by default; the rest are one tap away in the plugin manager.
const DEFAULT_PLUGINS = ['nfl', 'cfb', 'ncaab', 'nhl', 'nascar', 'nascar-oreilly', 'nascar-truck'];

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
        const host = ['site', 'api', 'espn', 'com'].join('.');
        const params = [feed.query, date ? `dates=${date.replace(/-/g, '')}` : ''].filter(Boolean).join('&');
        const url = `https://${host}/apis/site/v2/sports/${feed.sport}/${feed.league}/scoreboard${params ? `?${params}` : ''}`;
        const res = await fetch(url);
        if (!res.ok) throw httpError(res);
        const data = await res.json();

        const normalized = (data.events || []).map((evt) => {
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
            details: {},
            teams: { away, home },
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
  }, [feedId, pollIntervalMs, date, enabled]);

  return { games, loading, error };
}

export function TickerBanner({ games = [] }) {
  if (!games || games.length === 0) return null;

  return (
    <div style={styles.tickerContainer}>
      <div style={styles.tickerBadge}>LIVE TICKER</div>
      <div style={styles.tickerScrollTrack}>
        {games.map((g) => {
          const isLive = g.status === 'LIVE';
          return (
            <div key={g.id} style={styles.tickerItem}>
              <span style={{ ...styles.tickerStatus, backgroundColor: isLive ? '#e53e3e' : '#4a5568' }}>
                {isLive ? '🔴 LIVE' : g.status}
              </span>
              <span style={styles.tickerScore}>{g.summary?.scoreOrLeader}</span>
              {g.summary?.secondaryLabel && (
                <span style={styles.tickerDetail}>({g.summary.secondaryLabel})</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Football games keep teams under details.football; other sports put them at game.teams.
const gameTeams = (g) => g.teams || g.details?.football?.teams || {};

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
  const toggleFavorite = (key) =>
    setFavorites((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable: pins last for this session only */
      }
      return next;
    });
  return { favorites, toggleFavorite };
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
  const { loading, error, data } = useGameSummary(game, true);
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
    category: f.league.includes('college') || f.league.includes('ncaa') ? 'NCAA' : 'Pro',
    desc: 'Scores, line scores & box scores',
  })),
  { id: 'mlb', name: 'MLB Baseball', category: 'Baseball', desc: 'StatsAPI pitch-by-pitch (Offseason)' },
  { id: 'nascar', name: 'NASCAR Cup Series', category: 'Motorsport', desc: 'Qualifying / live / result top 5' },
  { id: 'nascar-oreilly', name: "NASCAR O'Reilly Series", category: 'Motorsport', desc: 'Pole / live leader / winner' },
  { id: 'nascar-truck', name: 'NASCAR Truck Series', category: 'Motorsport', desc: 'Pole / live leader / winner' },
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

  const { favorites, toggleFavorite } = useFavorites();
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
  const nascarCup = useNascarSeries('nascar', 15000, selectedDate);
  const nascarOreilly = useNascarSeries('nascar-oreilly', 15000, selectedDate);
  const nascarTruck = useNascarSeries('nascar-truck', 15000, selectedDate);
  const nascarFeeds = { nascar: nascarCup, 'nascar-oreilly': nascarOreilly, 'nascar-truck': nascarTruck };
  const emptyText = (name) =>
    isHistory ? `No ${name} games on ${selectedDate}.` : `No live ${name} games right now.`;

  const allActiveGames = [
    ...(activePlugins.includes('nfl') ? nflGames : []),
    ...(activePlugins.includes('cfb') ? cfbGames : []),
    ...Object.keys(TEAM_FEEDS).flatMap((id) => (activePlugins.includes(id) ? teamFeeds[id].games : [])),
  ];

  const togglePlugin = (id) => {
    setActivePlugins((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  return (
    <div style={styles.container}>
      {!isHistory && <TickerBanner games={pinFavoritesFirst(allActiveGames, favorites)} />}

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
        <button style={styles.pluginMgrBtn} onClick={() => setIsModalOpen(true)}>
          ⚙️ Manage Plugins ({activePlugins.length})
        </button>
      </header>

      <main style={styles.mainGrid}>
        {activePlugins.includes('nfl') && (
          <section style={styles.section}>
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
          <section style={styles.section}>
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
            <section key={id} style={styles.section}>
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

        {activePlugins.includes('mlb') && (
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>⚾ Major League Baseball</h2>
            <div style={styles.emptyCard}>
              MLB is currently in the offseason. Feed will auto-resume in Spring Training!
            </div>
          </section>
        )}

        {Object.entries(NASCAR_SERIES).map(([id, series]) =>
          activePlugins.includes(id) ? (
            <section key={id} style={styles.section}>
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
      </main>

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
  tickerItem: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' },
  tickerStatus: { fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' },
  tickerScore: { fontWeight: '600' },
  tickerDetail: { color: '#94a3b8', fontSize: '12px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 32px', borderBottom: '1px solid #1e293b' },
  title: { margin: 0, fontSize: '24px' },
  subtitle: { margin: '4px 0 0', color: '#94a3b8', fontSize: '14px' },
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
  section: { display: 'flex', flexDirection: 'column', gap: '16px' },
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
