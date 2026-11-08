import test from 'node:test';
import assert from 'node:assert/strict';
import { sortGames, sectionRank, orderSections, isToday } from '../src/sorting.js';

const g = (id, status, away, home, extra = {}) => ({
  id, status, teams: { away: { score: away }, home: { score: home } }, ...extra,
});
const ids = (l) => l.map((x) => x.id);
const none = () => false;

test('hot: live before upcoming before final; red zone, then closest margin', () => {
  const games = [
    g('final', 'FINAL', 10, 3),
    g('pre', 'PREGAME', 0, 0),
    g('blowout', 'LIVE', 35, 3, { progress: 0.9 }),
    g('tight', 'LIVE', 17, 16, { progress: 0.5 }),
    g('rz', 'LIVE', 21, 10, { progress: 0.4, details: { football: { inRedZone: true } } }),
  ];
  assert.deepEqual(ids(sortGames(games, 'hot', none)), ['rz', 'tight', 'blowout', 'pre', 'final']);
});

test('finish: nearest the end first among live games', () => {
  const games = [g('a', 'LIVE', 1, 0, { progress: 0.3 }), g('b', 'LIVE', 9, 0, { progress: 0.95 }), g('c', 'LIVE', 2, 2, { progress: 0.6 })];
  assert.deepEqual(ids(sortGames(games, 'finish', none)), ['b', 'c', 'a']);
});

test('hot/finish: pinned lead within their status group only', () => {
  const games = [g('x', 'LIVE', 1, 1, { progress: 0.9 }), g('pinLive', 'LIVE', 20, 0, { progress: 0.1 }), g('pinPre', 'PREGAME', 0, 0), g('pre', 'PREGAME', 0, 0)];
  const fav = (x) => x.id.startsWith('pin');
  assert.deepEqual(ids(sortGames(games, 'hot', fav)), ['pinLive', 'x', 'pinPre', 'pre']);
});

test('fav: pinned first, feed order otherwise, input untouched', () => {
  const games = [g('a', 'FINAL', 0, 0), g('b', 'LIVE', 0, 0), g('c', 'PREGAME', 0, 0)];
  const copy = [...games];
  assert.deepEqual(ids(sortGames(games, 'fav', (x) => x.id === 'c')), ['c', 'a', 'b']);
  assert.deepEqual(games, copy);
});

test('section ranks', () => {
  assert.equal(sectionRank([]), 0);
  assert.equal(sectionRank([{ status: 'FINAL' }]), 1);
  assert.equal(sectionRank([{ status: 'PREGAME' }]), 2);
  assert.equal(sectionRank([{ status: 'FINAL', pinned: true }]), 3);
  assert.equal(sectionRank([{ status: 'LIVE' }]), 4);
  assert.equal(sectionRank([{ status: 'LIVE', pinned: true }]), 5);
});

test('orderSections: default keeps order; active ranks, ties keep order', () => {
  const secs = [
    { id: 'empty', items: [] },
    { id: 'final', items: [{ status: 'FINAL' }] },
    { id: 'live1', items: [{ status: 'LIVE' }] },
    { id: 'live3', items: [{ status: 'LIVE' }, { status: 'LIVE' }, { status: 'LIVE' }] },
    { id: 'pinned', items: [{ status: 'LIVE', pinned: true }] },
  ];
  assert.deepEqual(orderSections(secs, 'default'), ['empty', 'final', 'live1', 'live3', 'pinned']);
  assert.deepEqual(orderSections(secs, 'active'), ['pinned', 'live3', 'live1', 'final', 'empty']);
});

test('isToday: local date match, live always, unknown start never hidden', () => {
  const now = new Date(2026, 10, 8, 15, 0); // Sun 8 Nov 2026, 3pm local
  const at = (d, h) => new Date(2026, 10, d, h, 0).toISOString();
  assert.equal(isToday({ status: 'PREGAME', start: at(8, 20) }, now), true);
  assert.equal(isToday({ status: 'PREGAME', start: at(10, 20) }, now), false);
  assert.equal(isToday({ status: 'FINAL', start: at(5, 20) }, now), false);
  assert.equal(isToday({ status: 'LIVE', start: at(7, 23) }, now), true);
  assert.equal(isToday({ status: 'PREGAME' }, now), true);
  assert.equal(isToday({ status: 'PREGAME', start: 'garbage' }, now), true);
});
