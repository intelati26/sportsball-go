// Ordering for the dashboard: which sports come first, and how games sort inside a sport.
// Pure functions so they can be tested without React.

export const SPORT_SORTS = [
  { id: 'default', label: 'Sports: default order' },
  { id: 'active', label: 'Sports: active first' },
];

export const GAME_SORTS = [
  { id: 'fav', label: 'Games: favorites first' },
  { id: 'hot', label: 'Games: red zone / close' },
  { id: 'finish', label: 'Games: nearest finish' },
];

const num = (v) => Number(v) || 0;

export const scoreMargin = (g) => {
  const t = g.teams || g.details?.football?.teams || {};
  return Math.abs(num(t.away?.score) - num(t.home?.score));
};

const inRedZone = (g) => Boolean(g.details?.football?.inRedZone);

const STATUS_TIER = { LIVE: 0, PREGAME: 1, FINAL: 2 };
const tierOf = (g) => STATUS_TIER[g.status] ?? 1;

// Sorts one sport's games. `isFav(game)` says whether a pinned team is playing.
//  fav:    pinned games first, otherwise the feed's order (the original behaviour)
//  hot:    live games first (red zone, then tightest score), then upcoming, then finals
//  finish: live games first, nearest the end first, then upcoming, then finals
// In hot/finish, pinned games lead within their status group.
export function sortGames(games, mode, isFav) {
  const rows = games.map((g, i) => ({ g, i, fav: isFav(g) }));
  const byFeed = (a, b) => a.i - b.i;
  const favFirst = (a, b) => Number(b.fav) - Number(a.fav);

  if (mode === 'hot' || mode === 'finish') {
    rows.sort((a, b) => {
      const t = tierOf(a.g) - tierOf(b.g);
      if (t) return t;
      const f = favFirst(a, b);
      if (f) return f;
      if (tierOf(a.g) === 0) {
        if (mode === 'hot') {
          const rz = Number(inRedZone(b.g)) - Number(inRedZone(a.g));
          if (rz) return rz;
          const m = scoreMargin(a.g) - scoreMargin(b.g);
          if (m) return m;
          const p = num(b.g.progress) - num(a.g.progress);
          if (p) return p;
        } else {
          const p = num(b.g.progress) - num(a.g.progress);
          if (p) return p;
          const m = scoreMargin(a.g) - scoreMargin(b.g);
          if (m) return m;
        }
      }
      return byFeed(a, b);
    });
  } else {
    rows.sort((a, b) => favFirst(a, b) || byFeed(a, b));
  }
  return rows.map((r) => r.g);
}

// How urgent a whole sport section is, from {status, pinned} items.
//  5 live with a pinned team/driver/player, 4 live, 3 pinned but not live,
//  2 upcoming, 1 finals only, 0 nothing to show
export function sectionRank(items) {
  if (!items.length) return 0;
  if (items.some((x) => x.status === 'LIVE' && x.pinned)) return 5;
  if (items.some((x) => x.status === 'LIVE')) return 4;
  if (items.some((x) => x.pinned)) return 3;
  if (items.some((x) => x.status === 'PREGAME')) return 2;
  return 1;
}

// sections: [{ id, items }] in default order. Returns ids in display order.
// 'active' sorts by rank (then number of live items), keeping default order for ties.
export function orderSections(sections, mode) {
  if (mode !== 'active') return sections.map((s) => s.id);
  const live = (s) => s.items.filter((x) => x.status === 'LIVE').length;
  return sections
    .map((s, i) => ({ id: s.id, i, rank: sectionRank(s.items), live: live(s) }))
    .sort((a, b) => b.rank - a.rank || b.live - a.live || a.i - b.i)
    .map((s) => s.id);
}

export const RANGES = [
  { id: 'week', label: 'View: week overview' },
  { id: 'today', label: 'View: today only' },
];

// Today filter: games starting on today's local calendar date, plus anything live right now
// (a game that began last night is still today's business). Items with no start time, such as
// races and tournaments, are never hidden.
export function isToday(item, now = new Date()) {
  if (item.status === 'LIVE') return true;
  if (!item.start) return true;
  const d = new Date(item.start);
  if (Number.isNaN(d.getTime())) return true;
  return d.toDateString() === now.toDateString();
}
