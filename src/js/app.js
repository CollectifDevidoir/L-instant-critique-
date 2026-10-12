import { loadContent, search, pdfPageFor } from './data.js';
import { createStore, exportText, validateImport, dayKey } from './store.js';
import { review, status, isDue, isNew, isAcquired, mastery, GRADE_LABELS, DAY, MINUTE, startOfDay } from './srs.js';
import { buildSession, requeue, eligibleNew, levelOf } from './session.js';
import { initPdf, savePdf, removePdf, hasPdf, pdfHref } from './pdf.js';

const REPO = 'https://github.com/CollectifDevidoir/L-instant-critique-';
const main = document.getElementById('main');
const store = createStore();
let C = null;            // contenu indexé
let session = null;      // séance en cours
let ui = {};             // état transitoire de l'élément affiché
let defi = null;         // partie de « Défi éclair » en cours
const libState = { q: '', theme: '' };
const refState = { theme: '', open: null };

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
  let s = hash(String(seed)) || 1;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show ${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = ''; }, 2600);
}

const isIntro = (id) => id === 'introduction';
const oeuvreTitle = (id) => (isIntro(id) ? 'Introduction du dossier' : C.byId.get(id)?.titre ?? id);
const shortTitle = (o) => o.titre.replace(/\s*\(.*\)$/, '').replace(/^« (.*) ».*$/, '$1');
const shortAuthor = (a) => a.replace(/\s*\(.*\)$/, '');

const NATURE_LABEL = { magazine: 'Dossier', synthese: 'Synthèse', prolongement: 'Prolongement', repere: 'Repère' };
function natureTag(n) {
  return `<span class="nature ${esc(n)}" title="${esc(C.legende[n] || '')}">${esc(NATURE_LABEL[n] || n)}</span>`;
}

function pageLink(magPages) {
  const first = parseInt(String(magPages).match(/\d+/)?.[0], 10);
  const pdf = pdfPageFor(first);
  const txt = `p. ${esc(magPages)}${pdf ? ` · PDF p. ${pdf}` : ''}`;
  if (pdf && hasPdf()) return `<a href="${pdfHref(pdf)}" target="_blank" rel="noopener">${txt} ↗</a>`;
  return `<span>${txt}</span>`;
}

function coverImg(c, cls = 'cover', alt = true) {
  return `<img class="${cls}" src="${esc(c.fichier)}" alt="${alt ? `Couverture : ${esc(c.legende)}` : ''}" width="${c.largeur}" height="${c.hauteur}" loading="lazy" decoding="async">`;
}
function coverOf(id, cls = 'cover', alt = true) {
  const c = C.byId.get(id)?.couvertures?.[0];
  if (c) return coverImg(c, cls, alt);
  return `<span class="${cls} cover-blank" aria-hidden="true">§</span>`;
}

function intervalLabel(state, now = Date.now()) {
  if (!state?.due) return '';
  const ms = state.due - now;
  if (ms < 60 * MINUTE) return `dans ${Math.max(1, Math.round(ms / MINUTE))} min`;
  const days = Math.round((state.due - startOfDay(now)) / DAY);
  if (days <= 1) return 'demain';
  if (days < 31) return `dans ${days} j`;
  return `dans ${Math.round(days / 30)} mois`;
}

/* ————————————————— glossaire : mots difficiles cliquables ————————————————— */

let glossRe = null;
const glossByForm = new Map();
const glossById = new Map();
function buildGloss() {
  const forms = [];
  for (const g of C.glossaire) {
    glossById.set(g.id, g);
    for (const f of g.formes) { forms.push(f); glossByForm.set(f.toLowerCase(), g); }
  }
  forms.sort((a, b) => b.length - a.length);
  const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  glossRe = forms.length ? new RegExp(`(?<![\\p{L}])(${forms.map(reEsc).join('|')})(?![\\p{L}])`, 'giu') : null;
}
// Texte échappé, avec la première occurrence de chaque terme du glossaire rendue cliquable.
function gl(text) {
  const safe = esc(text).replace(/&#39;/g, "'");
  if (!glossRe) return safe;
  const used = new Set();
  return safe.replace(glossRe, (m) => {
    const g = glossByForm.get(m.toLowerCase());
    if (!g || used.has(g.terme)) return m;
    used.add(g.terme);
    return `<button type="button" class="gloss" data-action="gloss" data-g="${g.id}">${m}</button>`;
  });
}
function showGloss(id, anchor) {
  const g = glossById.get(id);
  const panel = document.getElementById('gloss');
  if (!g || !panel) return;
  panel.innerHTML = `<b>${esc(g.terme)}</b><span>${esc(g.definition)}</span><button type="button" class="close" data-gloss-close aria-label="Fermer">✕</button>`;
  panel.hidden = false;
  if (anchor && matchMedia('(min-width: 760px)').matches) {
    const r = anchor.getBoundingClientRect();
    panel.style.left = `${Math.min(window.innerWidth - 340, Math.max(12, r.left))}px`;
    panel.style.top = `${r.bottom + 8}px`;
    panel.classList.add('floating');
  } else {
    panel.style.left = panel.style.top = '';
    panel.classList.remove('floating');
  }
}
function hideGloss() { const p = document.getElementById('gloss'); if (p) p.hidden = true; }

/* ————————————————— installation sur l'écran d'accueil ————————————————— */

let installEvent = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  if (C && (location.hash === '' || location.hash === '#/' || location.hash.startsWith('#/reglages'))) route();
});
window.addEventListener('appinstalled', () => { installEvent = null; toast('Application installée sur votre écran d\'accueil.'); });

function installHelp(short = false) {
  if (isStandalone()) return '<p class="ok-text">✓ Vous utilisez déjà l\'application installée.</p>';
  if (installEvent) return '<button class="btn" data-action="install">Installer sur cet appareil</button>';
  if (isIOS()) return '<p>Dans Safari : <b>Partager</b> <span aria-hidden="true">⬆︎</span> puis <b>Sur l\'écran d\'accueil</b>.</p>';
  if (short) return '<p>Menu du navigateur <b>⋮</b> › <b>Ajouter à l\'écran d\'accueil</b>.</p>';
  return '<p>Dans le menu de votre navigateur, choisissez <b>Installer l\'application</b> ou <b>Ajouter à l\'écran d\'accueil</b> (Chrome, Edge, Samsung Internet). Sur ordinateur, une icône d\'installation apparaît aussi dans la barre d\'adresse.</p>';
}

function installCard() {
  const p = P();
  if (isStandalone() || p.settings.installDismissed || !(installEvent || isIOS() || matchMedia('(pointer: coarse)').matches)) return '';
  return `<section class="install-card">
    <img src="assets/icons/icon-192.png" alt="" width="56" height="56">
    <div><b>Sur votre écran d'accueil</b><p>Ouvrez L'instant critique d'un geste, même hors connexion.</p>${installHelp(true)}</div>
    <button class="close" data-action="install-dismiss" aria-label="Masquer">✕</button>
  </section>`;
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
  return { total: C.cards.length, seen, acquired, fragile, due };
}

function compMastery(cards) {
  const p = P();
  const out = {};
  for (const comp of [1, 2, 3, 4]) {
    const list = cards.filter((c) => c.competence === comp);
    out[comp] = list.length ? list.reduce((s, c) => s + mastery(p.cards[c.id]), 0) / list.length : null;
  }
  return out;
}

// Avancement d'une œuvre : 0 = jamais ouverte, sinon part des cartes propres maîtrisées.
function bookProgress(id) {
  const p = P();
  const own = (C.cardsByOeuvre.get(id) || []).filter((c) => c.oeuvres[0] === id);
  const seen = own.filter((c) => !isNew(p.cards[c.id])).length;
  const acq = own.filter((c) => isAcquired(p.cards[c.id])).length;
  const m = own.length ? own.reduce((s, c) => s + mastery(p.cards[c.id]), 0) / own.length : 0;
  const level = !seen ? 0 : acq === own.length ? 3 : m >= 0.45 ? 2 : 1;
  return { seen, acq, total: own.length, m, level };
}
const LEVEL_LABEL = ['À découvrir', 'Entamé', 'Bien avancé', 'Maîtrisé'];

function notches(level) {
  return `<span class="notches l${level}" aria-label="${LEVEL_LABEL[level]}"><i></i><i></i><i></i></span>`;
}

const countAcquired = (p) => C.cards.filter((c) => isAcquired(p.cards[c.id])).length;

function streak(now = Date.now()) {
  const p = P();
  let n = 0;
  let t = now;
  if (!p.days[dayKey(t)]?.items) t -= DAY; // la série tient tant que la journée n'est pas finie
  while (p.days[dayKey(t)]?.items) { n++; t -= DAY; }
  return n;
}

function weekStrip(now = Date.now()) {
  const p = P();
  const today = startOfDay(now);
  const dow = (new Date(today).getDay() + 6) % 7;
  const monday = today - dow * DAY;
  return `<div class="week" aria-label="Jours d'étude de la semaine">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((l, i) => {
    const t = monday + i * DAY;
    const on = p.days[dayKey(t + 12 * 3600 * 1000)]?.items;
    return `<span class="wd ${on ? 'on' : ''} ${t === today ? 'today' : ''} ${t > today ? 'future' : ''}"><b>${on ? '✓' : ''}</b>${l}</span>`;
  }).join('')}</div>`;
}

/* ————————————————— routeur ————————————————— */

const routes = [
  [/^#?\/?$/, () => viewHome()],
  [/^#\/seance$/, () => viewSession()],
  [/^#\/seance\/oeuvre\/([\w-]+)$/, (m) => viewSession({ oeuvre: m[1] })],
  [/^#\/seance\/libre$/, () => viewSession({ libre: true })],
  [/^#\/bibliotheque$/, () => viewLibrary()],
  [/^#\/oeuvre\/([\w-]+)$/, (m) => viewOeuvre(m[1])],
  [/^#\/defi$/, () => viewDefi()],
  [/^#\/reflexion$/, () => viewReflexion()],
  [/^#\/progression$/, () => viewProgress()],
  [/^#\/reglages$/, () => viewSettings()],
  [/^#\/sources$/, () => viewSources()],
];

function navKey(h) {
  if (h.startsWith('#/bibliotheque') || h.startsWith('#/oeuvre')) return 'bibliotheque';
  if (h.startsWith('#/defi')) return 'defi';
  if (h.startsWith('#/reflexion')) return 'reflexion';
  if (h.startsWith('#/progression') || h.startsWith('#/reglages')) return 'progression';
  if (h.startsWith('#/sources')) return '';
  return 'accueil';
}

function route() {
  const h = location.hash || '#/';
  document.body.classList.toggle('focus-mode', h.startsWith('#/seance') || (h.startsWith('#/defi') && !!defi));
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === navKey(h)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) { fn(m); return; }
  }
  render(`<p class="empty">Page introuvable. <a href="#/">Retour à l'accueil</a>.</p>`);
}

function render(html, { focus = true, foot = true } = {}) {
  main.innerHTML = `<div class="view">${html}${foot ? footer() : ''}</div>`;
  if (focus) { main.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  const af = main.querySelector('[autofocus]');
  if (af && !matchMedia('(pointer: coarse)').matches) af.focus({ preventScroll: true });
  else if (document.activeElement && document.activeElement !== main && document.activeElement !== document.body) document.activeElement.blur();
}

function footer() {
  return `<footer class="footer-note">
    <span>D'après <em>Le Magazine littéraire</em>, n° 581-582, juillet-août 2017.</span>
    <a href="#/sources">Sources et méthode</a><a href="#/reglages">Sauvegarde et réglages</a>
  </footer>`;
}

/* ————————————————— accueil ————————————————— */

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
}

function viewHome() {
  const now = Date.now();
  const p = P();
  const st = computeStats(now);
  const plan = buildSession({ cards: C.cards, states: p.cards, oeuvreOrder: C.order, now, options: { size: p.settings.size } });
  const planCards = plan.filter((i) => i.type === 'card');
  const nNew = planCards.filter((i) => i.isNew).length;
  const nRev = planCards.length - nNew;
  const first = st.seen === 0;
  const doneToday = p.days[dayKey(now)]?.items || 0;
  const s = streak(now);
  const minutes = Math.max(3, Math.round(planCards.length * 0.8 + plan.filter((i) => i.type === 'intro').length));
  const books = plan.filter((i) => i.type === 'intro' && !isIntro(i.oeuvre)).map((i) => i.oeuvre);
  const upcoming = [...new Set([...books, ...planCards.map((i) => C.cardById.get(i.id)?.oeuvres[0]).filter((o) => C.byId.has(o))])].slice(0, 3);

  let todayCard;
  if (planCards.length) {
    todayCard = `<div class="today-card">
      <div class="stack" aria-hidden="true">${upcoming.map((o) => coverOf(o, 'stack-cover', false)).join('') || '<span class="stack-cover cover-blank">§</span>'}</div>
      <div class="today-body">
        <p class="kicker">${first ? 'Votre première séance' : doneToday ? 'On continue ?' : 'Séance du jour'}</p>
        <h2>${plural(planCards.length, 'carte', 'cartes')} · ${minutes} min</h2>
        <p class="today-detail">${nRev ? `${plural(nRev, 'révision', 'révisions')}` : ''}${nRev && nNew ? ' et ' : ''}${nNew ? `${plural(nNew, 'nouvelle notion', 'nouvelles notions')}` : ''}${books.length ? ` — vous découvrirez <em>${books.map((b) => esc(shortTitle(C.byId.get(b)))).join('</em> et <em>')}</em>` : ''}.</p>
        <a class="btn big" href="#/seance">${first ? 'Commencer' : 'C\'est parti'}</a>
      </div>
    </div>`;
  } else {
    todayCard = `<div class="today-card done">
      <div class="stamp" aria-hidden="true">✓</div>
      <div class="today-body">
        <p class="kicker">Séance du jour</p>
        <h2>C'est fait pour aujourd'hui.</h2>
        <p class="today-detail">Vos cartes reviendront ${nextDueLabel(now)}. En attendant : un défi éclair ou une question de réflexion ?</p>
        <div class="actions"><a class="btn" href="#/defi">Défi éclair</a><a class="btn ghost" href="#/reflexion">Réfléchir</a></div>
      </div>
    </div>`;
  }

  const q = C.liens.questionsOuvertes[hash(dayKey()) % C.liens.questionsOuvertes.length];
  render(`
    ${!p.settings.onboarded ? onboarding() : ''}
    <section class="home-head">
      <p class="hello">${greeting()}.</p>
      <h1>Trente classiques pour <em>penser le monde</em>, quelques minutes par jour.</h1>
    </section>
    <div class="home-grid">
    <div class="home-main">
    ${todayCard}
    ${installCard()}
    </div>
    <section class="home-row">
      <div class="mini">
        <p class="label">Régularité</p>
        ${weekStrip(now)}
        <p class="mini-text">${s ? `<strong>${plural(s, 'jour', 'jours')}</strong> d'affilée` : 'Une séance par jour suffit.'}</p>
      </div>
      <a class="mini link" href="#/progression">
        <p class="label">Ce que vous retenez</p>
        <p class="big-num">${st.acquired}<small> / ${st.total}</small></p>
        <p class="mini-text">notions acquises${st.seen ? ` · ${st.seen} découvertes` : ''}</p>
      </a>
      <a class="mini link" href="#/defi">
        <p class="label">Défi éclair</p>
        <p class="big-num">${p.defi?.best ?? '–'}<small> / 8</small></p>
        <p class="mini-text">Reconnaître le livre derrière l'idée. Votre record.</p>
      </a>
    </section>
    </div>
    <section class="shelf-block">
      <div class="block-head"><h2>Votre étagère</h2><a href="#/bibliotheque" class="linkbtn">Tout voir</a></div>
      <div class="shelf">${C.oeuvres.map((o) => {
        const bp = bookProgress(o.id);
        return `<a class="spine lvl${bp.level}" href="#/oeuvre/${o.id}" title="${esc(o.titre)} — ${LEVEL_LABEL[bp.level]}">${coverOf(o.id, 'shelf-cover')}${notches(bp.level)}</a>`;
      }).join('')}</div>
    </section>
    <a class="question-day" href="#/reflexion">
      <span class="label">Question du jour</span>
      <span class="qd-text">${esc(q.question)}</span>
      <span class="qd-go">Réfléchir →</span>
    </a>`);
}

function onboarding() {
  return `<section class="onboarding" aria-label="Comment ça marche">
    <h2>Comment ça marche</h2>
    <ol>
      <li><b>Pas besoin d'avoir lu les livres.</b> Chaque livre vous est d'abord raconté simplement, puis on avance pas à pas : découvrir, comprendre, approfondir.</li>
      <li><b>Une courte séance par jour.</b> Une dizaine de cartes : des notions à revoir, quelques nouvelles. Un mot souligné en pointillé ? Touchez-le pour son explication.</li>
      <li><b>Répondez de mémoire</b>, puis dites honnêtement si vous saviez. Personne ne vous juge.</li>
      <li><b>Chaque notion revient au bon moment</b> : bientôt si vous hésitez, de plus en plus tard si vous la maîtrisez.</li>
    </ol>
    <button class="btn small" data-action="onboarded">Compris</button>
  </section>`;
}

function nextDueLabel(now) {
  const p = P();
  const dues = C.cards.map((c) => p.cards[c.id]?.due).filter((d) => d && d > now).sort((a, b) => a - b);
  return dues.length ? intervalLabel({ due: dues[0] }, now) : 'plus tard';
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
    const own = (C.cardsByOeuvre.get(scope.oeuvre) || []);
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
  session = { key: sessionKey(scope), scope, items, index: 0, startedAt: now, lastAt: now, results: [], seed: String(now), acquired: [] };
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
  if (!session || session.key !== sessionKey(scope) || session.done) newSession(scope);
  if (!session.items.length) return renderNothingDue(scope);
  renderItem();
}

function renderNothingDue(scope) {
  const st = computeStats();
  render(`<div class="session-end">
    <div class="stamp" aria-hidden="true">✓</div>
    <h1>${scope.oeuvre ? 'Rien à revoir pour ce livre aujourd\'hui.' : 'Tout est à jour.'}</h1>
    <p class="lede">${scope.oeuvre ? 'Ses cartes reviendront d\'elles-mêmes au bon moment.' : `Prochaines révisions ${nextDueLabel(Date.now())}.`}</p>
    <div class="actions">
      <a class="btn" href="#/defi">Défi éclair</a>
      ${st.seen ? '<a class="btn ghost" href="#/seance/libre">Revoir mes points faibles</a>' : ''}
      <a class="btn ghost" href="#/">Accueil</a>
    </div>
  </div>`, { foot: false });
}

const currentItem = () => session.items[session.index];

function progressDots() {
  return `<div class="dots-track" aria-hidden="true">${session.items.map((it, i) => {
    let cls = '';
    if (i < session.index) {
      const r = session.results.find((x) => x.idx === i);
      cls = it.type === 'intro' ? 'done intro' : r ? (r.g >= 3 ? 'ok' : r.g === 2 ? 'mid' : 'ko') : 'done';
    } else if (i === session.index) cls = 'now';
    return `<i class="${cls}"></i>`;
  }).join('')}</div>`;
}

function renderItem() {
  const item = currentItem();
  if (!item) return renderSessionEnd();
  const head = `<div class="session-head">
    <button class="close" data-action="quit" aria-label="Interrompre la séance" title="Interrompre (votre progression est gardée)">✕</button>
    ${progressDots()}
    <span class="session-count">${session.index + 1}/${session.items.length}</span>
  </div>`;
  if (item.type === 'intro') return render(head + renderIntro(item.oeuvre), { foot: false });
  const card = C.cardById.get(item.id);
  if (!card) { session.index++; return renderItem(); }
  render(head + renderCard(card, item) + `<p class="kbd-hint">Raccourcis : <kbd>Espace</kbd> retourner / continuer · <kbd>A</kbd>–<kbd>D</kbd> choisir · <kbd>1</kbd>–<kbd>4</kbd> noter · <kbd>Échap</kbd> quitter</p>`, { foot: false });
  const ta = main.querySelector('textarea.free');
  if (ta) { ta.value = ui.text || ''; if (!ui.revealed) ta.focus({ preventScroll: true }); }
}

const LEVEL_CHIP = { 1: 'Découvrir', 2: 'Comprendre', 3: 'Approfondir' };
const levelLabel = (card) => (card.competence === 4 ? 'Relier' : LEVEL_CHIP[levelOf(card)]);
const FORMAT_HINT = { flashcard: 'Carte mémoire', qcm: 'Choix', actualite: 'Actualité', relier: 'Associer', libre: 'Avec vos mots' };

function cardTop(card, item) {
  const works = card.oeuvres.filter((o) => !isIntro(o));
  return `<header class="card-top">
    <div class="mini-covers">${works.length ? works.slice(0, 3).map((o) => coverOf(o, 'mini-cover', false)).join('') : '<span class="mini-cover cover-blank">§</span>'}</div>
    <div class="card-top-text">
      <span class="card-work">${esc(card.oeuvres.map(oeuvreTitle).join(' · '))}</span>
      <span class="chips-inline"><span class="chip-c c${card.competence === 4 ? 4 : levelOf(card)}">${levelLabel(card)}</span><span class="chip-f">${FORMAT_HINT[card.format]}</span>${item?.isNew ? '<span class="chip-new">Nouveau</span>' : ''}${item?.relearn ? '<span class="chip-new">2ᵉ essai</span>' : ''}</span>
    </div>
  </header>`;
}

function more(card) {
  const parts = [];
  if (card.limites) parts.push(`<p><b>Limites du rapprochement.</b> ${esc(card.limites)}</p>`);
  parts.push(`<p class="source-line">${natureTag(card.source.nature)} ${pageLink(card.source.pages)} <button class="linkbtn" data-action="report" data-target="Carte ${esc(card.id)} — ${esc(card.question.slice(0, 80))}">Signaler une erreur</button></p>`);
  return `<details class="more"><summary>${card.limites ? 'Limites et source' : 'Source'}</summary>${parts.join('')}</details>`;
}

function renderIntro(oeuvreId) {
  if (isIntro(oeuvreId)) {
    const I = C.introduction;
    return `<article class="card intro-card">
      <p class="kicker">Avant de commencer</p>
      <h1 class="question">Qu'est-ce qu'un classique ?</h1>
      <p class="intro-big">« Un livre étudié dans les classes », plaisantait Michel Tournier. Le dossier propose mieux : <strong>un livre qui persiste</strong>. On peut le brûler, l'interdire, l'expurger — on ne le fait pas taire.</p>
      <p>Et à chaque époque, il se charge d'« une couche de sens nouveau ». C'est ce que vous allez chercher ici : ce que ces livres disent de <em>notre</em> monde.</p>
      <p class="hint">${esc(I.idees[2])}</p>
      <div class="actions"><button class="btn big" data-action="intro-done" autofocus>Allons-y</button></div>
    </article>`;
  }
  const o = C.byId.get(oeuvreId);
  const a = C.articles.get(o.article);
  const step = ui.step || 0;
  const dots = `<div class="steps" aria-hidden="true">${[0, 1, 2].map((i) => `<i class="${i === step ? 'on' : i < step ? 'done' : ''}"></i>`).join('')}</div>`;
  const pages = [
    `<p class="kicker">Nouveau livre · 1/3 · Le livre en bref</p>
     <h1 class="question"><em>${esc(o.titre)}</em></h1>
     <p class="by">${gl(o.auteurBref)}</p>
     <p class="intro-big">${gl(o.enBref)}</p>
     <p class="hint">${natureTag('repere')} Ce résumé sert de repère : il ne vient pas du magazine.</p>`,
    `<p class="kicker">2/3 · Ce qu'en retient le dossier</p>
     <p class="intro-q">${gl(o.question)}</p>
     <p class="intro-big"><strong>En clair :</strong> ${gl(o.enClair)}</p>
     <p class="hint">D'après l'article « ${esc(a.titre)} » de ${esc(a.auteurs)}, <em>Le Magazine littéraire</em> (2017).</p>`,
    `<p class="kicker">3/3 · Pour s'en souvenir</p>
     <div class="example-box"><span class="label">Un exemple</span><p>${gl(o.exemple)}</p></div>
     <div class="notion"><span class="label">Le mot à retenir</span><p><strong>${esc(o.notion.terme)}</strong> — ${gl(o.notion.definition)}</p></div>`,
  ];
  return `<article class="card intro-card book-intro">
    <div class="book-intro-cover">${coverOf(o.id, 'cover')}</div>
    <div>
      ${dots}
      ${pages[step]}
      <div class="actions">
        ${step > 0 ? '<button class="btn ghost" data-action="intro-prev">Retour</button>' : ''}
        ${step < 2 ? '<button class="btn big" data-action="intro-next" autofocus>Suivant</button>' : '<button class="btn big" data-action="intro-done" autofocus>Aux questions</button>'}
      </div>
    </div>
  </article>`;
}

function renderCard(card, item) {
  const body = { flashcard: renderFlashcard, qcm: renderChoice, actualite: renderChoice, relier: renderMatch, libre: renderFree }[card.format](card);
  return `<article class="card" data-card="${esc(card.id)}">${cardTop(card, item)}${body}</article>`;
}

function gradeButtons(card, suggested = 0) {
  const s = P().cards[card.id];
  const now = Date.now();
  const icons = { 1: '↺', 2: '~', 3: '✓', 4: '★' };
  return `<p class="grade-q">Vous saviez ?</p>
    <div class="grades" role="group" aria-label="Votre niveau de maîtrise">${[1, 2, 3, 4].map((g) =>
    `<button class="grade g${g}${g === suggested ? ' suggested' : ''}" data-action="grade" data-g="${g}"><span class="gi" aria-hidden="true">${icons[g]}</span><span>${GRADE_LABELS[g]}</span><small>${esc(intervalLabel(review(s, g, now), now))}</small></button>`).join('')}</div>`;
}

function hintBlock(card) {
  const works = card.oeuvres.filter((o) => C.byId.has(o));
  // Pas d'indice sur les cartes de découverte : il donnerait la réponse.
  if (!works.length || card.id.startsWith('dec-')) return '';
  if (!ui.hint) return `<button class="hint-btn" data-action="hint">Un coup de pouce ?</button>`;
  return `<div class="hint-box">${works.map((id) => { const o = C.byId.get(id); return `<p><b><em>${esc(shortTitle(o))}</em></b> — ${gl(o.sujet)}. ${gl(o.enClair)}</p>`; }).join('')}</div>`;
}

function renderFlashcard(card) {
  return `<h1 class="question">${gl(card.question)}</h1>
    ${!ui.revealed ? `<p class="prompt">Prenez quelques secondes pour formuler la réponse dans votre tête.</p>
      ${hintBlock(card)}
      <div class="actions"><button class="btn big" data-action="reveal" autofocus>Retourner la carte</button></div>` : `
    <div class="reveal flip">
      <div class="answer">${gl(card.reponse)}</div>
      ${card.exemple ? `<p class="example"><b>Exemple —</b> ${gl(card.exemple)}</p>` : ''}
      ${card.explication ? `<p class="why">${gl(card.explication)}</p>` : ''}
      ${more(card)}
      ${gradeButtons(card)}
    </div>`}`;
}

function splitSituation(card) {
  if (card.format !== 'actualite') return ['', card.question];
  const cut = card.question.search(/\s(Quel|Quelle|Quels|Quelles)\b[^.?]*\?$/);
  return cut > 0 ? [card.question.slice(0, cut), card.question.slice(cut + 1)] : ['', card.question];
}

function renderChoice(card) {
  const order = shuffled(card.choix.map((t, i) => ({ t, i })), card.id + session.seed);
  const answered = ui.choice != null;
  const [situation, q] = splitSituation(card);
  const ok = ui.choice === card.correct;
  const list = order.map((o, k) => {
    let cls = '';
    if (answered) cls = o.i === card.correct ? 'correct' : o.i === ui.choice ? 'wrong' : 'muted';
    return `<li><button class="choice ${cls}" data-action="choose" data-i="${o.i}" ${answered ? 'disabled' : ''}><span class="key">${answered && o.i === card.correct ? '✓' : answered && o.i === ui.choice ? '✕' : 'ABCD'[k]}</span><span>${esc(o.t)}</span></button></li>`;
  }).join('');
  return `${situation ? `<div class="situation"><span class="label">La situation</span>${gl(situation)}</div>` : ''}
    <h1 class="question">${gl(q)}</h1>
    ${!answered ? hintBlock(card) : ''}
    <ol class="choices">${list}</ol>
    ${answered ? `<div class="reveal">
      <p class="verdict ${ok ? 'ok' : 'ko'}">${ok ? pick(['Bien vu !', 'Exactement.', 'Juste !', 'Bonne réponse.'], card.id) : 'Pas tout à fait.'}</p>
      <p class="why">${gl(card.explication)}</p>
      ${more(card)}
      <div class="after">
        <button class="btn big" data-action="grade" data-g="${ok ? (ui.hint ? 2 : 3) : 1}" autofocus>Continuer</button>
        ${ok && ui.hint ? '<span class="after-alt">Trouvé avec un coup de pouce : la carte reviendra un peu plus tôt.</span>' : ok ? `<span class="after-alt"><button class="linkbtn" data-action="grade" data-g="2">J'ai hésité</button> · <button class="linkbtn" data-action="grade" data-g="4">Trop facile</button></span>` : '<span class="after-alt">Cette carte reviendra un peu plus loin.</span>'}
      </div></div>` : ''}`;
}

function pick(list, seed) { return list[hash(seed + session.seed) % list.length]; }

function renderMatch(card) {
  const lefts = card.paires.map((p, i) => ({ t: p.gauche, i }));
  const rights = shuffled(card.paires.map((p, i) => ({ t: p.droite, i })), card.id + session.seed);
  ui.pairs ||= {};
  const pairs = ui.pairs;
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
  return `<h1 class="question">${gl(card.question)}</h1>
    ${!checked ? `<p class="prompt">${ui.sel != null ? 'Maintenant, touchez l\'idée qui lui correspond.' : 'Touchez un livre, puis l\'idée qui lui correspond.'}</p>` : ''}
    <div class="match">
      <div class="match-col">${lefts.map((l) => { const n = pairNumber('l', l.i); return `<button class="match-item left ${cls('l', l.i)}" data-action="match-l" data-i="${l.i}" ${n ? `data-pair="${n}"` : ''} ${checked ? 'disabled' : ''}>${esc(l.t)}</button>`; }).join('')}</div>
      <div class="match-col">${rights.map((r) => { const n = pairNumber('r', r.i); return `<button class="match-item ${cls('r', r.i)}" data-action="match-r" data-i="${r.i}" ${n ? `data-pair="${n}"` : ''} ${checked ? 'disabled' : ''}>${esc(r.t)}</button>`; }).join('')}</div>
    </div>
    ${!checked ? `<div class="actions"><button class="btn big" data-action="match-check" ${all ? '' : 'disabled'}>Vérifier</button>${Object.keys(pairs).length ? '<button class="linkbtn" data-action="match-reset">Recommencer</button>' : ''}</div>` : `
    <div class="reveal">
      <p class="verdict ${okCount === card.paires.length ? 'ok' : 'ko'}">${okCount === card.paires.length ? 'Tout juste !' : `${okCount} sur ${card.paires.length}`}</p>
      ${okCount < card.paires.length ? `<ul class="pairs-solution">${card.paires.map((p) => `<li><em>${esc(p.gauche)}</em><span>${esc(p.droite)}</span></li>`).join('')}</ul>` : ''}
      <p class="why">${gl(card.explication)}</p>
      ${more(card)}
      <div class="after"><button class="btn big" data-action="grade" data-g="${okCount === card.paires.length ? 3 : okCount ? 2 : 1}" autofocus>Continuer</button></div>
    </div>`}`;
}

function renderFree(card) {
  if (!ui.revealed) {
    const last = P().cards[card.id]?.lastAnswer;
    return `<h1 class="question">${gl(card.question)}</h1>
      ${hintBlock(card)}
      <label class="sr-only" for="free-${esc(card.id)}">Votre réponse</label>
      <textarea id="free-${esc(card.id)}" class="free" data-action="free-input" placeholder="Deux ou trois phrases, avec vos mots. Vous comparerez vous-même ensuite."></textarea>
      ${last ? `<details class="more"><summary>Votre réponse la dernière fois</summary><p class="your-answer">${esc(last)}</p></details>` : ''}
      <div class="actions"><button class="btn big" data-action="reveal">Voir la correction</button><button class="linkbtn" data-action="reveal-blank">Je ne sais pas</button></div>`;
  }
  ui.ticks ||= [];
  const ratio = card.points.length ? ui.ticks.filter(Boolean).length / card.points.length : 0;
  const suggested = ui.blank ? 1 : ratio >= 0.75 ? 3 : ratio >= 0.4 ? 2 : 1;
  return `<h1 class="question">${gl(card.question)}</h1>
    <div class="reveal">
      ${ui.text ? `<p class="your-answer">${esc(ui.text)}</p>` : ''}
      <p class="label">La correction</p>
      <div class="answer">${gl(card.reponse)}</div>
      <p class="label">Cochez les idées que vous aviez, même dites autrement</p>
      <ul class="checklist">${card.points.map((pt, k) => `<li><label><input type="checkbox" data-action="tick" data-k="${k}" ${ui.ticks[k] ? 'checked' : ''}><span>${esc(pt)}</span></label></li>`).join('')}</ul>
      ${more(card)}
      ${gradeButtons(card, suggested)}
    </div>`;
}

function renderSessionEnd() {
  session.done = true;
  persistSession();
  const r = session.results;
  const ok = r.filter((x) => x.g >= 3).length;
  const minutes = Math.max(1, Math.round((Date.now() - session.startedAt) / MINUTE));
  const works = [...new Set(r.map((x) => C.cardById.get(x.id)?.oeuvres[0]).filter((o) => C.byId.has(o)))];
  const s = streak();
  const ratio = r.length ? ok / r.length : 0;
  const title = ratio >= 0.85 ? 'Superbe séance.' : ratio >= 0.6 ? 'Belle séance.' : 'Séance utile.';
  const sub = ratio >= 0.6 ? 'Ce que vous avez su reviendra plus tard, pour bien s\'ancrer.' : 'Ce qui a résisté reviendra bientôt : c\'est comme ça qu\'on retient.';
  render(`<div class="session-end">
    <div class="end-covers" aria-hidden="true">${works.slice(0, 5).map((o) => coverOf(o, 'end-cover', false)).join('')}</div>
    <h1>${title}</h1>
    <p class="lede">${sub}</p>
    <div class="end-dots">${r.map((x) => `<i class="${x.g >= 3 ? 'ok' : x.g === 2 ? 'mid' : 'ko'}"></i>`).join('')}</div>
    <div class="stats-line">
      <div class="stat"><strong>${ok}/${r.length}</strong><span>réussies</span></div>
      <div class="stat"><strong>${minutes}</strong><span>minute${minutes > 1 ? 's' : ''}</span></div>
      <div class="stat"><strong>${s}</strong><span>jour${s > 1 ? 's' : ''} d'affilée</span></div>
      ${session.acquired.length ? `<div class="stat"><strong>${session.acquired.length}</strong><span>notion${session.acquired.length > 1 ? 's' : ''} acquise${session.acquired.length > 1 ? 's' : ''}</span></div>` : ''}
    </div>
    ${works.length ? `<p>Vous avez travaillé : ${works.map((o) => `<a href="#/oeuvre/${o}"><em>${esc(shortTitle(C.byId.get(o)))}</em></a>`).join(', ')}.</p>` : ''}
    <div class="actions"><a class="btn big" href="#/">Terminer</a><a class="btn ghost" href="#/defi">Un défi éclair ?</a></div>
  </div>`, { foot: false });
}

function recordGrade(g) {
  const item = currentItem();
  const card = C.cardById.get(item.id);
  const p = P();
  const now = Date.now();
  const before = p.cards[card.id];
  const next = review(before, g, now);
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
  if (!isAcquired(before) && isAcquired(next)) { session.acquired.push(card.id); toast('Notion acquise ✓', 'gold'); }
  session.results.push({ id: card.id, g, isNew: !!item.isNew, idx: session.index });
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

/* ————————————————— étagère (bibliothèque) ————————————————— */

function viewLibrary() {
  render(`
    <header class="page-head">
      <h1>L'étagère</h1>
      <p>${C.oeuvres.length} livres, rangés du plus accessible au plus exigeant. Touchez une couverture pour découvrir le livre.</p>
    </header>
    <div class="searchbar" role="search">
      <label class="sr-only" for="lib-q">Rechercher</label>
      <input id="lib-q" type="search" placeholder="Un auteur, un titre, une idée…" value="${esc(libState.q)}" data-action="lib-search" autocomplete="off">
      <label class="sr-only" for="lib-theme">Thème</label>
      <select id="lib-theme" data-action="lib-theme">
        <option value="">Tous les thèmes</option>
        ${[...C.themes.values()].map((t) => `<option value="${t.id}" ${libState.theme === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
      </select>
    </div>
    <div id="lib-results">${libraryResults()}</div>
    <details class="more announced">
      <summary>Et les autres classiques du dossier ?</summary>
      <p>Le PDF s'arrête à la page 124. L'introduction annonce aussi :</p>
      <ul>${C.annoncees.map((a) => `<li><em>${esc(a.titre)}</em> — ${esc(a.mention)}</li>`).join('')}</ul>
      <p class="hint">Faute d'article, ces livres n'ont pas encore de fiche. <a href="#/sources">En savoir plus</a>.</p>
    </details>`);
}

function libraryResults() {
  const list = search(C, libState.q, libState.theme);
  if (!list.length) return `<p class="empty">Aucun livre ne correspond. Essayez « argent », « fake news », « Proust »…</p>`;
  return `<div class="grid-books">${list.map((o) => {
    const bp = bookProgress(o.id);
    return `<a class="book lvl${bp.level}" href="#/oeuvre/${o.id}">
      <span class="book-cover">${coverOf(o.id, 'cover')}</span>
      <span class="book-title">${esc(shortTitle(o))}</span>
      <span class="book-author">${esc(shortAuthor(o.auteur))}</span>
      <span class="book-sujet">${esc(o.sujet)}</span>
      <span class="book-state">${notches(bp.level)} ${LEVEL_LABEL[bp.level]}</span>
    </a>`;
  }).join('')}</div>`;
}

/* ————————————————— fiche d'un livre ————————————————— */

function viewOeuvre(id) {
  const o = C.byId.get(id);
  if (!o) return render(`<p class="empty">Livre introuvable. <a href="#/bibliotheque">L'étagère</a></p>`);
  const a = C.articles.get(o.article);
  const bp = bookProgress(id);
  const links = C.liens.rapprochements.filter((r) => r.oeuvres.includes(id));
  const p = P();
  const nDue = (C.cardsByOeuvre.get(id) || []).filter((c) => isDue(p.cards[c.id])).length;
  render(`
  <article class="fiche">
    <header class="fiche-hero"><div class="fiche-hero-inner">
      <div class="covers">${o.couvertures.map((c) => `<figure>${coverImg(c)}${o.couvertures.length > 1 ? `<figcaption>${esc(c.legende)}</figcaption>` : ''}</figure>`).join('')}</div>
      <div class="fiche-id">
        <p class="kicker">${esc(a.rubrique)}</p>
        <h1>${esc(o.titre)}</h1>
        <p class="by">${esc(o.auteur)} · ${esc(o.date)}</p>
        <p class="fiche-state">${notches(bp.level)} ${LEVEL_LABEL[bp.level]}${bp.seen ? ` · ${bp.acq}/${bp.total} notions acquises` : ''}</p>
        <a class="btn" href="#/seance/oeuvre/${o.id}">${bp.seen ? (nDue ? `Réviser ce livre (${nDue})` : 'S\'entraîner sur ce livre') : 'Découvrir en 5 minutes'}</a>
      </div>
    </div></header>
    <div class="fiche-body">

    <section class="block first">
      <h2>Le livre en bref</h2>
      <p>${gl(o.enBref)}</p>
      <p class="hint">${gl(o.auteurBref)} ${natureTag('repere')}</p>
    </section>

    <section class="essential">
      <span class="label">En clair</span>
      <p class="central">${gl(o.enClair)}</p>
      <p class="big-question">${gl(o.question)}</p>
      <details class="more"><summary>L'analyse du dossier en une phrase</summary><p>${gl(o.ideeCentrale)}</p></details>
    </section>

    <section class="block">
      <h2>À retenir</h2>
      <ol class="ideas">${o.idees.map((t) => `<li>${gl(t)}</li>`).join('')}</ol>
      <div class="example-box"><span class="label">L'exemple qui aide à se souvenir</span><p>${gl(o.exemple)}</p></div>
      <div class="notion"><span class="label">Le mot à retenir</span><p><strong>${esc(o.notion.terme)}</strong> — ${gl(o.notion.definition)}</p></div>
    </section>

    <section class="block">
      <h2>Et aujourd'hui ?</h2>
      <p>${gl(o.aujourdhui.magazine)} ${natureTag('magazine')}</p>
      <p class="app-voice">${gl(o.aujourdhui.piste)} ${natureTag('prolongement')}</p>
      <p class="ponder">${esc(o.questionReflexion)}</p>
    </section>

    ${o.citations.length ? `<section class="block"><h2>Citations</h2>${o.citations.map((c) => `<blockquote class="quote">« ${esc(c.texte)} »<cite>${esc(c.attribution)} · p. ${c.page}</cite></blockquote>`).join('')}</section>` : ''}

    ${links.length ? `<section class="block"><h2>À rapprocher de</h2><div class="link-list">${links.map((r) => `<a href="#/reflexion" data-action="goto-link" data-id="${r.id}" class="link-pill">${r.oeuvres.filter((x) => x !== id).map((x) => coverOf(x, 'pill-cover', false)).join('')}<span><b>${esc(r.titre)}</b><small>avec ${r.oeuvres.filter((x) => x !== id).map((x) => esc(shortTitle(C.byId.get(x)))).join(', ')}</small></span></a>`).join('')}</div></section>` : ''}

    <section class="block">
      <details class="more">
        <summary>Pour aller plus loin</summary>
        <p><b>Contexte.</b> ${esc(o.contexte)}</p>
        <p><b>Limites de l'interprétation.</b> ${esc(o.limites)}</p>
        ${o.approfondir.length ? `<ul>${o.approfondir.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      </details>
      <details class="more">
        <summary>Source</summary>
        <p>${esc(a.auteurs)}, « ${esc(a.titre)} », <em>Le Magazine littéraire</em>, n° 581-582, juillet-août 2017, ${pageLink(a.pagesMagazine)}.</p>
        ${a.presentation ? `<p class="hint">${esc(a.presentation)}</p>` : ''}
        <p class="hint">${o.verification.statut === 'verifie' ? '✓ Vérifié sur les pages originales.' : 'Partiellement vérifié.'} ${esc(o.verification.notes)}</p>
        ${o.dateNature === 'repere' ? `<p class="hint">${natureTag('repere')} La date est un repère général : l'article ne la donne pas.</p>` : ''}
        ${hasPdf() ? '' : '<p class="hint">Astuce : associez votre PDF dans les <a href="#/reglages">réglages</a> pour ouvrir directement la page.</p>'}
        <button class="linkbtn" data-action="report" data-target="Fiche « ${esc(o.titre)} »">Signaler une erreur sur cette fiche</button>
      </details>
    </section>
    </div>
  </article>`);
}

/* ————————————————— défi éclair ————————————————— */

const DEFI_ROUNDS = 8;

function defiPrompts() {
  const out = [];
  for (const o of C.oeuvres) {
    out.push({ o: o.id, kind: 'Quel livre pose cette question ?', text: o.question });
    out.push({ o: o.id, kind: 'Quel livre défend cette idée ?', text: o.idees[0] });
    out.push({ o: o.id, kind: 'De quel livre est-ce le mot-clé ?', text: `${o.notion.terme} — ${o.notion.definition}` });
    for (const c of o.citations) if (!c.texte.includes(shortTitle(o))) out.push({ o: o.id, kind: 'D\'où vient cette citation ?', text: `« ${c.texte} »` });
  }
  return out;
}

function newDefi() {
  const seed = Date.now();
  const prompts = shuffled(defiPrompts(), seed);
  const rounds = [];
  const used = new Set();
  for (const pr of prompts) {
    if (rounds.length >= DEFI_ROUNDS) break;
    if (used.has(pr.o)) continue;
    used.add(pr.o);
    const others = shuffled(C.oeuvres.filter((x) => x.id !== pr.o), `${seed}${pr.o}`).slice(0, 3).map((x) => x.id);
    rounds.push({ ...pr, options: shuffled([pr.o, ...others], `${seed}o${pr.o}`) });
  }
  defi = { rounds, i: 0, score: 0, answer: null, combo: 0, bestCombo: 0 };
}

function viewDefi() {
  if (!defi) {
    const best = P().defi?.best;
    return render(`<section class="defi-start">
      <p class="kicker">Défi éclair</p>
      <h1>Retrouvez le livre.</h1>
      <p class="lede">${DEFI_ROUNDS} idées, citations ou questions. À chaque fois, quatre couvertures : laquelle est la bonne ? Pas de chrono, pas d'enjeu — juste le plaisir de reconnaître.</p>
      <div class="defi-fan" aria-hidden="true">${shuffled(C.oeuvres, dayKey()).slice(0, 5).map((o) => coverOf(o.id, 'fan-cover', false)).join('')}</div>
      <div class="actions"><button class="btn big" data-action="defi-start">Jouer</button>${best != null ? `<span class="hint">Record : ${best}/${DEFI_ROUNDS}</span>` : ''}</div>
      <p class="hint">Le défi ne modifie pas vos révisions.</p>
    </section>`);
  }
  if (defi.i >= defi.rounds.length) return renderDefiEnd();
  const r = defi.rounds[defi.i];
  const answered = defi.answer != null;
  render(`<section class="defi">
    <div class="defi-head"><button class="close" data-action="defi-quit" aria-label="Quitter le défi">✕</button><span>${defi.i + 1}/${defi.rounds.length}</span><span class="defi-score">${defi.score} point${defi.score > 1 ? 's' : ''}${defi.combo >= 2 ? ` · série de ${defi.combo}` : ''}</span></div>
    <p class="kicker">${esc(r.kind)}</p>
    <p class="defi-text">${esc(r.text)}</p>
    <div class="defi-options">${r.options.map((id) => {
      const cls = !answered ? '' : id === r.o ? 'correct' : id === defi.answer ? 'wrong' : 'muted';
      return `<button class="defi-option ${cls}" data-action="defi-pick" data-id="${id}" ${answered ? 'disabled' : ''}>${coverOf(id, 'cover')}<span>${esc(shortTitle(C.byId.get(id)))}</span></button>`;
    }).join('')}</div>
    ${answered ? `<div class="reveal defi-after">
      <p class="verdict ${defi.answer === r.o ? 'ok' : 'ko'}">${defi.answer === r.o ? (defi.combo >= 3 ? `Série de ${defi.combo} !` : 'Bien vu !') : `C'était ${esc(C.byId.get(r.o).titre)}.`}</p>
      <div class="actions"><button class="btn big" data-action="defi-next" autofocus>${defi.i + 1 < defi.rounds.length ? 'Suivant' : 'Voir le score'}</button><a class="linkbtn" href="#/oeuvre/${r.o}">Revoir la fiche</a></div>
    </div>` : ''}
  </section>`, { foot: false });
}

function renderDefiEnd() {
  const p = P();
  const prev = p.defi?.best ?? -1;
  const record = defi.score > prev;
  p.defi = { best: Math.max(prev, defi.score), played: (p.defi?.played || 0) + 1 };
  store.save();
  const msg = defi.score === DEFI_ROUNDS ? 'Sans faute !' : defi.score >= 6 ? 'Très bien !' : defi.score >= 4 ? 'Pas mal du tout.' : 'Les séances vont vous aider.';
  document.body.classList.remove('focus-mode');
  render(`<section class="defi-start">
    <p class="kicker">Défi éclair</p>
    <h1>${defi.score}/${DEFI_ROUNDS}. ${msg}</h1>
    <p class="lede">${record ? 'Nouveau record personnel.' : `Votre record : ${p.defi.best}/${DEFI_ROUNDS}.`}${defi.bestCombo >= 3 ? ` Meilleure série : ${defi.bestCombo}.` : ''}</p>
    <div class="actions"><button class="btn big" data-action="defi-start">Rejouer</button><a class="btn ghost" href="#/">Accueil</a></div>
  </section>`);
  defi = null;
}

/* ————————————————— réflexion ————————————————— */

function viewReflexion() {
  const R = C.liens.rapprochements.filter((r) => !refState.theme || r.theme === refState.theme);
  const notes = P().notes || {};
  const themesUsed = [...new Set(C.liens.rapprochements.map((r) => r.theme))];
  const q = C.liens.questionsOuvertes[hash(dayKey()) % C.liens.questionsOuvertes.length];
  render(`
    <header class="page-head">
      <h1>Réfléchir</h1>
      <p>Mettre deux livres face à face pour mieux voir le présent. Ouvrez un rapprochement, puis notez votre idée dans votre carnet.</p>
    </header>
    <a class="question-day" href="#/oeuvre/${q.oeuvres[0]}">
      <span class="label">Question du jour</span><span class="qd-text">${esc(q.question)}</span>
    </a>
    <div class="chips" role="group" aria-label="Thèmes">
      <button class="chip" data-action="ref-theme" data-v="" aria-pressed="${!refState.theme}">Tous</button>
      ${themesUsed.map((t) => `<button class="chip" data-action="ref-theme" data-v="${t}" aria-pressed="${refState.theme === t}">${esc(C.themes.get(t)?.label || t)}</button>`).join('')}
    </div>
    <div class="links">
      ${R.map((r) => `<details class="link-card" id="lien-${r.id}" ${refState.open === r.id ? 'open' : ''}>
        <summary>
          <span class="duo">${r.oeuvres.map((o) => coverOf(o, 'duo-cover', false)).join('')}</span>
          <span class="link-sum">
            <span class="badge ${r.fondement}">${r.fondement === 'explicite' ? 'Lien fait par le dossier' : 'Rapprochement proposé'}</span>
            <b>${esc(r.titre)}</b>
            <small>${r.oeuvres.map((o) => esc(shortTitle(C.byId.get(o)))).join(' · ')}</small>
            <span class="link-question">${esc(r.question)}</span>
          </span>
          ${notes[r.id] ? '<span class="has-note" title="Vous avez écrit une note">✎</span>' : ''}
        </summary>
        <div class="link-body">
          <div class="cols">
            <div><p class="label">Ce qui les rapproche</p><ul>${r.convergences.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
            <div><p class="label">Ce qui les oppose</p><ul>${r.oppositions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
          </div>
          <p class="hint"><b>Attention :</b> ${esc(r.nuances)}</p>
          <label class="label" for="note-${r.id}">Mon carnet</label>
          <textarea class="notebook" id="note-${r.id}" data-action="note" data-id="${r.id}" placeholder="Votre réponse, en quelques lignes…">${esc(notes[r.id] || '')}</textarea>
        </div>
      </details>`).join('') || '<p class="empty">Aucun rapprochement pour ce thème.</p>'}
    </div>`);
  if (refState.open) {
    document.getElementById(`lien-${refState.open}`)?.scrollIntoView({ block: 'start' });
    refState.open = null;
  }
}

/* ————————————————— progression ————————————————— */

function viewProgress() {
  const now = Date.now();
  const st = computeStats(now);
  const p = P();
  const m = compMastery(C.cards);
  const s = streak(now);
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
  const series = Object.entries(p.days).filter(([, d]) => d.acquired != null).sort(([a], [b]) => a.localeCompare(b));
  const forecast = [];
  for (let i = 0; i < 7; i++) {
    const from = i === 0 ? -Infinity : today + i * DAY;
    const to = today + (i + 1) * DAY;
    forecast.push(C.cards.filter((c) => { const x = p.cards[c.id]; return x?.due != null && x.due >= from && x.due < to; }).length);
  }
  const fmax = Math.max(1, ...forecast);
  const levels = [0, 1, 2, 3].map((l) => C.oeuvres.filter((o) => bookProgress(o.id).level === l).length);
  const compNames = { 1: 'Connaître le livre', 2: 'Comprendre ses idées', 3: 'Penser le présent', 4: 'Relier les livres' };

  render(`
    <header class="page-head">
      <h1>Vos progrès</h1>
      <p>Une notion est <b>acquise</b> après trois bonnes réponses espacées sur plusieurs semaines. Elle revient quand même de temps en temps, pour ne pas s'effacer.</p>
    </header>
    <div class="kpis">
      <div class="kpi"><strong>${st.seen}</strong><span>découvertes</span></div>
      <div class="kpi"><strong>${st.acquired}</strong><span>acquises</span></div>
      <div class="kpi"><strong>${st.fragile}</strong><span>à consolider</span></div>
      <div class="kpi"><strong>${s}</strong><span>jour${s > 1 ? 's' : ''} d'affilée</span></div>
    </div>
    <section class="prog-block">
      <h2>Vos livres</h2>
      <div class="level-bar" role="img" aria-label="${levels.map((n, l) => `${n} ${LEVEL_LABEL[l]}`).join(', ')}">${levels.map((n, l) => n ? `<span class="lb l${l}" style="flex:${n}"><b>${n}</b></span>` : '').join('')}</div>
      <p class="legend-row">${LEVEL_LABEL.map((l, i) => `<span><i class="sw l${i}"></i>${l}</span>`).join('')}</p>
    </section>
    <div class="prog-grid">
      <section class="prog-block">
        <h2>Vos quatre savoir-faire</h2>
        ${[1, 2, 3, 4].map((k) => `<div class="comp-row"><span>${compNames[k]}</span><div class="bar"><span class="c${k}" style="width:${Math.round((m[k] || 0) * 100)}%"></span></div><b>${Math.round((m[k] || 0) * 100)} %</b></div>`).join('')}
      </section>
      <section class="prog-block">
        <h2>Régularité</h2>
        <div class="calendar" aria-label="Jours d'étude des quatre dernières semaines">
          ${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x) => `<span class="dow">${x}</span>`).join('')}
          ${cells.join('')}
        </div>
      </section>
      <section class="prog-block chart">
        <h2>Notions acquises au fil du temps</h2>
        ${series.length >= 2 ? lineChart(series.map(([k, d]) => [k, d.acquired]), st.total) : '<p class="empty">La courbe apparaîtra après quelques jours.</p>'}
      </section>
      <section class="prog-block">
        <h2>Révisions à venir</h2>
        <div class="forecast">${forecast.map((n, i) => `<div><b>${n}</b><i style="height:${(n / fmax) * 70}%"></i><span>${i === 0 ? 'auj.' : new Date(today + i * DAY).toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')}</span></div>`).join('')}</div>
      </section>
    </div>
    <p class="actions" style="margin-top:2rem"><a class="btn ghost" href="#/reglages">Sauvegarder ma progression</a></p>`);
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
    <header class="page-head"><h1>Sauvegarde et réglages</h1>
    <p>Votre progression reste dans ce navigateur, sur cet appareil. Pour ne pas la perdre — ou la retrouver sur un autre appareil — exportez-la de temps en temps.</p></header>
    ${w ? `<p class="warn">${esc(w)}</p>` : ''}
    <div class="settings">
      <section class="setting">
        <h2>Sauvegarder</h2>
        <div class="actions">
          <button class="btn" data-action="export">Télécharger ma sauvegarde</button>
          <label class="btn ghost file-label">Restaurer une sauvegarde<input type="file" accept="application/json,.json" data-action="import"></label>
        </div>
        <p class="hint">La restauration remplace la progression actuelle.</p>
      </section>
      <section class="setting">
        <h2>Sur l'écran d'accueil</h2>
        <p>Installée, l'application s'ouvre d'un geste, en plein écran, avec son logo — et fonctionne hors connexion.</p>
        ${installHelp()}
      </section>
      <section class="setting">
        <h2>Durée des séances</h2>
        <div class="seg" role="group" aria-label="Taille de séance">${[[10, 'Courte · ~8 min'], [15, 'Normale · ~12 min'], [20, 'Longue · ~16 min']].map(([n, l]) => `<button data-action="set-size" data-v="${n}" aria-pressed="${p.settings.size === n}">${l}</button>`).join('')}</div>
      </section>
      <section class="setting">
        <h2>Apparence</h2>
        <div class="seg" role="group" aria-label="Thème">${[['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']].map(([v, l]) => `<button data-action="set-theme" data-v="${v}" aria-pressed="${p.settings.theme === v}">${l}</button>`).join('')}</div>
      </section>
      <section class="setting">
        <h2>Votre PDF du dossier</h2>
        <p>Le PDF n'est pas publié avec l'application (droits d'auteur). Si vous l'avez, associez-le : il reste sur cet appareil et les fiches ouvrent la bonne page.</p>
        <div class="actions">
          ${hasPdf() ? `<span class="ok-text">✓ PDF associé</span><button class="btn ghost small" data-action="pdf-remove">Retirer</button>` : `<label class="btn ghost file-label">Associer le PDF<input type="file" accept="application/pdf,.pdf" data-action="pdf-add"></label>`}
        </div>
      </section>
      <section class="setting">
        <h2>Erreurs signalées</h2>
        ${p.reports.length ? `<ul class="report-list">${p.reports.slice().reverse().map((r) => `<li><b>${esc(r.target)}</b> — ${esc(r.text)} <span class="empty">(${new Date(r.t).toLocaleDateString('fr-FR')})</span></li>`).join('')}</ul>
        <div class="actions"><button class="btn ghost small" data-action="copy-reports">Copier</button><a class="btn ghost small" href="${REPO}/issues" target="_blank" rel="noopener">Tickets GitHub ↗</a></div>` : '<p class="empty">Aucune. Le lien « Signaler une erreur » se trouve dans chaque fiche et sous chaque carte.</p>'}
      </section>
      <section class="setting">
        <h2>Tout recommencer</h2>
        <div class="actions"><button class="btn ghost small" data-action="show-onboarding">Revoir l'explication de départ</button><button class="btn ghost small danger" data-action="reset">Effacer ma progression</button></div>
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
    <h1>Sources et méthode</h1>
    <p>Tout le contenu s'appuie sur le dossier « ${esc(C.meta.dossier)} », ${esc(C.meta.magazine)}, ${esc(C.meta.numero)}, ${esc(C.meta.date)}, coordonné par ${esc(C.meta.coordination)}.</p>
    <h2>Trois voix, toujours distinguées</h2>
    <div class="legend">${Object.entries(C.legende).map(([k, v]) => `<div>${natureTag(k)}<span>${esc(v)}</span></div>`).join('')}</div>
    <h2>Comment le dossier a été lu</h2>
    <ul>
      <li>Le PDF (${C.meta.pagesPdf} pages photographiées) a été relu page par page sur l'image ; titres, auteurs, pages, notions et citations ont été contrôlés.</li>
      <li>Les fiches reformulent les analyses ; les articles ne sont pas reproduits. Les citations sont brèves et attribuées.</li>
      <li>${esc(C.meta.correspondance)}</li>
    </ul>
    <h2>Pourquoi ${C.oeuvres.length} livres et pas 30 ?</h2>
    <p>${esc(C.meta.perimetre)}</p>
    <p>Annoncés dans l'introduction sans article dans les pages fournies : ${C.annoncees.map((a) => `<em>${esc(a.titre)}</em>`).join(', ')}. Ils ne nourrissent aucune question.</p>
    ${partial.length ? `<h2>Points à vérifier</h2><ul>${partial.map((o) => `<li><a href="#/oeuvre/${o.id}"><em>${esc(o.titre)}</em></a> — ${esc(o.verification.notes)}</li>`).join('')}</ul>` : ''}
    <p>Dates données comme simple repère (absentes des articles) : ${repere.map((o) => `<em>${esc(shortTitle(o))}</em>`).join(', ')}.</p>
    <h2>La méthode d'apprentissage</h2>
    <p>Chaque carte a son propre calendrier. Raté : elle revient dans 10 minutes. Réussi : demain, puis dans 3 jours, puis de plus en plus tard selon votre aisance (jamais plus de 4 mois). Une notion n'est « acquise » qu'après trois réussites d'affilée et au moins trois semaines d'intervalle. Quatre savoir-faire sont suivis séparément : connaître le livre, comprendre ses idées, penser le présent, relier les livres.</p>
    <h2>Droits</h2>
    <p>Les analyses résumées appartiennent à leurs auteurs et au <em>Magazine littéraire</em> ; les couvertures, à leurs éditeurs. Application d'étude, sans reproduction des articles ni diffusion du PDF.</p>
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
      toast('Merci ! Signalement enregistré.');
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

function rerenderKeepScroll(fn) {
  const y = window.scrollY;
  fn();
  window.scrollTo(0, y);
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-gloss-close]') || !e.target.closest('#gloss, .gloss')) hideGloss();
});

main.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  switch (a) {
    case 'install':
      if (installEvent) { installEvent.prompt(); const r = await installEvent.userChoice; installEvent = null; if (r.outcome !== 'accepted') toast('Vous pourrez l\'installer plus tard depuis les réglages.'); route(); }
      break;
    case 'install-dismiss': P().settings.installDismissed = true; store.save(); viewHome(); break;
    case 'onboarded': P().settings.onboarded = true; store.save(); viewHome(); break;
    case 'show-onboarding': P().settings.onboarded = false; store.save(); location.hash = '#/'; break;
    case 'quit': session.done = true; persistSession(); location.hash = '#/'; break;
    case 'intro-done': P().opened[currentItem().oeuvre] = Date.now(); store.save(); advance(); break;
    case 'intro-next': ui.step = (ui.step || 0) + 1; renderItem(); break;
    case 'intro-prev': ui.step = Math.max(0, (ui.step || 0) - 1); renderItem(); break;
    case 'hint': ui.hint = true; rerenderKeepScroll(renderItem); break;
    case 'gloss': e.preventDefault(); e.stopPropagation(); showGloss(el.dataset.g, el); return;
    case 'reveal': ui.revealed = true; renderItem(); main.querySelector('.reveal')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); break;
    case 'reveal-blank': ui.revealed = true; ui.blank = true; renderItem(); break;
    case 'choose':
      if (ui.choice == null) {
        ui.choice = Number(el.dataset.i);
        renderItem();
        main.querySelector('.reveal')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      break;
    case 'grade': recordGrade(Number(el.dataset.g)); break;
    case 'tick': ui.ticks ||= []; ui.ticks[Number(el.dataset.k)] = el.checked; rerenderKeepScroll(renderItem); break;
    case 'match-l': {
      const i = Number(el.dataset.i);
      if (ui.pairs?.[i] != null) { delete ui.pairs[i]; ui.sel = null; } else ui.sel = ui.sel === i ? null : i;
      rerenderKeepScroll(renderItem);
      break;
    }
    case 'match-r': {
      const r = Number(el.dataset.i);
      ui.pairs ||= {};
      const owner = Object.keys(ui.pairs).find((k) => ui.pairs[k] === r);
      if (owner != null) delete ui.pairs[owner];
      if (ui.sel != null) { ui.pairs[ui.sel] = r; ui.sel = null; }
      rerenderKeepScroll(renderItem);
      break;
    }
    case 'match-reset': ui.pairs = {}; ui.sel = null; rerenderKeepScroll(renderItem); break;
    case 'match-check': ui.checked = true; renderItem(); break;
    case 'report': openReport(el.dataset.target); break;
    case 'ref-theme': refState.theme = el.dataset.v; viewReflexion(); break;
    case 'goto-link': e.preventDefault(); refState.theme = ''; refState.open = el.dataset.id; location.hash = '#/reflexion'; break;
    case 'defi-start': newDefi(); document.body.classList.add('focus-mode'); viewDefi(); break;
    case 'defi-pick': {
      const r = defi.rounds[defi.i];
      defi.answer = el.dataset.id;
      if (defi.answer === r.o) { defi.score++; defi.combo++; defi.bestCombo = Math.max(defi.bestCombo, defi.combo); } else defi.combo = 0;
      rerenderKeepScroll(viewDefi);
      break;
    }
    case 'defi-quit': defi = null; document.body.classList.remove('focus-mode'); location.hash = '#/'; break;
    case 'defi-next': defi.i++; defi.answer = null; viewDefi(); break;
    case 'set-size': P().settings.size = Number(el.dataset.v); store.save(); if (session && !session.done && session.key === 'jour' && session.index === 0) session = null; viewSettings(); toast('C\'est noté.'); break;
    case 'set-theme': P().settings.theme = el.dataset.v; store.save(); applyTheme(); viewSettings(); break;
    case 'export': download(`instant-critique-${dayKey()}.json`, exportText(P())); toast('Sauvegarde téléchargée.'); break;
    case 'pdf-remove': await removePdf(); viewSettings(); toast('PDF retiré de cet appareil.'); break;
    case 'copy-reports': {
      const txt = P().reports.map((r) => `- [${new Date(r.t).toLocaleDateString('fr-FR')}] ${r.target} : ${r.text}`).join('\n');
      try { await navigator.clipboard.writeText(txt); toast('Copié.'); } catch { toast('Copie impossible : utilisez la sauvegarde.'); }
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
  if (el.dataset.action === 'lib-theme') {
    libState.theme = el.value;
    document.getElementById('lib-results').innerHTML = libraryResults();
  }
  if (el.dataset.action === 'import' && el.files?.[0]) {
    try {
      const next = validateImport(await el.files[0].text());
      if (!confirm('Remplacer la progression actuelle par celle du fichier ?')) return;
      store.replace(next);
      session = null;
      applyTheme();
      viewSettings();
      toast('Sauvegarde restaurée.');
    } catch (err) { toast(err.message); }
  }
  if (el.dataset.action === 'pdf-add' && el.files?.[0]) {
    try { await savePdf(el.files[0]); viewSettings(); toast('PDF associé.'); } catch { toast('Impossible d\'enregistrer le PDF sur cet appareil.'); }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target.closest('textarea, input, select, dialog')) return;
  const press = (sel) => { const b = main.querySelector(sel); if (b && !b.disabled) { e.preventDefault(); b.click(); return true; } return false; };
  if (location.hash.startsWith('#/defi') && defi) {
    if (/^[1-4]$/.test(e.key)) { const o = main.querySelectorAll('.defi-option:not([disabled])')[Number(e.key) - 1]; if (o) { e.preventDefault(); o.click(); } }
    if (e.key === 'Enter' || e.key === ' ') press('[data-action="defi-next"]');
    return;
  }
  if (!location.hash.startsWith('#/seance') || !session || session.done) return;
  const item = currentItem();
  if (!item) return;
  if (e.key === 'Escape') return press('[data-action="quit"]');
  if (item.type === 'intro') { if (e.key === 'Enter' || e.key === ' ') { if (!press('[data-action="intro-next"]')) press('[data-action="intro-done"]'); } return; }
  if (e.key === ' ' || e.key === 'Enter') {
    if (press('[data-action="reveal"]')) return;
    if (press('.after .btn')) return;
    if (press('[data-action="match-check"]')) return;
  }
  if (/^[1-4]$/.test(e.key)) {
    const n = Number(e.key);
    if (main.querySelector('.grades')) return press(`.grades [data-g="${n}"]`);
    const choices = main.querySelectorAll('.choice:not([disabled])');
    if (choices[n - 1]) { e.preventDefault(); choices[n - 1].click(); }
  }
  if (/^[a-d]$/i.test(e.key)) {
    const choices = main.querySelectorAll('.choice:not([disabled])');
    const c = choices['abcd'.indexOf(e.key.toLowerCase())];
    if (c) { e.preventDefault(); c.click(); }
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
  buildGloss();
  await initPdf();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  route();
}

start();
