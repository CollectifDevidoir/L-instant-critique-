// Répétition espacée — variante simplifiée et documentée de SM-2.
//
// Chaque carte possède un état indépendant :
//   reps     : nombre de réussites consécutives (« Bien » ou « Facile »)
//   lapses   : nombre total d'oublis (« À revoir »)
//   ease     : facteur de facilité (1,3 à 3,0), il baisse à chaque difficulté
//   interval : dernier intervalle en jours
//   due      : date (ms) à partir de laquelle la carte est à réviser
//
// Notes de l'utilisateur :
//   1 À revoir  → la carte revient dans 10 minutes (même séance), reps = 0,
//                 facilité −0,20, un oubli de plus est mémorisé.
//   2 Difficile → intervalle court (1 jour, puis ×1,2), facilité −0,15,
//                 la série de réussites n'augmente pas.
//   3 Bien      → 1 jour, puis 3 jours, puis intervalle × facilité.
//   4 Facile    → 3 jours, puis 6 jours, puis intervalle × facilité × 1,3 ;
//                 facilité +0,15.
//
// Les oublis passés freinent la progression : chaque intervalle est multiplié
// par (1 − 0,1 × oublis), plafonné à −30 %. Aucun intervalle ne dépasse
// 120 jours : même une notion maîtrisée revient au moins trois fois par an.
// Une carte n'est « acquise » qu'après 3 réussites consécutives ET un
// intervalle d'au moins 21 jours : une seule bonne réponse ne suffit jamais.

export const DAY = 24 * 60 * 60 * 1000;
export const MINUTE = 60 * 1000;

export const PARAMS = Object.freeze({
  initialEase: 2.3,
  minEase: 1.3,
  maxEase: 3.0,
  againDelay: 10 * MINUTE,
  maxInterval: 120,
  acquiredReps: 3,
  acquiredInterval: 21,
  historyLength: 40,
});

export const GRADES = Object.freeze({ AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 });
export const GRADE_LABELS = Object.freeze({ 1: 'À revoir', 2: 'Difficile', 3: 'Bien retenu', 4: 'Facile' });

export function newState() {
  return { reps: 0, lapses: 0, ease: PARAMS.initialEase, interval: 0, due: null, last: null, seen: 0, history: [] };
}

// Minuit local du jour de `now` : les révisions sont dues « à partir du jour J ».
export function startOfDay(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function review(state, grade, now = Date.now()) {
  if (![1, 2, 3, 4].includes(grade)) throw new Error(`Note invalide : ${grade}`);
  const prev = { ...newState(), ...(state || {}) };
  const s = {
    ...prev,
    seen: prev.seen + 1,
    last: now,
    history: [...prev.history, { t: now, g: grade }].slice(-PARAMS.historyLength),
  };

  if (grade === GRADES.AGAIN) {
    s.lapses = prev.lapses + 1;
    s.reps = 0;
    s.ease = clamp(prev.ease - 0.2, PARAMS.minEase, PARAMS.maxEase);
    s.interval = 0;
    s.due = now + PARAMS.againDelay;
    return s;
  }

  let days;
  if (grade === GRADES.HARD) {
    s.ease = clamp(prev.ease - 0.15, PARAMS.minEase, PARAMS.maxEase);
    days = prev.interval < 1 ? 1 : prev.interval * 1.2;
  } else if (grade === GRADES.GOOD) {
    days = prev.reps === 0 ? 1 : prev.reps === 1 ? 3 : prev.interval * prev.ease;
    s.reps = prev.reps + 1;
  } else {
    s.ease = clamp(prev.ease + 0.15, PARAMS.minEase, PARAMS.maxEase);
    days = prev.reps === 0 ? 3 : prev.reps === 1 ? 6 : prev.interval * prev.ease * 1.3;
    s.reps = prev.reps + 1;
  }

  const lapsePenalty = 1 - 0.1 * Math.min(prev.lapses, 3);
  days = Math.max(1, Math.round(days * lapsePenalty));
  // Un intervalle réussi ne recule jamais (sauf « Difficile » qui peut stagner).
  if (grade !== GRADES.HARD) days = Math.max(days, Math.min(prev.interval, PARAMS.maxInterval));
  s.interval = Math.min(days, PARAMS.maxInterval);
  s.due = startOfDay(now) + s.interval * DAY;
  return s;
}

export function isNew(state) {
  return !state || !state.seen;
}

export function isDue(state, now = Date.now()) {
  return !!state && state.seen > 0 && state.due != null && state.due <= now;
}

export function isAcquired(state) {
  return !!state && state.reps >= PARAMS.acquiredReps && state.interval >= PARAMS.acquiredInterval;
}

// Statut lisible : nouvelle, a-consolider (vue mais fragile), en-cours, acquise.
export function status(state) {
  if (isNew(state)) return 'nouvelle';
  if (isAcquired(state)) return 'acquise';
  const lastGrade = state.history.length ? state.history[state.history.length - 1].g : 0;
  if (state.reps === 0 || lastGrade <= 2) return 'a-consolider';
  return 'en-cours';
}

// Score de maîtrise d'une carte entre 0 et 1 (pour les jauges).
export function mastery(state) {
  if (isNew(state)) return 0;
  if (isAcquired(state)) return 1;
  return Math.min(0.9, 0.15 + 0.75 * (state.interval / PARAMS.acquiredInterval));
}

// Retard relatif : sert à trier les révisions dues (les plus en retard d'abord).
export function overdueRatio(state, now = Date.now()) {
  if (!isDue(state, now)) return 0;
  const span = Math.max(1, state.interval) * DAY;
  return (now - state.due) / span;
}
