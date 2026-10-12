// Composition de la séance du jour (fonctions pures, testables).
//
// Principes (pensés pour quelqu'un qui n'a lu ni les livres ni les articles) :
//  1. Les révisions dues passent d'abord, les plus en retard en tête.
//  2. Les nouvelles notions complètent la séance, sans jamais l'emporter sur
//     les révisions : 2 au minimum si la séance le permet, 8 au maximum, et
//     aucune si l'arriéré de révisions dépasse une séance et demie.
//  3. Les livres s'ouvrent dans l'ordre du parcours (des plus accessibles aux
//     plus exigeants), deux nouveaux livres au plus par séance, quatre cartes
//     nouvelles au plus par livre et par séance.
//  4. Pour chaque livre, trois paliers : 1 découvrir (de quoi parle le livre,
//     pourquoi il compte), 2 comprendre (ses idées), 3 approfondir (avec vos
//     mots, actualité). Un palier ne s'ouvre qu'une fois toutes les cartes du
//     palier précédent réussies au moins une fois — donc lors d'une séance
//     ultérieure : la difficulté monte d'un jour à l'autre.
//  5. Les questions de comparaison ne sont proposées que lorsque chacun des
//     livres concernés a atteint le palier 2.
//  6. La première rencontre avec un livre est précédée de sa présentation.

import { isDue, isNew, overdueRatio } from './srs.js';

export const SESSION_DEFAULTS = Object.freeze({ size: 15, maxNew: 8, minNew: 2, maxNewOeuvres: 2, maxNewPerOeuvre: 4 });

export function levelOf(c) {
  if (Number.isInteger(c.niveau)) return c.niveau;
  if (c.competence === 1) return 1;
  if (c.format === 'libre' || c.format === 'actualite' || c.competence >= 3) return 3;
  return 2;
}

function oeuvreStarted(oeuvreId, cards, states) {
  return cards.some((c) => c.oeuvres[0] === oeuvreId && !isNew(states[c.id]));
}

const passed = (c, states) => (states[c.id]?.reps || 0) >= 1;

// Palier atteint pour un livre : le plus haut palier dont tous les paliers
// inférieurs sont réussis.
export function unlockedLevel(oeuvreId, cards, states) {
  const own = cards.filter((c) => c.oeuvres[0] === oeuvreId && c.competence < 4);
  let lvl = 1;
  for (const n of [1, 2]) {
    const tier = own.filter((c) => levelOf(c) === n);
    if (tier.length && tier.every((c) => passed(c, states))) lvl = n + 1; else break;
  }
  return lvl;
}

export function eligibleNew(cards, states) {
  const cache = new Map();
  const unlocked = (o) => { if (!cache.has(o)) cache.set(o, unlockedLevel(o, cards, states)); return cache.get(o); };
  return cards.filter((c) => {
    if (!isNew(states[c.id])) return false;
    if (c.competence === 4) return c.oeuvres.every((o) => unlocked(o) >= 2);
    return levelOf(c) <= unlocked(c.oeuvres[0]);
  });
}

export function buildSession({ cards, states, oeuvreOrder, now = Date.now(), options = {} }) {
  const opt = { ...SESSION_DEFAULTS, ...options };
  const order = new Map(oeuvreOrder.map((id, i) => [id, i]));
  const rank = (id) => (order.has(id) ? order.get(id) : 999);

  const due = cards
    .filter((c) => isDue(states[c.id], now))
    .sort((a, b) => overdueRatio(states[b.id], now) - overdueRatio(states[a.id], now));
  const reviews = due.slice(0, opt.size);

  let newBudget;
  if (due.length > opt.size * 1.5) newBudget = 0;
  else newBudget = Math.min(opt.maxNew, Math.max(opt.minNew, opt.size - reviews.length));

  const candidates = eligibleNew(cards, states)
    .map((c) => ({ c, started: oeuvreStarted(c.oeuvres[0], cards, states), r: rank(c.oeuvres[0]) }))
    .sort((a, b) =>
      (a.c.competence === 4) - (b.c.competence === 4) ||
      b.started - a.started ||
      a.r - b.r ||
      levelOf(a.c) - levelOf(b.c) ||
      cards.indexOf(a.c) - cards.indexOf(b.c));

  const fresh = [];
  const openedOeuvres = new Set();
  const perOeuvre = new Map();
  for (const { c, started } of candidates) {
    if (fresh.length >= newBudget) break;
    const o = c.oeuvres[0];
    if (c.competence < 4 && (perOeuvre.get(o) || 0) >= opt.maxNewPerOeuvre) continue;
    if (!started && c.competence < 4 && !openedOeuvres.has(o)) {
      const books = [...openedOeuvres].filter((x) => x !== 'introduction').length;
      if (o !== 'introduction' && books >= opt.maxNewOeuvres) continue;
      openedOeuvres.add(o);
    }
    perOeuvre.set(o, (perOeuvre.get(o) || 0) + 1);
    fresh.push(c);
  }
  // Une comparaison au plus par séance si des nouveautés « simples » restent.
  const comps = fresh.filter((c) => c.competence === 4);
  const freshFinal = comps.length > 1 ? fresh.filter((c) => c.competence < 4 || c === comps[0]) : fresh;

  return interleave(reviews, freshFinal, openedOeuvres);
}

// Entremêle révisions et nouveautés ; insère la fiche d'une œuvre avant
// sa première carte nouvelle lorsqu'elle est découverte pendant la séance.
export function interleave(reviews, fresh, openedOeuvres = new Set()) {
  const items = [];
  const introduced = new Set();
  const pushFresh = (c) => {
    const o = c.oeuvres[0];
    if (openedOeuvres.has(o) && !introduced.has(o)) {
      introduced.add(o);
      items.push({ type: 'intro', oeuvre: o });
    }
    items.push({ type: 'card', id: c.id, isNew: true, oeuvre: o });
  };
  const r = [...reviews];
  const f = [...fresh];
  // Échauffement : deux rappels avant toute nouveauté.
  for (let i = 0; i < 2 && r.length; i++) items.push({ type: 'card', id: r.shift().id, isNew: false });
  while (r.length || f.length) {
    if (f.length) pushFresh(f.shift());
    if (f.length && f[0].oeuvres[0] === items[items.length - 1]?.oeuvre) pushFresh(f.shift());
    if (r.length) items.push({ type: 'card', id: r.shift().id, isNew: false });
    if (r.length && !f.length) items.push({ type: 'card', id: r.shift().id, isNew: false });
  }
  return items;
}

// Après un « À revoir » : la carte revient plus loin dans la même séance (une fois).
export function requeue(items, index, cardId, gap = 4) {
  const already = items.some((it) => it.relearn && it.id === cardId)
    || items.slice(index + 1).some((it) => it.type === 'card' && it.id === cardId);
  if (already) return items;
  const at = Math.min(items.length, index + 1 + gap);
  const next = [...items];
  next.splice(at, 0, { type: 'card', id: cardId, isNew: false, relearn: true });
  return next;
}
