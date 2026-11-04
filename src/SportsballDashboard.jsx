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
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
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
                  },
                  home: {
                    code: homeTeam.team?.abbreviation || 'HOME',
                    name: homeTeam.team?.displayName || 'Home',
                    logo: homeTeam.team?.logo,
                    score: homeTeam.score || 0,
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
      } catch (err) {
        if (isMounted) {
          setGames([]);
          setError(err.message);
          setLoading(false);
        }
      }
    };

    fetchScores();
    // A finished day never changes, so only poll the live board.
    const interval = date ? null : setInterval(fetchScores, pollIntervalMs);
    return () => {
      isMounted = false;
      if (interval) clearInterval(interval);
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
    const fetchRaces = async () => {
      try {
        const host = ['site', 'api', 'espn', 'com'].join('.');
        const url = `https://${host}/apis/site/v2/sports/racing/${slug}/scoreboard${
          date ? `?dates=${date.replace(/-/g, '')}` : ''
        }`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
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
      } catch (err) {
        if (isMounted) {
          setRaces([]);
          setError(err.message);
          setLoading(false);
        }
      }
    };

    fetchRaces();
    const interval = date ? null : setInterval(fetchRaces, pollIntervalMs);
    return () => {
      isMounted = false;
      if (interval) clearInterval(interval);
    };
  }, [slug, pollIntervalMs, date]);

  return { races, loading, error };
}

const driverLabel = (d) => `${d.number ? `#${d.number} ` : ''}${d.name}`;

export function NascarCard({ race, seriesId = 'nascar' }) {
  const series = NASCAR_SERIES[seriesId];
  const isLive = race.phase === 'LIVE' || race.phase === 'QUALIFYING LIVE';
  const color = isLive ? '#e53e3e' : race.phase === 'RESULT' ? '#2f855a' : '#4a5568';
  const top = race.drivers.slice(0, series.top);

  // Cup: top 5 of whichever session applies. O'Reilly / Truck: one headline driver.
  const headline = { 'QUALIFYING': 'Pole', 'QUALIFYING LIVE': 'Pole (live)', LIVE: 'Leader', RESULT: 'Winner' }[race.phase];
  const label = { 'QUALIFYING': 'Qualifying', 'QUALIFYING LIVE': 'Qualifying · live', LIVE: 'Live', RESULT: 'Result' }[race.phase];
  const winner = race.phase === 'RESULT' ? race.drivers.find((d) => d.winner) || race.drivers[0] : null;

  return (
    <div style={styles.card}>
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
    </div>
  );
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

export function FootballCard({ game }) {
  const fb = game.details?.football || {};
  const { away, home } = fb.teams || {};
  const isLive = game.status === 'LIVE';

  return (
    <div style={{
      ...styles.card,
      borderColor: fb.inRedZone ? '#f56565' : '#2d3748',
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
          <span style={styles.teamName}>{away?.name}</span>
          <span style={styles.teamScore}>{away?.score}</span>
        </div>
        <div style={styles.vsCol}>VS</div>
        <div style={styles.teamCol}>
          <span style={styles.teamScore}>{home?.score}</span>
          <span style={styles.teamName}>{home?.name}</span>
          {home?.logo ? <img src={home.logo} alt={home.code} style={styles.logo} /> : <div style={styles.logoPlaceholder}>{home?.code?.[0]}</div>}
        </div>
      </div>

      {isLive && game.summary?.secondaryLabel && (
        <div style={styles.situationBox}>
          <span>🏈 {game.summary.secondaryLabel}</span>
        </div>
      )}
    </div>
  );
}

const AVAILABLE_PLUGINS = [
  { id: 'nfl', name: 'NFL Football', category: 'Gridiron', desc: 'Live scores, clock & down/distance' },
  { id: 'cfb', name: 'College Football (CFB)', category: 'Gridiron', desc: 'AP Top 25 & FBS games' },
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
  const [activePlugins, setActivePlugins] = useState(['nfl', 'cfb', 'nascar', 'nascar-oreilly', 'nascar-truck']);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [selectedDate, setSelectedDate] = useState(''); // '' = today / live
  const isHistory = selectedDate !== '';
  const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

  const { games: nflGames, loading: nflLoading } = useFootballScoreboard('nfl', 5000, selectedDate);
  const { games: cfbGames, loading: cfbLoading } = useFootballScoreboard('college-football', 10000, selectedDate);
  const nascarCup = useNascarSeries('nascar', 15000, selectedDate);
  const nascarOreilly = useNascarSeries('nascar-oreilly', 15000, selectedDate);
  const nascarTruck = useNascarSeries('nascar-truck', 15000, selectedDate);
  const nascarFeeds = { nascar: nascarCup, 'nascar-oreilly': nascarOreilly, 'nascar-truck': nascarTruck };
  const emptyText = (name) =>
    isHistory ? `No ${name} games on ${selectedDate}.` : `No live ${name} games right now.`;

  const allActiveGames = [
    ...(activePlugins.includes('nfl') ? nflGames : []),
    ...(activePlugins.includes('cfb') ? cfbGames : []),
  ];

  const togglePlugin = (id) => {
    setActivePlugins((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  return (
    <div style={styles.container}>
      {!isHistory && <TickerBanner games={allActiveGames} />}

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
                nflGames.map((g) => <FootballCard key={g.id} game={g} />)
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
                cfbGames.map((g) => <FootballCard key={g.id} game={g} />)
              ) : (
                <div style={styles.emptyCard}>{cfbLoading ? 'Loading…' : emptyText('CFB')}</div>
              )}
            </div>
          </section>
        )}

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
                  nascarFeeds[id].races.map((r) => <NascarCard key={r.id} race={r} seriesId={id} />)
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
  pluginList: { display: 'flex', flexDirection: 'column', gap: '16px' },
  pluginRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0f172a', padding: '12px 16px', borderRadius: '8px' },
  pluginTitle: { fontWeight: 'bold', fontSize: '14px' },
  categoryBadge: { fontSize: '10px', backgroundColor: '#334155', color: '#cbd5e1', padding: '2px 6px', borderRadius: '4px', marginLeft: '6px' },
  pluginDesc: { fontSize: '12px', color: '#94a3b8', marginTop: '2px' },
  toggleBtn: { border: 'none', color: '#fff', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' },
};
