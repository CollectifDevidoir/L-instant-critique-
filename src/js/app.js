import { loadContent, search, pdfPageFor } from './data.js';
import { createStore, exportText, validateImport, dayKey } from './store.js';
import { review, status, isDue, isNew, isAcquired, mastery, GRADE_LABELS, DAY, MINUTE, startOfDay } from './srs.js';
import { buildSession, requeue, eligibleNew } from './session.js';
import { initPdf, savePdf, removePdf, hasPdf, pdfHref } from './pdf.js';

const REPO = 'https://github.com/CollectifDevidoir/L-instant-critique-';
const main = document.getElementById('main');
const store = createStore();
let C = null;            // contenu indexé
let session = null;      // séance en cours
let ui = {};             // état transitoire de l'élément affiché
const libState = { q: '', theme: '', sort: 'rubrique' };
const refState = { theme: '' };

/* ————————————————— utilitaires ————————————————— */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const P = () => store.get();
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function shuffled(arr, seed) {
  let s = hash(seed) || 1;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function oeuvreTitle(id) {
  if (id === 'introduction') return 'Introduction du dossier';
  return C.byId.get(id)?.titre ?? id;
}
function oeuvreAuthor(id) {
  if (id === 'introduction') return C.introduction.auteur;
  return C.byId.get(id)?.auteur ?? '';
}

const NATURE_LABEL = { magazine: 'Dossier', synthese: 'Synthèse', prolongement: 'Prolongement', repere: 'Repère' };
const NATURE_TITLE = () => C.legende;
function natureTag(n) {
  return `<span class="nature ${esc(n)}" title="${esc(NATURE_TITLE()[n] || '')}">${esc(NATURE_LABEL[n] || n)}</span>`;
}

function pageLink(magPages, label) {
  const first = parseInt(String(magPages).match(/\d+/)?.[0], 10);
  const pdf = pdfPageFor(first);
  const txt = label || `p. ${esc(magPages)} du magazine${pdf ? ` · PDF p. ${pdf}` : ''}`;
  if (pdf && hasPdf()) return `<a href="${pdfHref(pdf)}" target="_blank" rel="noopener">${txt} ↗</a>`;
  return `<span>${txt}</span>`;
}

function coverImg(c, cls = 'cover') {
  return `<img class="${cls}" src="${esc(c.fichier)}" alt="Couverture : ${esc(c.legende)}" width="${c.largeur}" height="${c.hauteur}" loading="lazy" decoding="async">`;
}

function intervalLabel(state, now = Date.now()) {
  if (!state?.due) return '';
  const ms = state.due - now;
  if (ms < 60 * MINUTE) return `${Math.max(1, Math.round(ms / MINUTE))} min`;
  const days = Math.round((state.due - startOfDay(now)) / DAY);
  if (days <= 1) return 'demain';
  if (days < 31) return `${days} j`;
  return `${Math.round(days / 30)} mois`;
}

/* ————————————————— statistiques ————————————————— */

function computeStats(now = Date.now()) {
  const p = P();
  let seen = 0, acquired = 0, fragile = 0, due = 0;
  for (const c of C.cards) {
    const s = p.cards[c.id];
    if (isNew(s)) continue;
    seen++;
    if (isAcquired(s)) acquired++;
    else if (status(s) === 'a-consolider') fragile++;
    if (isDue(s, now)) due++;
  }
  return { total: C.cards.length, seen, acquired, fragile, due, fresh: eligibleNew(C.cards, p.cards).length };
}

function compMastery(cards) {
  const p = P();
  const out = {};
  for (const comp of [1, 2, 3, 4]) {
    const list = cards.filter((c) => c.competence === comp);
    if (!list.length) { out[comp] = null; continue; }
    out[comp] = list.reduce((s, c) => s + mastery(p.cards[c.id]), 0) / list.length;
  }
  return out;
}

function countAcquired(p) {
  return C.cards.filter((c) => isAcquired(p.cards[c.id])).length;
}

function studyDays(n = 28, now = Date.now()) {
  const p = P();
  let count = 0;
  for (let i = 0; i < n; i++) if (p.days[dayKey(now - i * DAY)]?.items) count++;
  return count;
}

/* ————————————————— routeur ————————————————— */

const routes = [
  [/^#?\/?$/, () => viewHome()],
  [/^#\/seance$/, () => viewSession()],
  [/^#\/seance\/oeuvre\/([\w-]+)$/, (m) => viewSession({ oeuvre: m[1] })],
  [/^#\/seance\/libre$/, () => viewSession({ libre: true })],
  [/^#\/bibliotheque$/, () => viewLibrary()],
  [/^#\/oeuvre\/([\w-]+)$/, (m) => viewOeuvre(m[1])],
  [/^#\/reflexion$/, () => viewReflexion()],
  [/^#\/progression$/, () => viewProgress()],
  [/^#\/reglages$/, () => viewSettings()],
  [/^#\/sources$/, () => viewSources()],
];

function navKey(h) {
  if (h.startsWith('#/seance')) return 'seance';
  if (h.startsWith('#/bibliotheque') || h.startsWith('#/oeuvre')) return 'bibliotheque';
  if (h.startsWith('#/reflexion')) return 'reflexion';
  if (h.startsWith('#/progression') || h.startsWith('#/reglages')) return 'progression';
  if (h.startsWith('#/sources')) return '';
  return 'accueil';
}

function route() {
  const h = location.hash || '#/';
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === navKey(h)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) { fn(m); return; }
  }
  main.innerHTML = `<div class="view"><p class="empty">Page introuvable. <a href="#/">Retour à l'accueil</a>.</p></div>`;
}

function render(html, { focus = true } = {}) {
  main.innerHTML = `<div class="view">${html}${footer()}</div>`;
  if (focus) { main.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  main.querySelector('[autofocus]')?.focus({ preventScroll: true });
}

function footer() {
  return `<footer class="footer-note">
    <span>D'après <em>Le Magazine littéraire</em>, n° 581-582, juillet-août 2017, dossier « 30 classiques pour penser le monde ».</span>
    <a href="#/sources">Sources et méthode</a><a href="#/reglages">Réglages et sauvegarde</a>
  </footer>`;
}

/* ————————————————— accueil ————————————————— */

function dailyThought() {
  const qs = C.liens.questionsOuvertes;
  return qs[hash(dayKey()) % qs.length];
}

function viewHome() {
  const now = Date.now();
  const st = computeStats(now);
  const plan = buildSession({ cards: C.cards, states: P().cards, oeuvreOrder: C.order, now, options: { size: P().settings.size } });
  const planCards = plan.filter((i) => i.type === 'card');
  const nNew = planCards.filter((i) => i.isNew).length;
  const nRev = planCards.length - nNew;
  const pctAcq = Math.round((st.acquired / st.total) * 100);
  const pctSeen = Math.round((st.seen / st.total) * 100);
  const first = st.seen === 0;
  const recent = P().recent.filter((id) => C.byId.has(id)).slice(0, 4);
  const q = dailyThought();
  const minutes = Math.max(5, Math.round(planCards.length * 0.9 + plan.filter((i) => i.type === 'intro').length));

  render(`
  <div class="home">
    <section class="hero">
      <p class="kicker">Trente classiques pour penser le monde</p>
      <h1>Lire hier pour <em>comprendre</em> aujourd'hui.</h1>
      <p class="lede">Chaque jour, quelques minutes pour retenir ce que les grandes œuvres disent du pouvoir, de l'argent, de l'autre ou de la violence — et pour vous en servir quand l'actualité vous prend de court.</p>
      <div class="today">
        ${planCards.length
          ? `<a class="btn big" href="#/seance">${first ? 'Commencer la première séance' : 'Commencer la séance du jour'}</a>
             <p class="today-count"><strong>${nRev}</strong> à réviser · <strong>${nNew}</strong> nouvelles<br>environ ${minutes} minutes</p>`
          : `<a class="btn big ghost" href="#/seance/libre">Revoir des notions fragiles</a>
             <p class="today-count">Rien n'est dû aujourd'hui. Prochaine révision : ${nextDueLabel(now)}.</p>`}
      </div>
      <div class="overall" aria-label="Progression globale">
        <p class="label">Progression</p>
        <div class="bar" role="img" aria-label="${pctAcq} % des notions acquises, ${pctSeen} % découvertes"><span class="seen" style="width:${pctSeen}%"></span><span style="width:${pctAcq}%"></span></div>
        <p>${plural(st.acquired, 'notion acquise', 'notions acquises')} sur ${st.total} · ${st.seen} découvertes${st.fragile ? ` · ${st.fragile} à consolider` : ''}. <a href="#/progression">Détails</a></p>
      </div>
    </section>
    <aside>
      <div class="aside-block">
        <h2>Dernières œuvres étudiées</h2>
        ${recent.length ? `<ul class="recent-list">${recent.map((id) => {
          const o = C.byId.get(id);
          return `<li><a href="#/oeuvre/${o.id}"><span class="t">${esc(o.titre)}</span><span class="a">${esc(shortAuthor(o.auteur))}</span></a></li>`;
        }).join('')}</ul>` : `<p class="empty">Vos lectures apparaîtront ici. La première séance commence par l'introduction du dossier, puis <em>La Princesse de Clèves</em>.</p>`}
      </div>
      <div class="thought">
        <p class="label">Question du jour</p>
        <p>${esc(q.question)}</p>
        <a href="#/reflexion" class="linkbtn">Ouvrir le mode réflexion</a>
      </div>
    </aside>
  </div>`);
}

function shortAuthor(a) {
  return a.replace(/\s*\(.*\)$/, '');
}

function nextDueLabel(now) {
  const p = P();
  const dues = C.cards.map((c) => p.cards[c.id]?.due).filter((d) => d && d > now).sort((a, b) => a - b);
  if (!dues.length) return 'aucune programmée';
  return intervalLabel({ due: dues[0] }, now);
}

/* ————————————————— séance ————————————————— */

function sessionKey(scope) {
  return scope?.oeuvre ? `oeuvre:${scope.oeuvre}` : scope?.libre ? 'libre' : 'jour';
}

function newSession(scope = {}) {
  const now = Date.now();
  const p = P();
  let items;
  if (scope.oeuvre) {
    const cards = C.cardsByOeuvre.get(scope.oeuvre) || [];
    const own = cards.filter((c) => c.oeuvres[0] === scope.oeuvre || c.competence === 4);
    const due = own.filter((c) => isDue(p.cards[c.id], now));
    const fresh = eligibleNew(C.cards, p.cards).filter((c) => own.includes(c));
    items = [];
    if (!p.opened[scope.oeuvre] && fresh.length) items.push({ type: 'intro', oeuvre: scope.oeuvre });
    for (const c of [...due, ...fresh].slice(0, 12)) items.push({ type: 'card', id: c.id, isNew: isNew(p.cards[c.id]) });
  } else if (scope.libre) {
    items = C.cards
      .filter((c) => !isNew(p.cards[c.id]))
      .sort((a, b) => mastery(p.cards[a.id]) - mastery(p.cards[b.id]) || (p.cards[a.id].due - p.cards[b.id].due))
      .slice(0, 10)
      .map((c) => ({ type: 'card', id: c.id, isNew: false }));
  } else {
    items = buildSession({ cards: C.cards, states: p.cards, oeuvreOrder: C.order, now, options: { size: p.settings.size } });
  }
  session = { key: sessionKey(scope), scope, items, index: 0, startedAt: now, lastAt: now, results: [], seed: String(now) };
  ui = {};
  persistSession();
}

function persistSession() {
  try { sessionStorage.setItem('instant-critique-session', JSON.stringify(session)); } catch { /* facultatif */ }
}
function restoreSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem('instant-critique-session') || 'null');
    if (s && Date.now() - s.startedAt < 6 * 3600 * 1000) session = s;
  } catch { session = null; }
}

function viewSession(scope = {}) {
  const key = sessionKey(scope);
  if (!session || session.key !== key || session.done) newSession(scope);
  if (!session.items.length) return renderNothingDue(scope);
  renderItem();
}

function renderNothingDue(scope) {
  const st = computeStats();
  render(`<div class="session-end">
    <p class="kicker">Séance</p>
    <h1>${scope.oeuvre ? 'Rien de neuf pour cette œuvre aujourd\'hui.' : 'Tout est à jour.'}</h1>
    <p>${scope.oeuvre ? 'Toutes ses cartes ont été vues et aucune n\'est due. Elles reviendront d\'elles-mêmes au bon moment.' : `Aucune révision n'est due et ${st.fresh ? 'les nouvelles notions attendent que vous ayez consolidé les précédentes' : 'toutes les notions ont été découvertes'}. Prochaine révision : ${nextDueLabel(Date.now())}.`}</p>
    <div class="actions">
      ${st.seen ? '<a class="btn" href="#/seance/libre">Revoir les notions les plus fragiles</a>' : ''}
      <a class="btn ghost" href="#/reflexion">Passer en mode réflexion</a>
      <a class="btn ghost" href="#/">Accueil</a>
    </div>
  </div>`);
}

function currentItem() { return session.items[session.index]; }

function renderItem() {
  const item = currentItem();
  if (!item) return renderSessionEnd();
  const total = session.items.length;
  const head = `<div class="session-head">
    <div class="session-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${session.index}" aria-label="Avancement de la séance"><span style="width:${(session.index / total) * 100}%"></span></div>
    <span class="session-count">${session.index + 1} / ${total}</span>
    <button class="linkbtn" data-action="quit">Interrompre</button>
  </div>`;
  if (item.type === 'intro') return render(head + renderIntro(item.oeuvre));
  const card = C.cardById.get(item.id);
  if (!card) { session.index++; return renderItem(); }
  render(head + renderCard(card, item));
  const ta = main.querySelector('textarea.free');
  if (ta) ta.value = ui.text || '';
}

function marginFor(card, item) {
  const comp = C.competences.find((c) => c.id === card.competence);
  const works = card.oeuvres.map((o) => `<span class="oeuvre-ref">${esc(oeuvreTitle(o))}<small>${esc(shortAuthor(oeuvreAuthor(o)))}</small></span>`).join('');
  return `<aside class="margin" aria-label="Repères">
    <span class="label">${esc(comp.label)}</span>
    ${works}
    ${item?.isNew ? '<span class="label is-new">Nouvelle notion</span>' : item?.relearn ? '<span class="label is-new">Deuxième passage</span>' : ''}
  </aside>`;
}

function sourceLine(card) {
  return `<div class="source-line">${natureTag(card.source.nature)} ${pageLink(card.source.pages)}
    <button class="linkbtn" data-action="report" data-target="Carte ${esc(card.id)} — ${esc(card.question.slice(0, 80))}">Signaler une erreur</button></div>`;
}

function renderIntro(oeuvreId) {
  if (oeuvreId === 'introduction') {
    const I = C.introduction;
    return `<article class="card-shell intro-card">
      <aside class="margin"><span class="label">Avant de commencer</span><span class="oeuvre-ref">${esc(I.titre)}<small>p. 82</small></span></aside>
      <div class="card-body">
        <h1 class="question">Qu'est-ce qu'un classique ?</h1>
        <div class="glance">${I.idees.map((t) => `<p>${esc(t)}</p>`).join('')}</div>
        <p class="hint">Le dossier promet trente œuvres ; le PDF fourni en couvre une vingtaine en détail (voir <a href="#/sources">Sources</a>).</p>
        <div class="actions"><button class="btn" data-action="intro-done" autofocus>Commencer</button></div>
      </div></article>`;
  }
  const o = C.byId.get(oeuvreId);
  const art = C.articles.get(o.article);
  return `<article class="card-shell intro-card">
    <aside class="margin"><span class="label">Nouvelle œuvre</span>${o.couvertures?.[0] ? coverImg(o.couvertures[0], 'margin-cover') : ''}<span class="oeuvre-ref">${esc(art.rubrique)}<small>${esc(art.auteurs)}</small></span></aside>
    <div class="card-body">
      <p class="kicker">En un regard</p>
      <h1 class="question"><em>${esc(o.titre)}</em></h1>
      <dl class="glance">
        <div><dt>Auteur · date</dt><dd>${esc(o.auteur)} · ${esc(o.date)} ${o.dateNature === 'repere' ? natureTag('repere') : ''}</dd></div>
        <div><dt>Contexte</dt><dd>${esc(o.contexte)}</dd></div>
        <div><dt>Question</dt><dd><em>${esc(o.question)}</em></dd></div>
        <div><dt>Idée centrale</dt><dd>${esc(o.ideeCentrale)}</dd></div>
      </dl>
      <div class="actions">
        <button class="btn" data-action="intro-done">J'ai lu, aux questions</button>
        <a class="linkbtn" href="#/oeuvre/${o.id}">Fiche complète</a>
      </div>
    </div></article>`;
}

function renderCard(card, item) {
  const body = {
    flashcard: renderFlashcard,
    qcm: renderChoice,
    actualite: renderChoice,
    relier: renderMatch,
    libre: renderFree,
  }[card.format](card);
  return `<article class="card-shell" data-card="${esc(card.id)}">${marginFor(card, item)}<div class="card-body">${body}</div></article>`;
}

function gradeButtons(card, suggested = 0) {
  const s = P().cards[card.id];
  const now = Date.now();
  return `<div class="grades" role="group" aria-label="Votre niveau de maîtrise">${[1, 2, 3, 4].map((g) =>
    `<button class="grade g${g}${g === suggested ? ' suggested' : ''}" data-action="grade" data-g="${g}"><span>${GRADE_LABELS[g]}</span><small>${esc(intervalLabel(review(s, g, now), now))} · ${g}</small></button>`).join('')}</div>`;
}

function blocks(card) {
  return `${card.exemple ? `<div class="answer-block example"><span class="label">Exemple</span>${esc(card.exemple)}</div>` : ''}
    ${card.explication ? `<div class="answer-block"><span class="label">Pourquoi</span>${esc(card.explication)}</div>` : ''}
    ${card.limites ? `<div class="answer-block limits"><span class="label">Limites du rapprochement</span>${esc(card.limites)}</div>` : ''}`;
}

function renderFlashcard(card) {
  if (!ui.revealed) {
    return `<h1 class="question">${esc(card.question)}</h1>
      <p class="prompt">Formulez votre réponse mentalement, puis révélez-la.</p>
      <div class="actions"><button class="btn" data-action="reveal">Révéler la réponse <span class="label" style="color:inherit">espace</span></button></div>`;
  }
  return `<h1 class="question">${esc(card.question)}</h1>
    <div class="reveal">
      <div class="answer-block answer"><span class="label">Réponse</span>${esc(card.reponse)}</div>
      ${blocks(card)}
      ${sourceLine(card)}
      ${gradeButtons(card)}
    </div>`;
}

function choiceOrder(card) {
  return shuffled(card.choix.map((t, i) => ({ t, i })), card.id + session.seed);
}

function renderChoice(card) {
  const order = choiceOrder(card);
  const answered = ui.choice != null;
  const isSituation = card.format === 'actualite';
  let q = esc(card.question);
  let situation = '';
  if (isSituation) {
    const cut = card.question.search(/\s(Quel|Quelle|Quels|Quelles)\b[^.?]*\?$/);
    if (cut > 0) { situation = card.question.slice(0, cut); q = esc(card.question.slice(cut + 1)); }
  }
  const list = order.map((o, k) => {
    let cls = '';
    if (answered) {
      if (o.i === card.correct) cls = 'correct';
      else if (o.i === ui.choice) cls = 'wrong';
      else cls = 'muted';
    }
    return `<li><button class="choice ${cls}" data-action="choose" data-i="${o.i}" ${answered ? 'disabled' : ''}><span class="key">${k + 1}</span><span>${esc(o.t)}</span></button></li>`;
  }).join('');
  const ok = ui.choice === card.correct;
  return `${situation ? `<div class="situation">${esc(situation)}</div>` : ''}
    <h1 class="question">${q}</h1>
    <ol class="choices">${list}</ol>
    ${answered ? `<div class="reveal">
      <p class="verdict ${ok ? 'ok' : 'ko'}">${ok ? 'Juste' : 'Pas tout à fait'}</p>
      ${blocks(card)}
      ${sourceLine(card)}
      <div class="after-qcm">
        <button class="btn" data-action="grade" data-g="${ok ? 3 : 1}" autofocus>Continuer</button>
        ${ok ? `<button class="linkbtn" data-action="grade" data-g="2">J'ai hésité (revoir plus tôt)</button>
                <button class="linkbtn" data-action="grade" data-g="4">C'était évident</button>` : ''}
      </div></div>` : ''}`;
}

function renderMatch(card) {
  const lefts = card.paires.map((p, i) => ({ t: p.gauche, i }));
  const rights = shuffled(card.paires.map((p, i) => ({ t: p.droite, i })), card.id + session.seed);
  ui.pairs ||= {};
  const pairs = ui.pairs; // gauche → droite
  const checked = ui.checked;
  const pairNumber = (side, i) => {
    const entries = Object.entries(pairs);
    const idx = side === 'l' ? entries.findIndex(([l]) => Number(l) === i) : entries.findIndex(([, r]) => r === i);
    return idx >= 0 ? idx + 1 : null;
  };
  const cls = (side, i) => {
    if (!checked) return (side === 'l' && ui.sel === i) ? 'selected' : '';
    if (side === 'l') return pairs[i] === i ? 'correct' : 'wrong';
    const l = Object.keys(pairs).find((k) => pairs[k] === i);
    return Number(l) === i ? 'correct' : 'wrong';
  };
  const all = Object.keys(pairs).length === card.paires.length;
  const okCount = Object.entries(pairs).filter(([l, r]) => Number(l) === r).length;
  return `<h1 class="question">${esc(card.question)}</h1>
    <p class="prompt">Touchez une œuvre, puis l'idée qui lui correspond.</p>
    <div class="match">
      <div class="match-col">${lefts.map((l) => { const n = pairNumber('l', l.i); return `<button class="match-item left ${cls('l', l.i)}" data-action="match-l" data-i="${l.i}" ${n ? `data-pair="${n}"` : ''} ${checked ? 'disabled' : ''}>${esc(l.t)}</button>`; }).join('')}</div>
      <div class="match-col">${rights.map((r) => { const n = pairNumber('r', r.i); return `<button class="match-item ${cls('r', r.i)}" data-action="match-r" data-i="${r.i}" ${n ? `data-pair="${n}"` : ''} ${checked ? 'disabled' : ''}>${esc(r.t)}</button>`; }).join('')}</div>
    </div>
    ${!checked ? `<div class="actions"><button class="btn" data-action="match-check" ${all ? '' : 'disabled'}>Vérifier</button>${Object.keys(pairs).length ? '<button class="linkbtn" data-action="match-reset">Tout défaire</button>' : ''}</div>` : `
    <div class="reveal">
      <p class="verdict ${okCount === card.paires.length ? 'ok' : 'ko'}">${okCount} association${okCount > 1 ? 's' : ''} juste${okCount > 1 ? 's' : ''} sur ${card.paires.length}</p>
      <ul class="pairs-solution">${card.paires.map((p) => `<li><em>${esc(p.gauche)}</em><span>${esc(p.droite)}</span></li>`).join('')}</ul>
      ${blocks(card)}
      ${sourceLine(card)}
      <div class="after-qcm"><button class="btn" data-action="grade" data-g="${okCount === card.paires.length ? 3 : okCount ? 2 : 1}">Continuer</button>
      ${okCount === card.paires.length ? '<button class="linkbtn" data-action="grade" data-g="4">C\'était évident</button>' : ''}</div>
    </div>`}`;
}

function renderFree(card) {
  if (!ui.revealed) {
    const last = P().cards[card.id]?.lastAnswer;
    return `<h1 class="question">${esc(card.question)}</h1>
      <label class="label" for="free-${esc(card.id)}">Votre réponse, avec vos mots</label>
      <textarea id="free-${esc(card.id)}" class="free" data-action="free-input" placeholder="Quelques phrases suffisent. Personne ne vous corrige mot à mot : vous comparerez vous-même avec la correction de référence."></textarea>
      ${last ? `<details class="more"><summary>Votre réponse lors du dernier passage</summary><p class="your-answer">${esc(last)}</p></details>` : ''}
      <div class="actions"><button class="btn" data-action="reveal">Comparer avec la correction</button><button class="linkbtn" data-action="reveal-blank">Je sèche</button></div>`;
  }
  ui.ticks ||= [];
  const ratio = card.points.length ? ui.ticks.filter(Boolean).length / card.points.length : 0;
  const suggested = ui.blank ? 1 : ratio >= 0.75 ? 3 : ratio >= 0.4 ? 2 : 1;
  return `<h1 class="question">${esc(card.question)}</h1>
    <div class="reveal">
      ${ui.text ? `<div class="answer-block"><span class="label">Vous avez écrit</span><p class="your-answer">${esc(ui.text)}</p></div>` : ''}
      <div class="answer-block answer"><span class="label">Correction de référence</span>${esc(card.reponse)}</div>
      <div class="answer-block"><span class="label">Avez-vous restitué ces idées ? (même formulées autrement)</span>
        <ul class="checklist">${card.points.map((pt, k) => `<li><label><input type="checkbox" data-action="tick" data-k="${k}" ${ui.ticks[k] ? 'checked' : ''}><span>${esc(pt)}</span></label></li>`).join('')}</ul>
      </div>
      ${blocks(card)}
      ${sourceLine(card)}
      <p class="hint">Suggestion d'après vos cases cochées ; c'est vous qui décidez.</p>
      ${gradeButtons(card, suggested)}
    </div>`;
}

function renderSessionEnd() {
  session.done = true;
  persistSession();
  const r = session.results;
  const ok = r.filter((x) => x.g >= 3).length;
  const again = r.filter((x) => x.g === 1).length;
  const minutes = Math.max(1, Math.round((Date.now() - session.startedAt) / MINUTE));
  const now = Date.now();
  const tomorrow = C.cards.filter((c) => { const s = P().cards[c.id]; return s?.due && s.due <= startOfDay(now) + 2 * DAY && s.due > now; }).length;
  const works = [...new Set(r.map((x) => C.cardById.get(x.id)?.oeuvres[0]).filter((o) => C.byId.has(o)))];
  const fragile = [...new Set(r.filter((x) => x.g <= 2).map((x) => x.id))].map((id) => C.cardById.get(id)).filter(Boolean);
  render(`<div class="session-end">
    <p class="kicker">Séance terminée</p>
    <h1>${ok >= r.length * 0.8 ? 'Belle séance.' : again ? 'Ce qui résiste reviendra bientôt.' : 'Séance terminée.'}</h1>
    <div class="stats-line">
      <div class="stat"><strong>${r.length}</strong><span>réponses</span></div>
      <div class="stat"><strong>${ok}</strong><span>bien retenues</span></div>
      <div class="stat"><strong>${minutes}</strong><span>minute${minutes > 1 ? 's' : ''}</span></div>
      <div class="stat"><strong>${tomorrow}</strong><span>à revoir demain</span></div>
    </div>
    ${fragile.length ? `<p class="label">À consolider</p><ul>${fragile.slice(0, 5).map((c) => `<li>${esc(c.question)} <span class="empty">— ${esc(oeuvreTitle(c.oeuvres[0]))}</span></li>`).join('')}</ul>` : ''}
    ${works.length ? `<p>Œuvres travaillées : ${works.map((o) => `<a href="#/oeuvre/${o}"><em>${esc(oeuvreTitle(o))}</em></a>`).join(', ')}.</p>` : ''}
    <div class="actions"><a class="btn" href="#/">Retour à l'accueil</a><a class="btn ghost" href="#/reflexion">Prolonger en mode réflexion</a></div>
  </div>`);
}

function recordGrade(g) {
  const item = currentItem();
  const card = C.cardById.get(item.id);
  const p = P();
  const now = Date.now();
  const next = review(p.cards[card.id], g, now);
  if (card.format === 'libre' && ui.text) next.lastAnswer = ui.text.slice(0, 2000);
  p.cards[card.id] = next;
  const k = dayKey(now);
  const d = (p.days[k] ||= { items: 0, reviews: 0, fresh: 0, again: 0, minutes: 0, acquired: 0 });
  d.items++;
  if (item.isNew) d.fresh++; else d.reviews++;
  if (g === 1) d.again++;
  d.minutes = +(d.minutes + Math.min(3, (now - session.lastAt) / MINUTE)).toFixed(2);
  d.acquired = countAcquired(p);
  const o = card.oeuvres[0];
  if (C.byId.has(o)) p.recent = [o, ...p.recent.filter((x) => x !== o)].slice(0, 8);
  store.save();
  session.results.push({ id: card.id, g, isNew: !!item.isNew });
  if (g === 1) session.items = requeue(session.items, session.index, card.id);
  session.lastAt = now;
  advance();
}

function advance() {
  session.index++;
  ui = {};
  persistSession();
  renderItem();
}

/* ————————————————— bibliothèque ————————————————— */

function dotsFor(oeuvreId) {
  const cards = (C.cardsByOeuvre.get(oeuvreId) || []).filter((c) => c.oeuvres[0] === oeuvreId);
  const m = compMastery(cards);
  const p = P();
  return `<span class="dots" aria-label="Maîtrise par compétence">${[1, 2, 3].map((k) => {
    const list = cards.filter((c) => c.competence === k);
    if (!list.length) return '';
    const seen = list.some((c) => !isNew(p.cards[c.id]));
    const v = m[k] || 0;
    const lvl = !seen ? '' : v >= 0.85 ? 'l3' : v >= 0.4 ? 'l2' : 'l1';
    return `<span class="dot ${lvl}" title="${esc(C.competences[k - 1].label)} : ${seen ? Math.round(v * 100) + ' %' : 'non commencé'}"></span>`;
  }).join('')}</span>`;
}

function entryHtml(o) {
  const c = o.couvertures?.[0];
  return `<a class="entry${c ? ' has-cover' : ''}" href="#/oeuvre/${o.id}">
    ${c ? coverImg(c, 'entry-cover') : ''}<span class="entry-title">${esc(o.titre)}</span>${dotsFor(o.id)}
    <span class="entry-meta">${esc(shortAuthor(o.auteur))} · ${esc(o.date)}</span>
    <span class="entry-q">${esc(o.question)}</span></a>`;
}

function viewLibrary() {
  render(`
    <header class="page-head">
      <p class="kicker">Bibliothèque des classiques</p>
      <h1>Index des œuvres</h1>
      <p>${C.oeuvres.length} œuvres analysées dans les pages fournies du dossier, classées par article. Les points indiquent votre maîtrise : l'œuvre, ses idées, son rapport au présent.</p>
    </header>
    <div class="searchbar" role="search">
      <label class="sr-only" for="lib-q">Rechercher</label>
      <input id="lib-q" type="search" placeholder="Auteur, titre, notion, thème…" value="${esc(libState.q)}" data-action="lib-search" autocomplete="off">
      <div class="seg" role="group" aria-label="Classement">
        <button data-action="lib-sort" data-v="rubrique" aria-pressed="${libState.sort === 'rubrique'}">Par article</button>
        <button data-action="lib-sort" data-v="az" aria-pressed="${libState.sort === 'az'}">A–Z</button>
      </div>
    </div>
    <div class="chips" role="group" aria-label="Thèmes">
      <button class="chip" data-action="lib-theme" data-v="" aria-pressed="${!libState.theme}">Tous les thèmes</button>
      ${[...C.themes.values()].map((t) => `<button class="chip" data-action="lib-theme" data-v="${t.id}" aria-pressed="${libState.theme === t.id}">${esc(t.label)}</button>`).join('')}
    </div>
    <div id="lib-results">${libraryResults()}</div>
    <section class="announced">
      <p class="label">Annoncées dans l'introduction, absentes des pages fournies</p>
      <ul>${C.annoncees.map((a) => `<li><em>${esc(a.titre)}</em> — ${esc(a.mention)} <span class="empty">(p. ${a.page})</span></li>`).join('')}</ul>
      <p class="hint">Le PDF s'arrête à la page 124 du magazine. Ces œuvres ne font l'objet d'aucune fiche ni question tant que leur article n'a pas été vérifié. <a href="#/sources">En savoir plus</a>.</p>
    </section>`);
}

function libraryResults() {
  const list = search(C, libState.q, libState.theme);
  if (!list.length) return `<p class="empty">Aucune œuvre ne correspond. Essayez un nom d'auteur, un concept (« fake news », « populisme », « fidélité »…) ou retirez le filtre de thème.</p>`;
  if (libState.sort === 'az') {
    const sorted = [...list].sort((a, b) => a.titre.localeCompare(b.titre, 'fr', { ignorePunctuation: true }));
    return `<div class="index">${sorted.map(entryHtml).join('')}</div>`;
  }
  const groups = new Map();
  for (const o of list) {
    if (!groups.has(o.article)) groups.set(o.article, []);
    groups.get(o.article).push(o);
  }
  return `<div class="index">${[...groups.entries()].map(([aid, os]) => {
    const a = C.articles.get(aid);
    return `<section class="index-group"><h2>${esc(a.rubrique)}<small>« ${esc(a.titre)} » · ${esc(a.auteurs)} · p. ${esc(a.pagesMagazine)}</small></h2>${os.map(entryHtml).join('')}</section>`;
  }).join('')}</div>`;
}

/* ————————————————— fiche d'œuvre ————————————————— */

function viewOeuvre(id) {
  const o = C.byId.get(id);
  if (!o) return render(`<p class="empty">Œuvre introuvable. <a href="#/bibliotheque">Bibliothèque</a></p>`);
  const a = C.articles.get(o.article);
  const own = (C.cardsByOeuvre.get(id) || []).filter((c) => c.oeuvres[0] === id);
  const m = compMastery(C.cardsByOeuvre.get(id) || []);
  const links = C.liens.rapprochements.filter((r) => r.oeuvres.includes(id));
  render(`
  <div class="fiche">
    <article>
      <header class="fiche-head${o.couvertures?.length ? ' has-cover' : ''}">
        ${o.couvertures?.length ? `<div class="covers">${o.couvertures.map((c) => `<figure>${coverImg(c)}${o.couvertures.length > 1 ? `<figcaption>${esc(c.legende)}</figcaption>` : ''}</figure>`).join('')}</div>` : ''}
        <div>
          <p class="kicker">${esc(a.rubrique)} · « ${esc(a.titre)} »</p>
          <h1>${esc(o.titre)}</h1>
          <p class="by">${esc(o.auteur)} <span>· ${esc(o.date)}</span> ${o.dateNature === 'repere' ? natureTag('repere') : ''}</p>
        </div>
      </header>

      <section>
        <h2>En un regard</h2>
        <p class="fquestion">${esc(o.question)}</p>
        <p class="central">${esc(o.ideeCentrale)}</p>
        <p style="margin-top:1rem">${esc(o.contexte)}</p>
      </section>

      <section>
        <h2>Ce qu'il faut retenir</h2>
        <ol class="ideas">${o.idees.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
        <div class="answer-block example"><span class="label">Exemple tiré de l'article</span>${esc(o.exemple)}</div>
        <div class="notion"><span class="label">Notion</span><br><strong>${esc(o.notion.terme)}</strong> — ${esc(o.notion.definition)}</div>
        ${o.citations.map((c) => `<blockquote class="quote">« ${esc(c.texte)} »<cite>${esc(c.attribution)} · p. ${c.page}</cite></blockquote>`).join('')}
      </section>

      <section>
        <h2>Pourquoi cela compte aujourd'hui</h2>
        <div class="split">
          <div class="labeled mag"><span class="label">Selon le dossier ${natureTag('magazine')}</span>${esc(o.aujourdhui.magazine)}</div>
          <div class="labeled app"><span class="label">Piste de réflexion de l'application ${natureTag('prolongement')}</span>${esc(o.aujourdhui.piste)}</div>
          <div class="thought" style="margin-top:.4rem"><p class="label">Pour prolonger</p><p>${esc(o.questionReflexion)}</p></div>
        </div>
      </section>

      <section>
        <h2>Pour aller plus loin</h2>
        <div class="answer-block limits"><span class="label">Limites et ambiguïtés de l'interprétation</span>${esc(o.limites)}</div>
        <details class="more" ${o.approfondir.length ? '' : 'hidden'}>
          <summary>Compléments tirés du dossier</summary>
          <ul>${o.approfondir.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        </details>
        <details class="more">
          <summary>Référence de l'article</summary>
          <p>${esc(a.auteurs)}, « ${esc(a.titre)} » (rubrique ${esc(a.rubrique)}), <em>Le Magazine littéraire</em>, n° 581-582, juillet-août 2017, p. ${esc(a.pagesMagazine)} (PDF p. ${esc(a.pagesPdf)}).</p>
          ${a.presentation ? `<p class="hint">${esc(a.presentation)}</p>` : ''}
          <p class="hint">Chapô : « ${esc(a.chapo)} »</p>
        </details>
      </section>
    </article>

    <aside class="fiche-side">
      <div class="side-box">
        <h3>Votre maîtrise</h3>
        ${[1, 2, 3, 4].filter((k) => m[k] != null).map((k) => `<div class="comp-row"><span>${esc(C.competences[k - 1].court)}</span><div class="bar"><span style="width:${Math.round(m[k] * 100)}%"></span></div><b>${Math.round(m[k] * 100)}%</b></div>`).join('')}
        <p class="hint">${plural(own.length, 'carte propre', 'cartes propres')} à cette œuvre${links.length ? `, ${plural(links.length, 'rapprochement', 'rapprochements')}` : ''}.</p>
        <a class="btn small" href="#/seance/oeuvre/${o.id}">Étudier cette œuvre</a>
      </div>
      <div class="side-box">
        <h3>Source</h3>
        <p>${pageLink(o.pages.magazine)}</p>
        ${hasPdf() ? '' : `<p class="hint">Associez votre exemplaire du PDF dans les <a href="#/reglages">réglages</a> pour ouvrir directement la page.</p>`}
        <p class="verif ${o.verification.statut}"><b>${o.verification.statut === 'verifie' ? 'Vérifié sur les pages originales' : 'Partiellement vérifié'}</b> — ${esc(o.verification.notes)}</p>
        <button class="linkbtn" data-action="report" data-target="Fiche « ${esc(o.titre)} »">Signaler une erreur sur cette fiche</button>
      </div>
      ${links.length ? `<div class="side-box"><h3>Rapprochements</h3>${links.map((r) => `<p><a href="#/reflexion" data-action="goto-link" data-id="${r.id}">${esc(r.titre)}</a><br><span class="empty">avec ${r.oeuvres.filter((x) => x !== id).map((x) => esc(oeuvreTitle(x))).join(', ')}</span></p>`).join('')}</div>` : ''}
      <div class="side-box"><h3>Thèmes</h3><p>${o.themes.map((t) => esc(C.themes.get(t)?.label)).join(' · ')}</p></div>
    </aside>
  </div>`);
}

/* ————————————————— réflexion ————————————————— */

function viewReflexion() {
  const R = C.liens.rapprochements.filter((r) => !refState.theme || r.theme === refState.theme);
  const Q = C.liens.questionsOuvertes.filter((q) => !refState.theme || q.theme === refState.theme);
  const notes = P().notes || {};
  const themesUsed = [...new Set(C.liens.rapprochements.map((r) => r.theme).concat(C.liens.questionsOuvertes.map((q) => q.theme)))];
  render(`
    <header class="page-head">
      <p class="kicker">Mode réflexion</p>
      <h1>Relier les œuvres, éclairer le présent</h1>
      <p>Des rapprochements argumentés entre classiques, avec ce qui les unit, ce qui les oppose et ce qu'il ne faut pas forcer. Un carnet personnel, enregistré sur cet appareil, accueille vos réflexions.</p>
      <div class="legend">
        <div><span class="badge explicite">Lien établi par le dossier</span><span class="empty">le rapprochement figure dans un article</span></div>
        <div><span class="badge propose">Rapprochement proposé</span><span class="empty">suggéré par l'application à partir de deux articles</span></div>
      </div>
    </header>
    <div class="chips" role="group" aria-label="Thèmes">
      <button class="chip" data-action="ref-theme" data-v="" aria-pressed="${!refState.theme}">Tous</button>
      ${themesUsed.map((t) => `<button class="chip" data-action="ref-theme" data-v="${t}" aria-pressed="${refState.theme === t}">${esc(C.themes.get(t)?.label || t)}</button>`).join('')}
    </div>
    <div class="links">
      ${R.map((r) => `<article class="link-card" id="lien-${r.id}">
        <div><span class="badge ${r.fondement}">${r.fondement === 'explicite' ? 'Lien établi par le dossier' : 'Rapprochement proposé'}</span></div>
        <h2>${esc(r.titre)}</h2>
        <p class="link-works">${r.oeuvres.map((o) => `<a href="#/oeuvre/${o}">${esc(oeuvreTitle(o))}</a>`).join(' · ')}</p>
        <p class="hint" style="margin-top:0">${esc(r.fondementTexte)}</p>
        <dl>
          <div><dt>Convergences</dt><dd><ul>${r.convergences.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></dd></div>
          <div><dt>Oppositions</dt><dd><ul>${r.oppositions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></dd></div>
          <div><dt>Nuances</dt><dd>${esc(r.nuances)}</dd></div>
        </dl>
        <div class="link-q">
          <p>${esc(r.question)}</p>
          <label class="sr-only" for="note-${r.id}">Votre réflexion</label>
          <textarea class="notebook" id="note-${r.id}" data-action="note" data-id="${r.id}" placeholder="Votre réflexion (carnet personnel)…">${esc(notes[r.id] || '')}</textarea>
        </div>
      </article>`).join('') || '<p class="empty">Aucun rapprochement pour ce thème.</p>'}
    </div>
    ${Q.length ? `<section class="prose" style="margin-top:2.5rem">
      <h2>Questions ouvertes</h2>
      <ul class="open-questions">${Q.map((q, i) => `<li><span class="label">${esc(C.themes.get(q.theme)?.label)}</span><p>${esc(q.question)}</p><span class="empty">${q.oeuvres.map((o) => `<a href="#/oeuvre/${o}">${esc(oeuvreTitle(o))}</a>`).join(' · ')}</span></li>`).join('')}</ul>
    </section>` : ''}`);
  if (ui.scrollTo) {
    document.getElementById(`lien-${ui.scrollTo}`)?.scrollIntoView({ block: 'start' });
    ui.scrollTo = null;
  }
}

/* ————————————————— progression ————————————————— */

function viewProgress() {
  const now = Date.now();
  const st = computeStats(now);
  const p = P();
  const m = compMastery(C.cards);
  const days28 = studyDays(28, now);
  // calendrier : 4 semaines, du lundi au dimanche
  const today = startOfDay(now);
  const dow = (new Date(today).getDay() + 6) % 7;
  const start = today - (dow + 21) * DAY;
  const cells = [];
  for (let i = 0; i < 28; i++) {
    const t = start + i * DAY;
    const d = p.days[dayKey(t + 12 * 3600 * 1000)];
    const on = d?.items ? (d.items >= 8 ? 'on' : 'on light') : '';
    cells.push(`<span class="d ${on} ${t === today ? 'today' : ''}" title="${new Date(t).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}${d?.items ? ` : ${d.items} réponses` : ''}"></span>`);
  }
  // évolution des notions acquises
  const series = Object.entries(p.days).filter(([, d]) => d.acquired != null).sort(([a], [b]) => a.localeCompare(b));
  // prévision sur 7 jours
  const forecast = [];
  for (let i = 0; i < 7; i++) {
    const from = i === 0 ? -Infinity : today + i * DAY;
    const to = today + (i + 1) * DAY;
    forecast.push(C.cards.filter((c) => { const s = p.cards[c.id]; return s?.due != null && s.due >= from && s.due < to; }).length);
  }
  const fmax = Math.max(1, ...forecast);
  const rows = C.oeuvres.map((o) => {
    const mm = compMastery(C.cardsByOeuvre.get(o.id) || []);
    const cell = (k) => mm[k] == null ? '<td class="c">—</td>' : `<td class="c">${Math.round(mm[k] * 100)}%</td>`;
    return `<tr><td><a href="#/oeuvre/${o.id}">${esc(o.titre)}</a></td>${[1, 2, 3, 4].map(cell).join('')}</tr>`;
  }).join('');

  render(`
    <header class="page-head">
      <p class="kicker">Progression</p>
      <h1>Ce que vous retenez</h1>
      <p>Une notion n'est « acquise » qu'après trois réussites consécutives et un intervalle d'au moins trois semaines. Les notions acquises reviennent quand même, au moins tous les quatre mois.</p>
    </header>
    <div class="kpis">
      <div class="kpi"><strong>${st.seen}</strong><span>Notions découvertes</span><p>sur ${st.total}</p></div>
      <div class="kpi"><strong>${st.acquired}</strong><span>Notions acquises</span><p>${Math.round((st.acquired / st.total) * 100)} % de l'ensemble</p></div>
      <div class="kpi"><strong>${st.fragile}</strong><span>À consolider</span><p>dernière réponse hésitante ou oubliée</p></div>
      <div class="kpi"><strong>${days28}</strong><span>Jours d'étude</span><p>sur les 28 derniers jours</p></div>
    </div>
    <div class="prog-grid">
      <section class="prog-block">
        <h2>Par compétence</h2>
        ${[1, 2, 3, 4].map((k) => `<div class="comp-row" style="grid-template-columns: 9.5rem 1fr 2.4rem"><span>${esc(C.competences[k - 1].label)}</span><div class="bar"><span style="width:${Math.round((m[k] || 0) * 100)}%"></span></div><b>${Math.round((m[k] || 0) * 100)}%</b></div>`).join('')}
        <p class="hint">Maîtrise moyenne des cartes de chaque compétence (0 % tant qu'une carte n'a pas été vue).</p>
      </section>
      <section class="prog-block">
        <h2>Régularité</h2>
        <div class="calendar" aria-label="Jours d'étude des quatre dernières semaines">
          ${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x) => `<span class="dow">${x}</span>`).join('')}
          ${cells.join('')}
        </div>
        <p class="hint">Case foncée : séance complète (8 réponses ou plus) ; claire : séance courte.</p>
      </section>
      <section class="prog-block chart">
        <h2>Évolution des notions acquises</h2>
        ${series.length >= 2 ? lineChart(series.map(([k, d]) => [k, d.acquired]), st.total) : '<p class="empty">La courbe apparaîtra après quelques jours de pratique.</p>'}
      </section>
      <section class="prog-block">
        <h2>Révisions des sept prochains jours</h2>
        <div class="forecast">${forecast.map((n, i) => `<div><b>${n}</b><i style="height:${(n / fmax) * 70}%"></i><span>${i === 0 ? 'auj.' : new Date(today + i * DAY).toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')}</span></div>`).join('')}</div>
      </section>
    </div>
    <section class="prog-block" style="margin-top:2.5rem">
      <h2>Par œuvre</h2>
      <div style="overflow-x:auto"><table class="table-oeuvres"><thead><tr><th>Œuvre</th><th>Œuvre</th><th>Idées</th><th>Présent</th><th>Liens</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>
    <p style="margin-top:2rem"><a class="btn ghost" href="#/reglages">Sauvegarde, export et réglages</a></p>`);
}

function lineChart(points, total) {
  const W = 480, H = 180, pad = 28;
  const n = points.length;
  const max = Math.max(total * 0.25, ...points.map(([, v]) => v), 1);
  const x = (i) => pad + (i * (W - pad * 1.5)) / Math.max(1, n - 1);
  const y = (v) => H - pad - (v / max) * (H - pad * 1.6);
  const d = points.map(([, v], i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${d} L${x(n - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  const fmt = (k) => { const [, mo, da] = k.split('-'); return `${Number(da)}/${Number(mo)}`; };
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Notions acquises au fil des jours">
    <line class="axis" x1="${pad}" y1="${H - pad}" x2="${W - pad / 2}" y2="${H - pad}"/>
    <path class="area" d="${area}"/><path class="line" d="${d}"/>
    <text x="${pad}" y="${H - 8}">${fmt(points[0][0])}</text>
    <text x="${W - pad / 2}" y="${H - 8}" text-anchor="end">${fmt(points[n - 1][0])}</text>
    <text x="${pad - 4}" y="${y(points[n - 1][1]) + 4}" text-anchor="end">${points[n - 1][1]}</text>
  </svg>`;
}

/* ————————————————— réglages ————————————————— */

function viewSettings() {
  const p = P();
  const w = store.warning();
  render(`
    <header class="page-head"><p class="kicker">Réglages</p><h1>Sauvegarde et préférences</h1>
    <p>Votre progression est enregistrée dans ce navigateur, sur cet appareil uniquement. Aucun compte, aucun serveur : exportez-la régulièrement pour ne pas la perdre ou pour la transférer sur un autre appareil.</p></header>
    ${w ? `<p class="warn">${esc(w)}</p>` : ''}
    <div class="settings">
      <section class="setting">
        <h2>Longueur des séances</h2>
        <p>Nombre de cartes visé par séance (révisions et nouveautés).</p>
        <div class="seg" role="group" aria-label="Taille de séance">${[10, 15, 20].map((n) => `<button data-action="set-size" data-v="${n}" aria-pressed="${p.settings.size === n}">${n} cartes · ~${Math.round(n * 0.9)} min</button>`).join('')}</div>
      </section>
      <section class="setting">
        <h2>Apparence</h2>
        <div class="seg" role="group" aria-label="Thème">${[['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']].map(([v, l]) => `<button data-action="set-theme" data-v="${v}" aria-pressed="${p.settings.theme === v}">${l}</button>`).join('')}</div>
      </section>
      <section class="setting">
        <h2>Exporter, importer</h2>
        <p>L'export produit un fichier JSON contenant vos états de révision, votre historique, votre carnet et vos signalements. L'import remplace la progression actuelle (les anciens formats sont convertis automatiquement).</p>
        <div class="actions">
          <button class="btn" data-action="export">Exporter ma progression</button>
          <label class="btn ghost file-label">Importer un fichier<input type="file" accept="application/json,.json" data-action="import"></label>
        </div>
      </section>
      <section class="setting">
        <h2>Votre exemplaire du PDF</h2>
        <p>Le dossier du magazine n'est pas publié avec l'application (droits d'auteur). Si vous en possédez le PDF, associez-le : il reste sur cet appareil, et chaque fiche ouvre directement la bonne page.</p>
        <div class="actions">
          ${hasPdf() ? `<span class="label" style="color:var(--ok)">PDF associé</span><button class="btn ghost small" data-action="pdf-remove">Retirer</button>` : `<label class="btn ghost file-label">Associer le PDF<input type="file" accept="application/pdf,.pdf" data-action="pdf-add"></label>`}
        </div>
      </section>
      <section class="setting">
        <h2>Signalements</h2>
        ${p.reports.length ? `<ul class="report-list">${p.reports.slice().reverse().map((r) => `<li><b>${esc(r.target)}</b> — ${esc(r.text)} <span class="empty">(${new Date(r.t).toLocaleDateString('fr-FR')})</span></li>`).join('')}</ul>
        <div class="actions"><button class="btn ghost small" data-action="copy-reports">Copier les signalements</button><a class="btn ghost small" href="${REPO}/issues" target="_blank" rel="noopener">Tickets du projet ↗</a></div>` : '<p class="empty">Aucun signalement. Le lien « Signaler une erreur » figure sur chaque fiche et chaque carte.</p>'}
      </section>
      <section class="setting">
        <h2>Recommencer</h2>
        <p>Efface toute la progression de cet appareil. Exportez-la d'abord si vous souhaitez la conserver.</p>
        <button class="btn ghost small" data-action="reset">Effacer ma progression</button>
      </section>
    </div>`);
}

function download(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ————————————————— sources ————————————————— */

function viewSources() {
  const partial = C.oeuvres.filter((o) => o.verification.statut !== 'verifie');
  const repere = C.oeuvres.filter((o) => o.dateNature === 'repere');
  render(`<article class="prose">
    <p class="kicker">Sources et méthode</p>
    <h1 style="font-size:clamp(1.9rem,5vw,2.6rem)">D'où viennent les contenus</h1>
    <p>L'application s'appuie exclusivement sur le dossier « ${esc(C.meta.dossier)} », ${esc(C.meta.magazine)}, ${esc(C.meta.numero)}, ${esc(C.meta.date)}, coordonné par ${esc(C.meta.coordination)}.</p>
    <h2>Méthode documentaire</h2>
    <ul>
      <li>Le PDF fourni (${C.meta.pagesPdf} pages, photographies du magazine) a été relu page par page sur l'image ; la reconnaissance de texte, très fautive, n'a servi que d'aide. Les pages photographiées de biais ou à l'envers ont été redressées pour la lecture.</li>
      <li>Titres, auteurs, pages, concepts et citations ont été contrôlés sur les pages originales. Les citations sont brèves et attribuées.</li>
      <li>Les textes des fiches sont des reformulations pédagogiques ; les articles ne sont pas reproduits.</li>
      <li>${esc(C.meta.correspondance)}</li>
    </ul>
    <h2>Ce que signifient les étiquettes</h2>
    <div class="legend">${Object.entries(C.legende).map(([k, v]) => `<div>${natureTag(k)}<span>${esc(v)}</span></div>`).join('')}</div>
    <h2>Périmètre : pourquoi pas trente fiches ?</h2>
    <p>${esc(C.meta.perimetre)}</p>
    <p>Les pages fournies traitent en détail <strong>${C.oeuvres.length} œuvres</strong>, réparties dans ${C.articles.size} articles : œuvres principales d'un article, rubriques d'un article collectif (terrorisme) et œuvres présentées dans les encadrés « À lire » et discutées dans le texte. Les œuvres seulement citées en passant (Phèdre, Les Lettres persanes, Discours de la servitude volontaire, Richard III, Mémoires d'Hadrien…) ne font pas l'objet d'une fiche.</p>
    <p>Quatre œuvres sont annoncées dans l'introduction sans article dans les pages fournies : ${C.annoncees.map((a) => `<em>${esc(a.titre)}</em>`).join(', ')}. Elles ne nourrissent aucune question. Les autres classiques du dossier (au-delà de la page 124) restent à identifier.</p>
    <h2>Points à vérifier</h2>
    <ul>${partial.map((o) => `<li><a href="#/oeuvre/${o.id}"><em>${esc(o.titre)}</em></a> — ${esc(o.verification.notes)}</li>`).join('')}
      <li>Page PDF 25 (magazine p. 107, extrait de <em>La Chanson de Roland</em>) : photo floue, contenu non exploité.</li>
      <li>Page 83 du magazine absente du PDF.</li>
    </ul>
    <p>Dates données à titre de repère général (absentes des articles) : ${repere.map((o) => `<em>${esc(o.titre)}</em>`).join(', ')}.</p>
    <h2>Méthode d'apprentissage</h2>
    <p>Chaque carte possède son propre état de révision. Les notes « À revoir », « Difficile », « Bien retenu », « Facile » règlent l'intervalle avant la prochaine révision : 10 minutes après un oubli, puis 1, 3 jours, et des intervalles qui s'allongent selon votre facilité, freinés par vos oublis passés, plafonnés à 120 jours. Quatre compétences sont suivies séparément : connaître l'œuvre, comprendre ses idées, penser le présent, comparer.</p>
    <h2>Droits</h2>
    <p>Les analyses résumées appartiennent à leurs auteurs et au <em>Magazine littéraire</em>. Cette application à visée d'étude n'en reproduit pas les articles et ne diffuse pas le PDF.</p>
  </article>`);
}

/* ————————————————— signalements ————————————————— */

function openReport(target) {
  const dlg = document.getElementById('report-dialog');
  dlg.querySelector('.report-target').textContent = target;
  dlg.querySelector('#report-text').value = '';
  dlg.dataset.target = target;
  dlg.showModal();
}

function setupReport() {
  const dlg = document.getElementById('report-dialog');
  dlg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[value]');
    if (!btn) return;
    e.preventDefault();
    const text = dlg.querySelector('#report-text').value.trim();
    const target = dlg.dataset.target;
    if (btn.value !== 'cancel') {
      if (!text) { toast('Décrivez l\'erreur en quelques mots.'); return; }
      P().reports.push({ t: Date.now(), target, text, url: location.hash });
      store.save();
      if (btn.value === 'github') {
        const body = `**Élément :** ${target}\n**Page de l'application :** ${location.hash}\n\n${text}\n`;
        window.open(`${REPO}/issues/new?title=${encodeURIComponent(`Correction : ${target.slice(0, 80)}`)}&body=${encodeURIComponent(body)}`, '_blank', 'noopener');
      }
      toast('Signalement enregistré. Merci !');
    }
    dlg.close();
  });
}

/* ————————————————— interactions ————————————————— */

function applyTheme() {
  const t = P().settings.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

main.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  switch (a) {
    case 'quit': session.done = true; persistSession(); location.hash = '#/'; break;
    case 'intro-done': {
      const it = currentItem();
      P().opened[it.oeuvre] = Date.now();
      store.save();
      advance();
      break;
    }
    case 'reveal': ui.revealed = true; renderItem(); main.querySelector('.reveal')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); break;
    case 'reveal-blank': ui.revealed = true; ui.blank = true; renderItem(); break;
    case 'choose': if (ui.choice == null) { ui.choice = Number(el.dataset.i); renderItem(); main.querySelector('.reveal')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } break;
    case 'grade': recordGrade(Number(el.dataset.g)); break;
    case 'tick': { ui.ticks ||= []; ui.ticks[Number(el.dataset.k)] = el.checked; const y = window.scrollY; renderItem(); window.scrollTo(0, y); break; }
    case 'match-l': { const i = Number(el.dataset.i); if (ui.pairs?.[i] != null) { delete ui.pairs[i]; ui.sel = null; } else ui.sel = ui.sel === i ? null : i; renderItem(); break; }
    case 'match-r': {
      const r = Number(el.dataset.i);
      ui.pairs ||= {};
      const owner = Object.keys(ui.pairs).find((k) => ui.pairs[k] === r);
      if (owner != null) delete ui.pairs[owner];
      if (ui.sel != null) { ui.pairs[ui.sel] = r; ui.sel = null; }
      renderItem();
      break;
    }
    case 'match-reset': ui.pairs = {}; ui.sel = null; renderItem(); break;
    case 'match-check': ui.checked = true; renderItem(); break;
    case 'report': openReport(el.dataset.target); break;
    case 'lib-sort': libState.sort = el.dataset.v; viewLibrary(); break;
    case 'lib-theme': libState.theme = el.dataset.v; viewLibrary(); break;
    case 'ref-theme': refState.theme = el.dataset.v; viewReflexion(); break;
    case 'goto-link': e.preventDefault(); refState.theme = ''; ui.scrollTo = el.dataset.id; location.hash = '#/reflexion'; break;
    case 'set-size': P().settings.size = Number(el.dataset.v); store.save(); if (session && !session.done && session.key === 'jour' && session.index === 0) session = null; viewSettings(); toast('Taille de séance enregistrée.'); break;
    case 'set-theme': P().settings.theme = el.dataset.v; store.save(); applyTheme(); viewSettings(); break;
    case 'export': download(`instant-critique-${dayKey()}.json`, exportText(P())); toast('Progression exportée.'); break;
    case 'pdf-remove': await removePdf(); viewSettings(); toast('PDF retiré de cet appareil.'); break;
    case 'copy-reports': {
      const txt = P().reports.map((r) => `- [${new Date(r.t).toLocaleDateString('fr-FR')}] ${r.target} : ${r.text}`).join('\n');
      try { await navigator.clipboard.writeText(txt); toast('Signalements copiés.'); } catch { toast('Copie impossible : utilisez l\'export.'); }
      break;
    }
    case 'reset':
      if (confirm('Effacer définitivement toute la progression enregistrée sur cet appareil ?')) {
        store.reset(); session = null; sessionStorage.removeItem('instant-critique-session'); applyTheme(); viewSettings(); toast('Progression effacée.');
      }
      break;
    default: break;
  }
});

main.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.action === 'free-input') ui.text = el.value;
  if (el.dataset.action === 'note') {
    const p = P();
    p.notes ||= {};
    p.notes[el.dataset.id] = el.value;
    clearTimeout(main.noteTimer);
    main.noteTimer = setTimeout(() => store.save(), 400);
  }
  if (el.dataset.action === 'lib-search') {
    libState.q = el.value;
    document.getElementById('lib-results').innerHTML = libraryResults();
  }
});

main.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.action === 'import' && el.files?.[0]) {
    try {
      const next = validateImport(await el.files[0].text());
      if (!confirm('Remplacer la progression actuelle par celle du fichier ?')) return;
      store.replace(next);
      session = null;
      applyTheme();
      viewSettings();
      toast('Progression importée.');
    } catch (err) { toast(err.message); }
  }
  if (el.dataset.action === 'pdf-add' && el.files?.[0]) {
    try { await savePdf(el.files[0]); viewSettings(); toast('PDF associé : les fiches ouvrent désormais la bonne page.'); } catch { toast('Impossible d\'enregistrer le PDF sur cet appareil.'); }
  }
});

document.addEventListener('keydown', (e) => {
  if (!location.hash.startsWith('#/seance') || !session || session.done) return;
  if (e.target.closest('textarea, input, dialog')) return;
  const item = currentItem();
  if (!item) return;
  const press = (sel) => { const b = main.querySelector(sel); if (b && !b.disabled) { e.preventDefault(); b.click(); } };
  if (item.type === 'intro' && (e.key === 'Enter' || e.key === ' ')) return press('[data-action="intro-done"]');
  const card = C.cardById.get(item.id);
  if (!card) return;
  if (e.key === ' ' || e.key === 'Enter') {
    if (main.querySelector('[data-action="reveal"]')) return press('[data-action="reveal"]');
    if (main.querySelector('.after-qcm .btn')) return press('.after-qcm .btn');
    if (main.querySelector('[data-action="match-check"]')) return press('[data-action="match-check"]');
  }
  if (/^[1-4]$/.test(e.key)) {
    const n = Number(e.key);
    if (main.querySelector('.grades')) return press(`.grades [data-g="${n}"]`);
    const choices = main.querySelectorAll('.choice:not([disabled])');
    if (choices[n - 1]) { e.preventDefault(); choices[n - 1].click(); }
  }
});

window.addEventListener('hashchange', () => { if (C) route(); });

/* ————————————————— démarrage ————————————————— */

async function start() {
  applyTheme();
  setupReport();
  restoreSession();
  try {
    C = await loadContent();
  } catch (err) {
    main.innerHTML = `<div class="view"><p class="warn">Le contenu n'a pas pu être chargé (${esc(err.message)}). Si vous ouvrez le fichier directement depuis le disque, lancez plutôt un petit serveur local (voir le README).</p></div>`;
    return;
  }
  await initPdf();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  route();
}

start();
