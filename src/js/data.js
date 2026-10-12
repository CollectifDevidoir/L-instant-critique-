// Chargement et indexation du contenu pédagogique (fichiers JSON séparés du code).

const FILES = ['oeuvres', 'cartes', 'liens', 'glossaire'];

export async function loadContent(base = './src/data/') {
  const [oeuvres, cartes, liens, glossaire] = await Promise.all(
    FILES.map((f) => fetch(`${base}${f}.json`, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`Impossible de charger ${f}.json (${r.status})`);
      return r.json();
    })),
  );
  return indexContent(oeuvres, cartes, liens, glossaire);
}

export function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, ' ');
}

export function indexContent(oeuvresData, cartesData, liensData, glossaireData = { glossaire: [] }) {
  const oeuvres = oeuvresData.oeuvres;
  const byId = new Map(oeuvres.map((o) => [o.id, o]));
  const articles = new Map(oeuvresData.articles.map((a) => [a.id, a]));
  const themes = new Map(oeuvresData.themes.map((t) => [t.id, t]));
  const cards = cartesData.cartes;
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const cardsByOeuvre = new Map();
  for (const c of cards) {
    for (const o of c.oeuvres) {
      if (!cardsByOeuvre.has(o)) cardsByOeuvre.set(o, []);
      cardsByOeuvre.get(o).push(c);
    }
  }
  const order = ['introduction', ...oeuvres.map((o) => o.id)];
  const searchIndex = oeuvres.map((o) => ({
    id: o.id,
    text: normalizeText([
      o.titre, o.auteur, o.date, o.question, o.sujet, o.enBref, o.enClair, o.ideeCentrale, o.notion?.terme, o.notion?.definition,
      ...(o.idees || []), o.exemple, o.contexte,
      ...(o.themes || []).map((t) => themes.get(t)?.label),
      articles.get(o.article)?.rubrique, articles.get(o.article)?.titre, articles.get(o.article)?.auteurs,
    ].join(' ')),
  }));
  return {
    meta: oeuvresData.source,
    legende: oeuvresData.legende,
    introduction: oeuvresData.introduction,
    annoncees: oeuvresData.annoncees,
    competences: cartesData.competences,
    oeuvres, byId, articles, themes, cards, cardById, cardsByOeuvre, order, searchIndex,
    liens: liensData,
    glossaire: glossaireData.glossaire,
  };
}

export function search(content, query, theme = '') {
  const q = normalizeText(query).trim();
  const terms = q.split(/\s+/).filter(Boolean);
  return content.oeuvres.filter((o) => {
    if (theme && !(o.themes || []).includes(theme)) return false;
    if (!terms.length) return true;
    const entry = content.searchIndex.find((e) => e.id === o.id);
    return terms.every((t) => entry.text.includes(t));
  });
}

// Correspondance pages magazine → PDF fourni (p. 82 = PDF 1 ; p. n = PDF n − 82 pour n ≥ 84).
export function pdfPageFor(magazinePage) {
  const n = Number(magazinePage);
  if (!Number.isFinite(n)) return null;
  if (n === 82) return 1;
  if (n >= 84 && n <= 124) return n - 82;
  return null;
}
