import test from 'node:test';
import assert from 'node:assert/strict';
import { review, newState, isAcquired, isDue, status, startOfDay, DAY, MINUTE, PARAMS } from '../src/js/srs.js';

const T0 = new Date('2026-03-02T09:00:00').getTime();
const daysFrom = (s, now) => Math.round((s.due - startOfDay(now)) / DAY);

test('première réussite : révision le lendemain, puis à 3 jours', () => {
  let s = review(newState(), 3, T0);
  assert.equal(s.interval, 1);
  assert.equal(daysFrom(s, T0), 1);
  const t1 = T0 + DAY;
  s = review(s, 3, t1);
  assert.equal(s.interval, 3);
  assert.equal(daysFrom(s, t1), 3);
});

test('les intervalles réussis s’allongent progressivement', () => {
  let s = newState();
  let now = T0;
  const intervals = [];
  for (let i = 0; i < 6; i++) {
    s = review(s, 3, now);
    intervals.push(s.interval);
    now = s.due + 9 * 3600 * 1000;
  }
  for (let i = 1; i < intervals.length; i++) assert.ok(intervals[i] > intervals[i - 1], `${intervals}`);
  assert.deepEqual(intervals.slice(0, 3), [1, 3, 7]);
});

test('« À revoir » : retour dans 10 minutes, série remise à zéro, facilité réduite', () => {
  let s = review(newState(), 3, T0);
  s = review(s, 3, T0 + DAY);
  const before = s.ease;
  s = review(s, 1, T0 + 4 * DAY);
  assert.equal(s.reps, 0);
  assert.equal(s.lapses, 1);
  assert.equal(s.interval, 0);
  assert.equal(s.due, T0 + 4 * DAY + 10 * MINUTE);
  assert.ok(s.ease < before);
});

test('les oublis passés raccourcissent les intervalles suivants', () => {
  const clean = (() => { let s = newState(); s = review(s, 3, T0); s = review(s, 3, T0 + DAY); return review(s, 3, T0 + 4 * DAY); })();
  const lapsed = (() => {
    let s = newState();
    s = review(s, 1, T0); s = review(s, 1, T0 + MINUTE * 11);
    s = review(s, 3, T0 + MINUTE * 30); s = review(s, 3, T0 + DAY); return review(s, 3, T0 + 4 * DAY);
  })();
  assert.ok(lapsed.interval < clean.interval, `${lapsed.interval} < ${clean.interval}`);
});

test('« Difficile » rapproche la révision et ne fait pas progresser la série', () => {
  let s = review(newState(), 3, T0);
  s = review(s, 3, T0 + DAY);
  const good = review(s, 3, T0 + 4 * DAY);
  const hard = review(s, 2, T0 + 4 * DAY);
  assert.ok(hard.interval < good.interval);
  assert.equal(hard.reps, s.reps);
});

test('« Facile » espace davantage que « Bien »', () => {
  const s = review(newState(), 3, T0);
  assert.ok(review(s, 4, T0 + DAY).interval > review(s, 3, T0 + DAY).interval);
  assert.equal(review(newState(), 4, T0).interval, 3);
});

test('une seule bonne réponse ne suffit jamais à acquérir une notion', () => {
  const once = review(newState(), 4, T0);
  assert.equal(isAcquired(once), false);
  let s = newState();
  let now = T0;
  let n = 0;
  while (!isAcquired(s) && n < 20) { s = review(s, 3, now); now = s.due + 3600 * 1000; n++; }
  assert.ok(n >= 4, `acquise après ${n} réussites`);
  assert.ok(s.interval >= PARAMS.acquiredInterval);
});

test('les notions anciennes reviennent : intervalle plafonné à 120 jours', () => {
  let s = newState();
  let now = T0;
  for (let i = 0; i < 25; i++) { s = review(s, 4, now); now = s.due + 3600 * 1000; }
  assert.equal(s.interval, PARAMS.maxInterval);
});

test('échéance et statut', () => {
  const s = review(newState(), 3, T0);
  assert.equal(isDue(s, T0 + 3600 * 1000), false);
  assert.equal(isDue(s, startOfDay(T0) + DAY), true);
  assert.equal(status(undefined), 'nouvelle');
  assert.equal(status(review(newState(), 1, T0)), 'a-consolider');
  assert.equal(status(s), 'en-cours');
  assert.equal(s.history.length, 1);
  assert.throws(() => review(s, 5, T0));
});
