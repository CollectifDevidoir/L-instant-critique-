// Sauvegarde locale de la progression (localStorage), avec versions de schéma,
// migrations, export et import. Aucune donnée ne quitte l'appareil.

export const STORAGE_KEY = 'instant-critique';
export const SCHEMA = 2;

export function emptyProgress(now = Date.now()) {
  return {
    app: 'instant-critique',
    schema: SCHEMA,
    createdAt: now,
    updatedAt: now,
    cards: {},          // id de carte → état de répétition espacée
    days: {},           // 'AAAA-MM-JJ' → { items, reviews, fresh, again, minutes, acquired }
    recent: [],         // dernières œuvres étudiées (ids), la plus récente en tête
    reports: [],        // signalements de fiches à corriger
    settings: { size: 15, theme: 'auto' },
    opened: {},         // œuvres dont la fiche a été présentée en séance
    notes: {},          // carnet du mode réflexion : id de rapprochement → texte
  };
}

// Migrations successives : chaque fonction fait passer de la version n à n+1.
const MIGRATIONS = {
  // v1 (prototype) : { version: 1, states: {...}, log: [...] }
  1: (d) => {
    const p = emptyProgress(d.createdAt || Date.now());
    p.cards = d.states || {};
    for (const entry of d.log || []) {
      const key = entry.date;
      if (!key) continue;
      p.days[key] = { items: entry.n || 0, reviews: 0, fresh: 0, again: 0, minutes: 0, acquired: null };
    }
    return p;
  },
};

export function schemaOf(data) {
  if (!data || typeof data !== 'object') return null;
  if (Number.isInteger(data.schema)) return data.schema;
  if (Number.isInteger(data.version)) return data.version;
  return null;
}

export function migrate(data) {
  let v = schemaOf(data);
  if (v == null) throw new Error('Fichier de progression non reconnu.');
  if (v > SCHEMA) throw new Error(`Cette sauvegarde vient d'une version plus récente de l'application (schéma ${v}).`);
  let d = data;
  while (v < SCHEMA) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`Aucune migration depuis le schéma ${v}.`);
    d = step(d);
    v = schemaOf(d);
  }
  return normalize(d);
}

// Complète les champs manquants et écarte les valeurs incohérentes.
export function normalize(d) {
  const base = emptyProgress(d.createdAt || Date.now());
  const out = { ...base, ...d, settings: { ...base.settings, ...(d.settings || {}) } };
  for (const k of ['cards', 'days', 'opened', 'notes']) if (!out[k] || typeof out[k] !== 'object' || Array.isArray(out[k])) out[k] = {};
  for (const k of ['recent', 'reports']) if (!Array.isArray(out[k])) out[k] = [];
  for (const [id, s] of Object.entries(out.cards)) {
    if (!s || typeof s !== 'object' || !Number.isFinite(s.ease) || !Array.isArray(s.history)) delete out.cards[id];
  }
  out.schema = SCHEMA;
  return out;
}

export function validateImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Le fichier n'est pas un JSON valide.");
  }
  if (data.app && data.app !== 'instant-critique') throw new Error("Ce fichier ne provient pas de L'instant critique.");
  return migrate(data);
}

export function exportText(progress) {
  return JSON.stringify({ ...progress, exportedAt: Date.now() }, null, 2);
}

export function dayKey(now = Date.now()) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Accès au stockage du navigateur, protégé : navigation privée, quota, etc.
export function createStore(storage = globalThis.localStorage) {
  let warning = null;
  const load = () => {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (!raw) return emptyProgress();
      return migrate(JSON.parse(raw));
    } catch (e) {
      warning = `Progression illisible (${e.message}) : une sauvegarde de secours a été conservée.`;
      try { storage?.setItem(`${STORAGE_KEY}-backup-${Date.now()}`, storage.getItem(STORAGE_KEY)); } catch { /* rien */ }
      return emptyProgress();
    }
  };
  let progress = load();
  const save = () => {
    progress.updatedAt = Date.now();
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(progress));
      return true;
    } catch {
      warning = "La progression n'a pas pu être enregistrée (stockage plein ou désactivé). Pensez à l'exporter.";
      return false;
    }
  };
  return {
    get: () => progress,
    save,
    replace(next) { progress = normalize(next); save(); },
    reset() { progress = emptyProgress(); save(); },
    warning: () => warning,
  };
}
