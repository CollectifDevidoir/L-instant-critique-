import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSession, requeue, eligibleNew, levelOf, unlockedLevel } from '../src/js/session.js';
import { review, newState, DAY } from '../src/js/srs.js';
import { createStore, migrate, validateImport, exportText, emptyProgress, SCHEMA, STORAGE_KEY } from '../src/js/store.js';
import { indexContent } from '../src/js/data.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../src/data/${f}.json`, import.meta.url), 'utf8'));
const C = indexContent(load('oeuvres'), load('cartes'), load('liens'));
const T0 = new Date('2026-03-02T09:00:00').getTime();

test('première séance : introduction, nouveautés limitées, fiche avant la première carte', () => {
  const items = buildSession({ cards: C.cards, states: {}, oeuvreOrder: C.order, now: T0 });
  const cards = items.filter((i) => i.type === 'card');
  assert.ok(cards.length >= 2 && cards.length <= 8, `${cards.length} cartes`);
  assert.equal(items[0].type, 'intro');
  assert.equal(items[0].oeuvre, 'introduction');
  const opened = new Set(cards.map((i) => C.cardById.get(i.id).oeuvres[0]).filter((o) => o !== 'introduction'));
  assert.ok(opened.size <= 2);
  assert.ok(cards.every((i) => levelOf(C.cardById.get(i.id)) === 1), 'première séance : uniquement le palier « découvrir »');
  assert.deepEqual([...opened], ['tour-du-monde', 'fables'], 'parcours : les livres les plus accessibles d’abord');
  for (const o of opened) {
    const firstCard = items.findIndex((i) => i.type === 'card' && C.cardById.get(i.id).oeuvres[0] === o);
    const intro = items.findIndex((i) => i.type === 'intro' && i.oeuvre === o);
    assert.ok(intro >= 0 && intro < firstCard);
  }
  assert.ok(cards.every((i) => C.cardById.get(i.id).competence < 4), 'pas de comparaison au départ');
});

test('les révisions dues passent avant les nouveautés et l’arriéré bloque les nouveautés', () => {
  const states = {};
  const seen = C.cards.filter((c) => c.competence < 4).slice(0, 30);
  for (const c of seen) states[c.id] = review(newState(), 3, T0 - 5 * DAY);
  const items = buildSession({ cards: C.cards, states, oeuvreOrder: C.order, now: T0, options: { size: 15 } });
  const cards = items.filter((i) => i.type === 'card');
  assert.equal(cards.filter((i) => !i.isNew).length, 15);
  assert.equal(cards.filter((i) => i.isNew).length, 0, 'arriéré > 1,5 séance : pas de nouveauté');
});

test('équilibre : quelques nouveautés même avec des révisions', () => {
  const states = {};
  for (const c of C.cards.slice(0, 8)) states[c.id] = review(newState(), 3, T0 - 5 * DAY);
  const cards = buildSession({ cards: C.cards, states, oeuvreOrder: C.order, now: T0 }).filter((i) => i.type === 'card');
  assert.equal(cards.filter((i) => !i.isNew).length, 8);
  assert.ok(cards.filter((i) => i.isNew).length >= 2);
});

test('les comparaisons attendent que les œuvres concernées soient réussies', () => {
  const cmp = C.cards.find((c) => c.id === 'cmp-1');
  assert.equal(eligibleNew(C.cards, {}).includes(cmp), false);
  const states = {};
  for (const o of cmp.oeuvres) {
    for (const c of C.cards.filter((x) => x.oeuvres[0] === o && levelOf(x) === 1)) states[c.id] = review(newState(), 3, T0);
  }
  assert.equal(eligibleNew(C.cards, states).includes(cmp), true);
});

test('paliers : on ne passe à « comprendre » qu’après avoir réussi « découvrir »', () => {
  const own = C.cards.filter((c) => c.oeuvres[0] === 'tour-du-monde');
  const lvl1 = own.filter((c) => levelOf(c) === 1);
  const lvl2 = own.filter((c) => levelOf(c) === 2);
  const lvl3 = own.filter((c) => levelOf(c) === 3);
  assert.ok(lvl1.length && lvl2.length && lvl3.length);
  const states = {};
  assert.equal(unlockedLevel('tour-du-monde', C.cards, states), 1);
  assert.ok(!eligibleNew(C.cards, states).some((c) => lvl2.includes(c)));
  states[lvl1[0].id] = review(newState(), 1, T0); // raté : pas encore
  for (const c of lvl1.slice(1)) states[c.id] = review(newState(), 3, T0);
  assert.equal(unlockedLevel('tour-du-monde', C.cards, states), 1);
  states[lvl1[0].id] = review(states[lvl1[0].id], 3, T0 + 600000);
  assert.equal(unlockedLevel('tour-du-monde', C.cards, states), 2);
  assert.ok(eligibleNew(C.cards, states).some((c) => lvl2.includes(c)));
  assert.ok(!eligibleNew(C.cards, states).some((c) => lvl3.includes(c)));
});

test('une carte oubliée revient plus loin dans la séance, une seule fois', () => {
  const items = [1, 2, 3, 4, 5, 6].map((n) => ({ type: 'card', id: `c${n}` }));
  const once = requeue(items, 0, 'c1');
  assert.equal(once.length, 7);
  assert.equal(once[5].id, 'c1');
  assert.equal(requeue(once, 1, 'c1').length, 7);
  assert.equal(requeue(once, 5, 'c1').length, 7, 'pas de troisième passage');
});

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
}

test('persistance : la progression survit à un « rechargement »', () => {
  const storage = memoryStorage();
  const s1 = createStore(storage);
  s1.get().cards['pdc-1'] = review(newState(), 3, T0);
  s1.get().notes.ratchkovski = 'Une note';
  s1.save();
  const s2 = createStore(storage);
  assert.equal(s2.get().cards['pdc-1'].reps, 1);
  assert.equal(s2.get().notes.ratchkovski, 'Une note');
  assert.equal(s2.get().schema, SCHEMA);
});

test('export puis import : restauration à l’identique', () => {
  const p = emptyProgress(T0);
  p.cards['rol-2'] = review(newState(), 4, T0);
  p.days['2026-03-02'] = { items: 3, reviews: 1, fresh: 2, again: 0, minutes: 2, acquired: 0 };
  const back = validateImport(exportText(p));
  assert.deepEqual(back.cards, p.cards);
  assert.deepEqual(back.days, p.days);
});

test('migration d’une sauvegarde au format v1', () => {
  const v1 = { version: 1, createdAt: T0, states: { 'pdc-1': review(newState(), 3, T0) }, log: [{ date: '2026-03-01', n: 12 }] };
  const m = migrate(v1);
  assert.equal(m.schema, SCHEMA);
  assert.equal(m.cards['pdc-1'].reps, 1);
  assert.equal(m.days['2026-03-01'].items, 12);
});

test('imports invalides refusés, sauvegarde corrompue conservée en secours', () => {
  assert.throws(() => validateImport('pas du json'));
  assert.throws(() => validateImport(JSON.stringify({ foo: 1 })));
  assert.throws(() => validateImport(JSON.stringify({ app: 'autre', schema: 2 })));
  assert.throws(() => validateImport(JSON.stringify({ app: 'instant-critique', schema: 99 })));
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, '{cassé');
  const s = createStore(storage);
  assert.deepEqual(s.get().cards, {});
  assert.ok(s.warning());
  assert.ok([...storage.map.keys()].some((k) => k.startsWith(`${STORAGE_KEY}-backup-`)));
});
