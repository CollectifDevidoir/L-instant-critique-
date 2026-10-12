// Test de bout en bout dans Chromium (Playwright) : `npm run test:e2e`.
// Démarre le serveur local, parcourt toutes les vues, joue une séance complète,
// vérifie la persistance après rechargement et l'export/import, sur ordinateur
// et sur mobile. Les captures sont écrites dans test-results/.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

async function loadPlaywright() {
  try { return await import('playwright'); } catch {
    const require = createRequire(import.meta.url);
    const { execSync } = await import('node:child_process');
    const globalRoot = execSync('npm root -g').toString().trim();
    return require(`${globalRoot}/playwright`);
  }
}

const PORT = 8137;
const BASE = `http://localhost:${PORT}/`;
const OUT = new URL('../test-results/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
await new Promise((r) => server.stdout.once('data', r));

const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH ? {} : { executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const errors = [];
let failures = 0;

async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); } catch (e) { failures++; console.log(`not ok - ${name}\n  ${e.message.split('\n').join('\n  ')}`); }
}

function watch(page, label) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message} ${e.stack?.split('\n')[1] || ''}`));
  page.on('requestfailed', (r) => { if (!r.url().includes('fonts.g')) errors.push(`${label}: requête échouée ${r.url()}`); });
}

// Répond à l'élément courant de la séance, quel que soit son format.
async function answerCurrent(page, strategy = 'good') {
  if (await page.locator('[data-action="intro-next"]').count()) return page.click('[data-action="intro-next"]');
  if (await page.locator('[data-action="intro-done"]').count()) return page.click('[data-action="intro-done"]');
  if (await page.locator('[data-action="choose"]').count()) {
    await page.locator('[data-action="choose"]').first().click();
    return page.locator('.after .btn').click();
  }
  if (await page.locator('[data-action="match-l"]').count()) {
    const n = await page.locator('[data-action="match-l"]').count();
    for (let i = 0; i < n; i++) {
      await page.locator(`[data-action="match-l"][data-i="${i}"]`).click();
      await page.locator(`[data-action="match-r"][data-i="${i}"]`).click();
    }
    await page.click('[data-action="match-check"]');
    return page.locator('.after .btn').click();
  }
  if (await page.locator('textarea.free').count()) {
    await page.fill('textarea.free', 'Ma restitution personnelle de l\'idée centrale.');
    await page.click('[data-action="reveal"]');
    await page.locator('[data-action="tick"]').first().check();
    return page.click(`.grades [data-g="${strategy === 'bad' ? 1 : 3}"]`);
  }
  if (await page.locator('[data-action="reveal"]').count()) {
    await page.keyboard.press('Space');
    await page.waitForSelector('.grades');
    return page.keyboard.press(strategy === 'bad' ? '1' : '3');
  }
  throw new Error('Élément de séance non reconnu');
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-FR', acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'desktop');

  await check('accueil : accroche, bouton principal, compteurs', async () => {
    await page.goto(BASE);
    await page.waitForSelector('.home-head h1');
    assert.match(await page.textContent('.home-head h1'), /penser le monde/);
    assert.match(await page.textContent('.today-card'), /Votre première séance/);
    assert.ok(await page.locator('.onboarding').count(), 'explication de départ');
    await page.screenshot({ path: `${OUT}accueil-onboarding.png`, fullPage: true });
    await page.click('[data-action="onboarded"]');
    assert.equal(await page.locator('.onboarding').count(), 0);
    assert.equal(await page.locator('.spine').count(), 20);
    await page.screenshot({ path: `${OUT}accueil-desktop.png`, fullPage: true });
  });

  let answered = 0;
  await check('séance complète : tous les formats rencontrés se jouent jusqu\'au bilan', async () => {
    await page.click('a.btn.big');
    await page.waitForSelector('.card');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}seance-intro.png` });
    for (let guard = 0; guard < 60 && !(await page.locator('.session-end').count()); guard++) {
      await answerCurrent(page, answered === 2 ? 'bad' : 'good');
      if (await page.locator('.reveal, .grades').count() === 0) answered++;
      await page.waitForTimeout(30);
    }
    assert.ok(await page.locator('.session-end').count(), 'bilan affiché');
    await page.screenshot({ path: `${OUT}seance-bilan.png`, fullPage: true });
  });

  let snapshot;
  await check('persistance après rechargement et fermeture', async () => {
    snapshot = await page.evaluate(() => localStorage.getItem('instant-critique'));
    const data = JSON.parse(snapshot);
    const n = Object.keys(data.cards).length;
    assert.ok(n >= 3, `${n} cartes enregistrées`);
    await page.reload();
    await page.goto(BASE + '#/progression');
    await page.waitForSelector('.kpis');
    const seen = Number(await page.locator('.kpi strong').first().textContent());
    assert.equal(seen, n);
    const page2 = await ctx.newPage();
    watch(page2, 'desktop-2');
    await page2.goto(BASE + '#/progression');
    await page2.waitForSelector('.kpis');
    assert.equal(Number(await page2.locator('.kpi strong').first().textContent()), n);
    await page2.close();
    await page.screenshot({ path: `${OUT}progression.png`, fullPage: true });
  });

  await check('export puis restauration de la progression', async () => {
    await page.goto(BASE + '#/reglages');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
    const file = await dl.path();
    const exported = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(exported.app, 'instant-critique');
    page.once('dialog', (d) => d.accept());
    await page.click('[data-action="reset"]');
    await page.waitForTimeout(100);
    assert.equal(Object.keys(JSON.parse(await page.evaluate(() => localStorage.getItem('instant-critique'))).cards).length, 0);
    page.once('dialog', (d) => d.accept());
    await page.setInputFiles('input[data-action="import"]', file);
    await page.waitForTimeout(300);
    const restored = JSON.parse(await page.evaluate(() => localStorage.getItem('instant-critique')));
    assert.deepEqual(restored.cards, exported.cards);
  });

  await check('bibliothèque : recherche par auteur, notion et thème', async () => {
    await page.goto(BASE + '#/bibliotheque');
    await page.waitForSelector('.book');
    const total = await page.locator('.book').count();
    assert.equal(total, 20);
    await page.fill('#lib-q', 'Ratchkovski');
    assert.ok(await page.locator('.book').count() >= 1);
    await page.fill('#lib-q', 'peguy');
    assert.equal(await page.locator('.book').count(), 1);
    await page.fill('#lib-q', '');
    await page.selectOption('#lib-theme', 'ecologie');
    assert.ok(await page.locator('.book').count() >= 1);
    await page.screenshot({ path: `${OUT}bibliotheque.png`, fullPage: true });
  });

  await check('fiche : quatre sections, source, signalement', async () => {
    await page.goto(BASE + '#/oeuvre/chanson-de-roland');
    await page.waitForSelector('.fiche');
    const h2 = await page.locator('.fiche .block > h2').allTextContents();
    for (const t of ['À retenir', 'Et aujourd\'hui ?']) assert.ok(h2.includes(t), t);
    assert.ok(await page.locator('.fiche .essential .central').count());
    await page.locator('.fiche details.more summary', { hasText: 'Source' }).click();
    assert.match(await page.textContent('.fiche'), /p\. 104-108 · PDF p\. 22/);
    await page.click('.fiche [data-action="report"]');
    await page.fill('#report-text', 'Test de signalement');
    await page.click('#report-dialog button[value="save"]');
    const reports = JSON.parse(await page.evaluate(() => localStorage.getItem('instant-critique'))).reports;
    assert.equal(reports.length, 1);
    await page.screenshot({ path: `${OUT}fiche.png`, fullPage: true });
  });

  await check('réflexion : rapprochements et carnet persistant', async () => {
    await page.goto(BASE + '#/reflexion');
    await page.waitForSelector('.link-card');
    assert.ok(await page.locator('.link-card').count() >= 10);
    await page.click('#lien-ratchkovski summary');
    await page.fill('#note-ratchkovski', 'Ma note de lecture');
    await page.waitForTimeout(600);
    await page.reload();
    await page.waitForSelector('#lien-ratchkovski');
    await page.click('#lien-ratchkovski summary');
    assert.equal(await page.inputValue('#note-ratchkovski'), 'Ma note de lecture');
    await page.screenshot({ path: `${OUT}reflexion.png`, fullPage: true });
  });

  await check('sources, séance ciblée sur une œuvre, liens internes', async () => {
    await page.goto(BASE + '#/sources');
    await page.waitForSelector('.prose');
    await page.goto(BASE + '#/seance/oeuvre/chanson-de-roland');
    await page.waitForSelector('.card');
    assert.match(await page.textContent('.card'), /Roland/);
    assert.equal(await page.locator('[data-action="intro-next"]').count(), 1, 'présentation en trois écrans');
    const hrefs = await page.$$eval('a[href^="#/"]', (as) => as.map((a) => a.getAttribute('href')));
    for (const h of new Set(hrefs)) {
      await page.goto(BASE + h);
      await page.waitForTimeout(40);
      assert.ok(!(await page.textContent('main')).includes('Page introuvable'), h);
    }
  });

  await check('défi éclair : 8 manches, score et record enregistrés', async () => {
    await page.goto(BASE + '#/defi');
    await page.click('[data-action="defi-start"]');
    for (let i = 0; i < 8; i++) {
      await page.waitForSelector('.defi-option');
      await page.locator('.defi-option').first().click();
      await page.click('[data-action="defi-next"]');
    }
    await page.waitForSelector('.defi-start h1');
    assert.match(await page.textContent('.defi-start h1'), /\/8/);
    assert.ok(JSON.parse(await page.evaluate(() => localStorage.getItem('instant-critique'))).defi.best >= 0);
  });

  await check('installable : manifeste, icônes et service worker', async () => {
    const man = await (await page.request.get(BASE + 'manifest.webmanifest')).json();
    assert.equal(man.display, 'standalone');
    for (const i of man.icons) assert.equal((await page.request.get(BASE + i.src)).status(), 200, i.src);
    assert.ok(man.icons.some((i) => i.purpose === 'maskable'));
    assert.equal((await page.request.get(BASE + 'assets/icons/apple-touch-icon.png')).status(), 200);
    await page.goto(BASE);
    const ok = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
    assert.ok(ok, 'service worker actif');
  });

  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR' });
  const m = await mob.newPage();
  watch(m, 'mobile');
  await check('mobile : pas de défilement horizontal, barre d\'onglets visible', async () => {
    for (const h of ['#/', '#/seance', '#/defi', '#/bibliotheque', '#/oeuvre/yourcenar', '#/reflexion', '#/progression', '#/reglages', '#/sources']) {
      await m.goto(BASE + h);
      await m.waitForTimeout(150);
      const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `${h} déborde de ${overflow}px`);
    }
    assert.ok(await m.locator('.tabbar').isVisible());
    await m.goto(BASE + '#/');
    await m.screenshot({ path: `${OUT}accueil-mobile.png`, fullPage: true });
    await m.goto(BASE + '#/seance');
    await m.waitForSelector('.card');
    await m.screenshot({ path: `${OUT}seance-mobile.png`, fullPage: true });
    await m.goto(BASE + '#/oeuvre/princesse-de-cleves');
    await m.screenshot({ path: `${OUT}fiche-mobile.png`, fullPage: true });
  });

  await check('mode sombre', async () => {
    const dark = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
    const d = await dark.newPage();
    watch(d, 'dark');
    await d.goto(BASE + '#/oeuvre/fictions');
    await d.waitForSelector('.fiche');
    const bg = await d.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(bg, 'rgb(23, 20, 15)');
    await d.screenshot({ path: `${OUT}fiche-sombre.png`, fullPage: true });
    await dark.close();
  });

  await check('aucune erreur de console ni requête échouée', async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}

console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests de bout en bout sont passés.');
process.exit(failures ? 1 : 0);
