import test from 'node:test';
import assert from 'node:assert/strict';
import { readSettings, SETTINGS_KEY, baseDefaults } from '../src/settings.js';

const store = (obj) => ({ getItem: (k) => (k in obj ? obj[k] : null) });
const DEF = ['nfl', 'nba'];

test('empty storage gives the defaults', () => {
  assert.deepEqual(readSettings(store({}), DEF), { ...baseDefaults, plugins: DEF });
});

test('saved settings are read back', () => {
  const saved = { sportSort: 'active', gameSort: 'hot', range: 'today', activeOnly: true, officialFirst: false, plugins: ['mlb'] };
  assert.deepEqual(readSettings(store({ [SETTINGS_KEY]: JSON.stringify(saved) }), DEF), saved);
});

test('invalid values fall back per field; corrupt JSON gives defaults', () => {
  const r = readSettings(store({ [SETTINGS_KEY]: JSON.stringify({ sportSort: 'nope', gameSort: 'finish', plugins: 'x', activeOnly: 'yes' }) }), DEF);
  assert.equal(r.sportSort, 'default');
  assert.equal(r.gameSort, 'finish');
  assert.deepEqual(r.plugins, DEF);
  assert.equal(r.activeOnly, false);
  assert.deepEqual(readSettings(store({ [SETTINGS_KEY]: '{oops' }), DEF), { ...baseDefaults, plugins: DEF });
});

test('settings saved by earlier versions (separate keys) are migrated', () => {
  const r = readSettings(store({ 'sportsball.sportSort': 'active', 'sportsball.gameSort': 'finish', 'sportsball.range': 'today', 'sportsball.activeOnly': 'on' }), DEF);
  assert.deepEqual(r, { ...baseDefaults, plugins: DEF, sportSort: 'active', gameSort: 'finish', range: 'today', activeOnly: true });
});
