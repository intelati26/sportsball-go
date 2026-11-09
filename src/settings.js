// One saved settings object (instead of a scatter of localStorage keys), plus the fold state.
import { useState } from 'react';
import { SPORT_SORTS, GAME_SORTS, RANGES } from './sorting.js';

export const SETTINGS_KEY = 'sportsball.settings.v1';
const COLLAPSED_KEY = 'sportsball.collapsed';

export const baseDefaults = {
  sportSort: 'default',
  gameSort: 'fav',
  range: 'week',
  activeOnly: false,
  officialFirst: true, // false = ESPN only
  plugins: [],
};

const pick = (v, list, fallback) => (list.some((x) => x.id === v) ? v : fallback);

// Reads and validates saved settings. `storage` is passed in so this stays testable.
// Settings saved by earlier versions (separate keys) are picked up once.
export function readSettings(storage, defaultPlugins = []) {
  const d = { ...baseDefaults, plugins: defaultPlugins };
  let raw = null;
  try {
    raw = JSON.parse(storage.getItem(SETTINGS_KEY) || 'null');
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object') {
    const legacy = (k) => {
      try {
        return storage.getItem(`sportsball.${k}`);
      } catch {
        return null;
      }
    };
    raw = {
      sportSort: legacy('sportSort'),
      gameSort: legacy('gameSort'),
      range: legacy('range'),
      activeOnly: legacy('activeOnly') === 'on' ? true : undefined,
    };
  }
  return {
    sportSort: pick(raw.sportSort, SPORT_SORTS, d.sportSort),
    gameSort: pick(raw.gameSort, GAME_SORTS, d.gameSort),
    range: pick(raw.range, RANGES, d.range),
    activeOnly: typeof raw.activeOnly === 'boolean' ? raw.activeOnly : d.activeOnly,
    officialFirst: typeof raw.officialFirst === 'boolean' ? raw.officialFirst : d.officialFirst,
    plugins: Array.isArray(raw.plugins) ? raw.plugins.filter((x) => typeof x === 'string') : d.plugins,
  };
}

export function useSettings(defaultPlugins) {
  const [settings, setSettings] = useState(() => {
    try {
      return readSettings(localStorage, defaultPlugins);
    } catch {
      return readSettings({ getItem: () => null }, defaultPlugins);
    }
  });
  const save = (next) => {
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: settings last for this session only */
    }
  };
  return {
    settings,
    update: (patch) => save({ ...settings, ...patch }),
    togglePlugin: (id) =>
      save({
        ...settings,
        plugins: settings.plugins.includes(id) ? settings.plugins.filter((p) => p !== id) : [...settings.plugins, id],
      }),
    setPlugins: (ids, on) =>
      save({
        ...settings,
        plugins: on ? [...new Set([...settings.plugins, ...ids])] : settings.plugins.filter((p) => !ids.includes(p)),
      }),
    reset: () => save({ ...baseDefaults, plugins: defaultPlugins }),
  };
}

// Which sport sections are folded up (remembered).
export function useCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  });
  const save = (list) => {
    setCollapsed(list);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(list));
    } catch {
      /* storage unavailable: lasts for this session only */
    }
  };
  return {
    collapsed,
    isCollapsed: (id) => collapsed.includes(id),
    toggle: (id) => save(collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id]),
    expand: (id) => collapsed.includes(id) && save(collapsed.filter((x) => x !== id)),
    setAll: (ids) => save(ids),
  };
}
