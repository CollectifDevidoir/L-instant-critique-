// Composition de la séance du jour (fonctions pures, testables).
//
// Principes :
//  1. Les révisions dues passent d'abord, les plus en retard en tête.
//  2. Les nouvelles notions complètent la séance, sans jamais l'emporter sur
//     les révisions : 2 au minimum si la séance le permet, 8 au maximum, et
//     aucune si l'arriéré de révisions dépasse une séance et demie.
//  3. Les nouveautés suivent un ordre pédagogique : on termine une œuvre
//     entamée avant d'en ouvrir une autre (2 œuvres nouvelles maximum par
//     séance), et, pour chaque œuvre, on va de la connaissance de l'œuvre (1)
//     à ses idées (2) puis au présent (3).
//  4. Les questions de comparaison (4) ne sont proposées que lorsque toutes
//     les œuvres concernées ont déjà été réussies au moins une fois.
//  5. La première rencontre avec une œuvre est précédée de sa fiche « En un
//     regard » ; révisions et nouveautés sont ensuite entremêlées.

import { isDue, isNew, overdueRatio } from './srs.js';

export const SESSION_DEFAULTS = Object.freeze({ size: 15, maxNew: 8, minNew: 2, maxNewOeuvres: 2 });

function oeuvreStarted(oeuvreId, cards, states) {
  return cards.some((c) => c.oeuvres[0] === oeuvreId && !isNew(states[c.id]));
}

function oeuvrePassed(oeuvreId, cards, states) {
  return cards.some((c) => c.oeuvres.includes(oeuvreId) && c.competence < 4 && (states[c.id]?.reps || 0) >= 1);
}

export function eligibleNew(cards, states) {
  return cards.filter((c) => {
    if (!isNew(states[c.id])) return false;
    if (c.competence === 4) return c.oeuvres.every((o) => oeuvrePassed(o, cards, states));
    return true;
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
      a.c.competence - b.c.competence ||
      cards.indexOf(a.c) - cards.indexOf(b.c));

  const fresh = [];
  const openedOeuvres = new Set();
  for (const { c, started } of candidates) {
    if (fresh.length >= newBudget) break;
    const o = c.oeuvres[0];
    if (!started && c.competence < 4 && !openedOeuvres.has(o)) {
      if (openedOeuvres.size >= opt.maxNewOeuvres) continue;
      openedOeuvres.add(o);
    }
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
