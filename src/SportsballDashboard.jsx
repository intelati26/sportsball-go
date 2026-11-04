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

export function useFootballScoreboard(league = 'nfl', pollIntervalMs = 5000) {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const fetchScores = async () => {
      try {
        const domainParts = ['site', 'api', 'espn', 'com'];
        const host = domainParts.join('.');
        const url = `https://${host}/apis/site/v2/sports/football/${league}/scoreboard`;
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
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message);
          setLoading(false);
        }
      }
    };

    fetchScores();
    const interval = setInterval(fetchScores, pollIntervalMs);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [league, pollIntervalMs]);

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
  { id: 'nascar', name: 'NASCAR Cup Series', category: 'Motorsport', desc: 'Live flag status & leaderboard towers' },
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
  const [activePlugins, setActivePlugins] = useState(['nfl', 'cfb']);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { games: nflGames } = useFootballScoreboard('nfl', 5000);
  const { games: cfbGames } = useFootballScoreboard('college-football', 10000);

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
      <TickerBanner games={allActiveGames} />

      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>🏟️ Sportsball Dashboard</h1>
          <p style={styles.subtitle}>Open-source live sports scoreboard & local ticker</p>
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
                <div style={styles.emptyCard}>No live NFL games right now.</div>
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
                <div style={styles.emptyCard}>No live CFB games right now.</div>
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

        {activePlugins.includes('nascar') && (
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>🏎️ NASCAR Cup Series</h2>
            <div style={styles.emptyCard}>
              No active session. Next race timing feed will launch during practice/qualifying.
            </div>
          </section>
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
