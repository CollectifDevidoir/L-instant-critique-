// Contrôles d'intégrité du contenu pédagogique.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { indexContent, search, pdfPageFor } from '../src/js/data.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../src/data/${f}.json`, import.meta.url), 'utf8'));
const O = load('oeuvres');
const K = load('cartes');
const L = load('liens');
const C = indexContent(O, K, L);
const ids = new Set(O.oeuvres.map((o) => o.id));

const inRange = (pages, lo = 82, hi = 124) => (String(pages).match(/\d+/g) || []).every((n) => +n >= lo && +n <= hi);

test('fiches complètes et cohérentes', () => {
  assert.equal(ids.size, O.oeuvres.length, 'identifiants uniques');
  for (const o of O.oeuvres) {
    for (const k of ['titre', 'auteur', 'date', 'contexte', 'question', 'ideeCentrale', 'exemple', 'limites']) assert.ok(o[k]?.length > 3, `${o.id}.${k}`);
    assert.ok(o.idees.length >= 2 && o.idees.length <= 3, `${o.id} : 2 ou 3 idées`);
    assert.ok(o.notion?.terme && o.notion?.definition, `${o.id}.notion`);
    for (const k of ['enBref', 'enClair', 'sujet', 'auteurBref']) assert.ok(o[k]?.length > 10, `${o.id}.${k} (pédagogie)`);
    assert.ok(Number.isInteger(o.ordre), `${o.id}.ordre`);
    assert.ok(o.aujourdhui?.magazine && o.aujourdhui?.piste, `${o.id}.aujourdhui`);
    assert.ok(C.articles.has(o.article), `${o.id} : article ${o.article}`);
    assert.ok(inRange(o.pages.magazine), `${o.id} : pages ${o.pages.magazine}`);
    assert.equal(pdfPageFor(parseInt(o.pages.magazine, 10)), o.pages.pdf, `${o.id} : page PDF`);
    assert.ok(['magazine', 'repere'].includes(o.dateNature));
    assert.ok(['verifie', 'partiel'].includes(o.verification.statut));
    assert.ok(o.themes.every((t) => C.themes.has(t)), `${o.id} : thèmes`);
    assert.ok(o.couvertures?.length, `${o.id} : couverture`);
    for (const c of o.couvertures) assert.ok(existsSync(new URL(`../${c.fichier}`, import.meta.url)), c.fichier);
    for (const c of o.citations) assert.ok(inRange(c.page) && c.texte.length < 320, `${o.id} : citation courte et paginée`);
  }
});

test('articles : pages magazine et PDF concordantes', () => {
  for (const a of O.articles) {
    const [m1, m2] = a.pagesMagazine.split('-').map(Number);
    const [p1, p2] = a.pagesPdf.split('-').map(Number);
    assert.equal(pdfPageFor(m1), p1, a.id);
    assert.equal(pdfPageFor(m2), p2, a.id);
  }
});

test('chaque carte renvoie à une œuvre et à une source traçable', () => {
  const cardIds = new Set();
  for (const c of K.cartes) {
    assert.ok(!cardIds.has(c.id), `doublon ${c.id}`); cardIds.add(c.id);
    assert.ok(c.oeuvres.length >= 1);
    for (const o of c.oeuvres) assert.ok(o === 'introduction' || ids.has(o), `${c.id} → ${o}`);
    assert.ok([1, 2, 3, 4].includes(c.competence), c.id);
    assert.ok(c.source && inRange(c.source.pages), `${c.id} : source ${c.source?.pages}`);
    assert.ok(['magazine', 'synthese', 'prolongement', 'repere'].includes(c.source.nature), c.id);
    assert.ok([1, 2, 3].includes(c.niveau), `${c.id} : niveau`);
    if (c.competence === 4) assert.ok(c.oeuvres.length >= 2, `${c.id} : comparaison à deux œuvres au moins`);
  }
});

test('formats : QCM à 4 choix uniques, réponses présentes', () => {
  for (const c of K.cartes) {
    switch (c.format) {
      case 'qcm':
      case 'actualite':
        assert.equal(c.choix.length, 4, c.id);
        assert.equal(new Set(c.choix).size, 4, `${c.id} : choix distincts`);
        assert.ok(Number.isInteger(c.correct) && c.correct >= 0 && c.correct < 4, c.id);
        assert.ok(c.explication?.length > 20, `${c.id} : explication`);
        if (c.format === 'actualite') assert.ok(c.limites?.length > 20, `${c.id} : limites du rapprochement`);
        break;
      case 'flashcard':
        assert.ok(c.reponse?.length > 20, c.id);
        break;
      case 'libre':
        assert.ok(c.reponse?.length > 20 && c.points?.length >= 3, c.id);
        break;
      case 'relier':
        assert.ok(c.paires.length >= 3, c.id);
        assert.equal(new Set(c.paires.map((p) => p.droite)).size, c.paires.length, c.id);
        break;
      default:
        assert.fail(`${c.id} : format inconnu ${c.format}`);
    }
  }
});

test('chaque œuvre a au moins une carte « œuvre » ou « idées », et les cinq formats existent', () => {
  for (const o of O.oeuvres) {
    const own = K.cartes.filter((c) => c.oeuvres[0] === o.id);
    assert.ok(own.length >= 2, `${o.id} : ${own.length} cartes`);
    assert.ok(own.some((c) => c.competence <= 2), o.id);
  }
  const formats = new Set(K.cartes.map((c) => c.format));
  for (const f of ['flashcard', 'qcm', 'relier', 'actualite', 'libre']) assert.ok(formats.has(f), f);
});

test('les œuvres seulement annoncées ne nourrissent aucune question', () => {
  const announced = new Set(O.annoncees.map((a) => a.id));
  for (const c of K.cartes) for (const o of c.oeuvres) assert.ok(!announced.has(o), c.id);
});

test('rapprochements : œuvres existantes, fondement explicite ou proposé', () => {
  for (const r of L.rapprochements) {
    assert.ok(r.oeuvres.length >= 2 && r.oeuvres.every((o) => ids.has(o)), r.id);
    assert.ok(['explicite', 'propose'].includes(r.fondement), r.id);
    assert.ok(r.convergences.length && r.oppositions.length && r.nuances && r.question, r.id);
  }
  for (const q of L.questionsOuvertes) assert.ok(q.oeuvres.every((o) => ids.has(o)));
});

test('glossaire : termes définis, formes uniques', () => {
  const G = load('glossaire').glossaire;
  const forms = new Set();
  for (const g of G) {
    assert.ok(g.definition.length > 20, g.terme);
    for (const f of g.formes) { assert.ok(!forms.has(f.toLowerCase()), `forme en double : ${f}`); forms.add(f.toLowerCase()); }
  }
  assert.ok(G.length >= 40);
});

test('recherche plein texte (accents ignorés)', () => {
  assert.ok(search(C, 'peguy').some((o) => o.id === 'argent-peguy'));
  assert.ok(search(C, 'fake news').some((o) => o.id === 'livre-des-rois'));
  assert.ok(search(C, 'fidelite').some((o) => o.id === 'princesse-de-cleves'));
  assert.ok(search(C, '', 'ecologie').every((o) => o.themes.includes('ecologie')));
  assert.equal(search(C, 'zzzz').length, 0);
});
