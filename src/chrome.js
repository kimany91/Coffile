'use strict';
// Chrome piloté par Coffile, derrière l'app.
// Coffile lance Chrome avec son propre profil (« Coffile ») : Chrome n'autorise plus le pilotage
// du profil principal. L'utilisateur s'y connecte à Google une seule fois ; ensuite la fenêtre
// reste hors de l'écran et Coffile y lit Gmail / Chat et récupère les cookies de session
// pour télécharger les Drive privés. Aucune clé, aucun identifiant n'est stocké par Coffile.
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { findChrome } = require('./browser');

const OFFSCREEN = { left: -32000, top: -32000, width: 1280, height: 900 };
const VISIBLE = { left: 120, top: 80, width: 1180, height: 860 };
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
function abortError() {
  const e = new Error('Annulé');
  e.name = 'AbortError';
  return e;
}

// Erreurs d'un onglet que Chrome a remplacé ou fermé : on recrée l'onglet et on réessaie.
// Sans activité pendant ce temps, Coffile ferme son Chrome pour libérer la mémoire
// (il se relance tout seul au besoin).
const IDLE_MS = 4 * 60 * 1000;
const JANITOR_MS = 30 * 1000;

const LOST_PAGE_RE = /No frame with given id|Target (page, context or browser )?(has been )?closed|Target closed|has been closed|Execution context was destroyed|frame was detached|Session closed/i;

class ChromeSession {
  // accountsBase / gmailBase : adresses Google (modifiables pour les tests).
  constructor({ profileDir, executable, accountsBase = 'https://accounts.google.com', gmailBase = 'https://mail.google.com' }) {
    this.profileDir = profileDir;
    this.executable = executable || process.env.COFFILE_CHROME || findChrome();
    this.accountsBase = accountsBase;
    this.gmailBase = gmailBase;
    this.proc = null;
    this.browser = null;
    this.context = null;
    this.workers = {}; // onglets de travail gardés ouverts : { main, gmail, chat, drive, login }
    this.temp = new Set(); // onglets de téléchargement en cours
    this.starting = null;
    this.lastUse = Date.now();
    this.janitor = null;
    this.queue = Promise.resolve();
    this.accounts = [];
  }

  get available() {
    return !!this.executable;
  }

  get running() {
    return !!(this.browser && this.browser.isConnected());
  }

  touch() {
    this.lastUse = Date.now();
  }

  // Exécute les opérations sur l'onglet de travail une par une.
  exclusive(fn) {
    this.touch();
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  // Port de débogage d'un Chrome de Coffile encore ouvert (session précédente, app fermée
  // brutalement…) : on s'y reconnecte au lieu d'en lancer un autre sur le même profil, ce qui
  // ouvrirait une fenêtre de plus dans l'ancien.
  async existingEndpoint(portFile) {
    try {
      const [port] = (await fsp.readFile(portFile, 'utf8')).trim().split('\n');
      const res = await fetch(`http://127.0.0.1:${Number(port)}/json/version`, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return null;
      const info = await res.json();
      return info.webSocketDebuggerUrl || null;
    } catch {
      return null;
    }
  }

  async start() {
    this.touch();
    if (this.running) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      if (!this.executable) {
        const e = new Error("Google Chrome n'est pas installé sur ce PC.");
        e.code = 'NO_CHROME';
        throw e;
      }
      await fsp.mkdir(this.profileDir, { recursive: true });
      const portFile = path.join(this.profileDir, 'DevToolsActivePort');
      let endpoint = await this.existingEndpoint(portFile);
      if (!endpoint) endpoint = await this.launch(portFile);
      const { chromium } = require('playwright-core');
      this.browser = await chromium.connectOverCDP(endpoint);
      this.context = this.browser.contexts()[0];
      this.dlSession = null;
      this.browser.on('disconnected', () => {
        this.browser = null;
        this.context = null;
        this.workers = {};
        this.temp.clear();
        this.dlSession = null;
        clearInterval(this.janitor);
        this.janitor = null;
      });
      // Onglets laissés par une session précédente (ou restaurés par Chrome) : fermés.
      await this.tidy();
      clearInterval(this.janitor);
      this.janitor = setInterval(() => this.housekeeping(), JANITOR_MS);
      if (this.janitor.unref) this.janitor.unref();
    })();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async launch(portFile) {
    {
      await fsp.rm(portFile, { force: true });
      const args = [
        `--user-data-dir=${this.profileDir}`,
        '--remote-debugging-port=0',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=Translate,ChromeWhatsNewUI',
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        `--window-position=${OFFSCREEN.left},${OFFSCREEN.top}`,
        `--window-size=${OFFSCREEN.width},${OFFSCREEN.height}`,
        'about:blank'
      ];
      if (process.env.COFFILE_CHROME_ARGS) args.unshift(...process.env.COFFILE_CHROME_ARGS.split(' '));
      this.proc = spawn(this.executable, args, { stdio: 'ignore', detached: false });
      this.proc.on('exit', () => {
        this.proc = null;
        this.browser = null;
        this.context = null;
        this.workers = {};
        this.dlSession = null;
      });
      // Chrome écrit son port de débogage dans le profil.
      let endpoint = null;
      for (let i = 0; i < 400 && !endpoint; i++) {
        await new Promise((r) => setTimeout(r, 100));
        try {
          const [port, wsPath] = (await fsp.readFile(portFile, 'utf8')).trim().split('\n');
          if (port && wsPath) endpoint = `ws://127.0.0.1:${port}${wsPath}`;
        } catch {}
      }
      if (!endpoint) throw new Error('Chrome ne répond pas.');
      return endpoint;
    }
  }

  // Ferme tous les onglets qui ne sont pas des onglets de travail de Coffile.
  // Une fenêtre doit garder au moins un onglet, sinon Chrome se ferme.
  async tidy() {
    if (!this.context) return 0;
    const keep = new Set([...Object.values(this.workers), ...this.temp].filter((p) => p && !p.isClosed()));
    let spare = keep.size ? null : undefined;
    let closed = 0;
    for (const p of this.context.pages()) {
      if (keep.has(p)) continue;
      if (spare === undefined) {
        spare = p;
        continue;
      }
      await p.close().catch(() => {});
      closed++;
    }
    return closed;
  }

  // Toutes les 30 s : ménage des onglets, et fermeture de Chrome après 4 min sans activité.
  async housekeeping() {
    if (!this.running || this.starting) return;
    const busy = this.temp.size || (this.dlByGuid && this.dlByGuid.size) || (this.workers.login && !this.workers.login.isClosed());
    if (!busy && Date.now() - this.lastUse > IDLE_MS) return this.stop();
    await this.tidy().catch(() => {});
  }

  // Onglet de travail créé par Coffile (jamais l'onglet ouvert par Chrome au démarrage,
  // que les versions récentes de Chrome peuvent remplacer en interne).
  // Un onglet par usage (« gmail », « chat », « main ») : Gmail et Chat restent chargés
  // entre deux lectures, ce qui évite de tout recharger à chaque fois.
  async page(name = 'main') {
    await this.start();
    this.touch();
    const cur = this.workers[name];
    if (!cur || cur.isClosed()) this.workers[name] = await this.context.newPage();
    return this.workers[name];
  }

  get worker() {
    return this.workers.main || null;
  }

  // Navigation d'un onglet de travail, avec reprise si Chrome a remplacé l'onglet.
  async goto(url, opts = {}, name = 'main') {
    for (let attempt = 0; ; attempt++) {
      const page = await this.page(name);
      try {
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000, ...opts });
        return { page, res };
      } catch (e) {
        if (attempt >= 2 || !LOST_PAGE_RE.test(e.message)) throw e;
        await page.close().catch(() => {});
        delete this.workers[name];
      }
    }
  }

  // Même chose pour un onglet donné (fenêtre de connexion) : renvoie l'onglet utilisable.
  async gotoOn(page, url, opts = {}) {
    for (let attempt = 0; ; attempt++) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000, ...opts });
        return page;
      } catch (e) {
        if (attempt >= 2 || !LOST_PAGE_RE.test(e.message)) throw e;
        await page.close().catch(() => {});
        page = await this.context.newPage();
        if (this.workers.login && this.workers.login.isClosed()) this.workers.login = page;
        await this.setPageBounds(page, VISIBLE).catch(() => {});
      }
    }
  }

  async setPageBounds(page, bounds) {
    const cdp = await this.context.newCDPSession(page);
    try {
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      // Mac : une fenêtre ne peut pas sortir de l'écran, elle est réduite dans le Dock à la place.
      if (bounds === OFFSCREEN && process.platform === 'darwin') {
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
        return;
      }
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await cdp.send('Browser.setWindowBounds', { windowId, bounds });
    } finally {
      await cdp.detach().catch(() => {});
    }
  }

  async show() {
    const page = await this.page();
    await this.setPageBounds(page, VISIBLE);
    await page.bringToFront().catch(() => {});
  }

  async hide() {
    await this.setPageBounds(await this.page(), OFFSCREEN);
  }

  // Comptes Google connectés dans ce Chrome (l'ordre donne le numéro « u/0 », « u/1 »…).
  async listAccounts() {
    return this.exclusive(async () => {
      let accounts = [];
      try {
        // Lecture du corps brut de la réponse : Chrome affiche le JSON avec une case
        // « Pretty-print » qui fausserait la lecture du texte de la page.
        const { res } = await this.goto(`${this.accountsBase}/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard`, { timeout: 30000 });
        if (res) accounts = parseListAccounts(await res.text());
      } catch {}
      // Repli : on interroge Gmail compte par compte (u/0, u/1…).
      if (!accounts.length) accounts = await this.probeGmailAccounts();
      await this.goto('about:blank').catch(() => {});
      this.accounts = accounts;
      return accounts;
    });
  }

  // Le flux Atom de Gmail indique l'adresse du compte de chaque session « u/N ».
  async probeGmailAccounts() {
    const out = [];
    for (let u = 0; u < 6; u++) {
      let email = null;
      try {
        const { page, res } = await this.goto(`${this.gmailBase}/mail/u/${u}/feed/atom`, { timeout: 20000 });
        if (!res || /accounts\.google\.com|ServiceLogin/.test(page.url())) break;
        const m = (await res.text()).match(/<title>([^<]*)<\/title>/i);
        email = m && (m[1].match(EMAIL_RE) || [])[0];
      } catch {
        break;
      }
      if (!email || out.some((a) => a.email === email)) break;
      out.push({ email, name: email, picture: null, u });
    }
    return out;
  }

  // Ouvre la fenêtre Chrome pour se connecter (ou ajouter un compte), attend la fin, puis la cache.
  async login({ add = false, onWaiting } = {}) {
    // Un seul onglet de connexion, réutilisé si on reclique sur « Se connecter ».
    let page = await this.page('login');
    const known = new Set(this.accounts.map((a) => a.email));
    let accounts = [];
    try {
      const target = `${this.gmailBase}/mail/`;
      const url = add
        ? `${this.accountsBase}/AddSession?continue=${encodeURIComponent(target)}`
        : `${this.accountsBase}/ServiceLogin?continue=${encodeURIComponent(target)}`;
      await this.setPageBounds(page, VISIBLE).catch(() => {});
      page = await this.gotoOn(page, url).catch(() => page);
      await page.bringToFront().catch(() => {});
      onWaiting && onWaiting();
      // Attend que Gmail s'affiche avec un compte lisible (connexion réussie) ou la fermeture
      // de l'onglet. Tant qu'aucun compte n'est lu, la fenêtre reste visible.
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline && !page.isClosed()) {
        this.touch();
        if (page.url().startsWith(`${this.gmailBase}/mail/`)) {
          accounts = await this.listAccounts().catch(() => []);
          if (!accounts.length) {
            const fromTitle = await this.accountFromGmailPage(page);
            if (fromTitle) accounts = [fromTitle];
          }
          if (accounts.length && (!add || accounts.some((a) => !known.has(a.email)))) break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (accounts.length && !page.isClosed()) await this.setPageBounds(page, OFFSCREEN).catch(() => {});
    } finally {
      if (accounts.length) {
        if (!page.isClosed()) await page.close().catch(() => {});
        delete this.workers.login;
      }
    }
    if (!accounts.length && !this.accounts.length) accounts = await this.listAccounts().catch(() => []);
    this.accounts = accounts.length ? accounts : this.accounts;
    return this.accounts;
  }

  // Dernier recours : l'adresse figure dans le titre de Gmail (« Boîte de réception - x@gmail.com - Gmail »).
  async accountFromGmailPage(page) {
    try {
      await page.waitForFunction((re) => new RegExp(re).test(document.title), EMAIL_RE.source, { timeout: 15000 });
      const email = (await page.title()).match(EMAIL_RE)[0];
      const u = Number((page.url().match(/\/mail\/u\/(\d+)/) || [])[1] || 0);
      return { email, name: email, picture: null, u };
    } catch {
      return null;
    }
  }

  // En-tête Cookie de la session pour une adresse (téléchargement des Drive privés).
  // Requête faite depuis un onglet de Chrome sur le même site : Chrome envoie lui-même sa session
  // Google complète (cookies liés à l'appareil compris). Renvoie { status, url, text }.
  async fetchText(url) {
    const origin = new URL(url).origin;
    for (let attempt = 0; ; attempt++) {
      let page = await this.page('drive');
      try {
        if (!page.url().startsWith(`${origin}/`)) {
          if (!this.driveNav) this.driveNav = this.goto(`${origin}/robots.txt`, {}, 'drive').finally(() => (this.driveNav = null));
          page = (await this.driveNav).page;
        }
        return await page.evaluate(async (u) => {
          try {
            const r = await fetch(u, { credentials: 'include' });
            return { status: r.status, url: r.url, text: await r.text() };
          } catch (e) {
            // Redirection vers la page de connexion Google (autre site) : pas d'accès.
            return { status: 0, url: u, text: '', error: String(e && e.message) };
          }
        }, url);
      } catch (e) {
        if (attempt >= 2 || !LOST_PAGE_RE.test(e.message)) throw e;
        await page.close().catch(() => {});
        delete this.workers.drive;
      }
    }
  }

  // Téléchargement par Chrome (sa session Google) dans dir. nextUrl(html) donne l'adresse suivante
  // quand Google affiche une page de confirmation au lieu du fichier.
  // Renvoie { path, name, size }.
  async download(url, dir, { signal, onProgress, nextUrl } = {}) {
    await this.start();
    if (!this.dlSession) {
      this.dlSession = await this.browser.newBrowserCDPSession();
      this.dlByFrame = new Map();
      this.dlByGuid = new Map();
      this.dlSession.on('Browser.downloadWillBegin', (e) => {
        const cb = this.dlByFrame.get(e.frameId);
        if (cb) cb(e);
      });
      this.dlSession.on('Browser.downloadProgress', (e) => {
        const h = this.dlByGuid.get(e.guid);
        if (!h) return;
        if (e.state === 'inProgress') h.onProgress && h.onProgress(e.receivedBytes, e.totalBytes);
        else if (e.state === 'completed') {
          this.dlByGuid.delete(e.guid);
          h.onProgress && h.onProgress(e.receivedBytes, e.totalBytes);
          h.resolve(e.receivedBytes);
        } else if (e.state === 'canceled') {
          this.dlByGuid.delete(e.guid);
          h.reject(new Error('Téléchargement interrompu dans Chrome.'));
        }
      });
    }
    const session = this.dlSession;
    await fsp.mkdir(dir, { recursive: true });
    await session.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: dir, eventsEnabled: true });
    const page = await this.context.newPage();
    this.temp.add(page);
    let frameId = null;
    try {
      const cdp = await this.context.newCDPSession(page);
      frameId = (await cdp.send('Page.getFrameTree')).frameTree.frame.id;
      await cdp.detach().catch(() => {});
      const begun = new Promise((resolve) => this.dlByFrame.set(frameId, resolve));
      const wait = (ms) => new Promise((r) => setTimeout(() => r(null), ms));
      let info = null;
      let target = url;
      for (let hop = 0; hop < 4 && !info; hop++) {
        if (signal && signal.aborted) throw abortError();
        const nav = page.goto(target, { waitUntil: 'load', timeout: 120000 }).then(
          () => 'loaded',
          () => 'aborted'
        );
        const first = await Promise.race([begun, nav]);
        if (first && first.guid) {
          info = first;
          break;
        }
        // Le téléchargement peut démarrer juste après la fin de la navigation.
        info = await Promise.race([begun, wait(first === 'aborted' ? 10000 : 2500)]);
        if (info) break;
        if (first === 'aborted') throw new Error("Chrome n'a pas pu ouvrir le lien de téléchargement.");
        const html = await page.content().catch(() => '');
        const next = nextUrl && nextUrl(html);
        if (!next) {
          throw new Error(
            /accounts\.google\.com|ServiceLogin/.test(page.url() + html)
              ? "Ce compte Google n'a pas accès à ce fichier."
              : 'Google Drive a affiché une page au lieu du fichier (fichier privé ou quota dépassé).'
          );
        }
        target = next;
      }
      if (!info) throw new Error('Trop de pages de confirmation Google Drive.');
      this.dlByFrame.delete(frameId);
      page.close().catch(() => {});
      const done = new Promise((resolve, reject) => this.dlByGuid.set(info.guid, { onProgress, resolve, reject }));
      const cancel = () => session.send('Browser.cancelDownload', { guid: info.guid }).catch(() => {});
      if (signal) signal.addEventListener('abort', cancel, { once: true });
      try {
        const size = await done;
        return { path: path.join(dir, info.guid), name: info.suggestedFilename || null, size };
      } catch (e) {
        if (signal && signal.aborted) throw abortError();
        throw e;
      } finally {
        if (signal) signal.removeEventListener('abort', cancel);
        await fsp.rm(path.join(dir, `${info.guid}.crdownload`), { force: true }).catch(() => {});
      }
    } finally {
      if (frameId) this.dlByFrame.delete(frameId);
      this.temp.delete(page);
      if (!page.isClosed()) page.close().catch(() => {});
    }
  }

  async cookieHeader(url) {
    await this.start();
    const cookies = await this.context.cookies(url);
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  // Ferme vraiment Chrome (se déconnecter ne suffit pas : il resterait ouvert avec ses onglets).
  async stop() {
    clearInterval(this.janitor);
    this.janitor = null;
    const proc = this.proc;
    try {
      if (this.browser) {
        const session = await this.browser.newBrowserCDPSession();
        await session.send('Browser.close').catch(() => {});
      }
    } catch {}
    try {
      if (this.browser) await Promise.race([this.browser.close(), new Promise((r) => setTimeout(r, 3000))]);
    } catch {}
    if (proc) proc.kill();
    this.proc = null;
    this.browser = null;
    this.context = null;
    this.workers = {};
    this.temp.clear();
    this.dlSession = null;
  }
}

// Réponse de ListAccounts : ["gaia.l.a.r",[["gaia.l.a",1,"Nom","email",photo,…],…]]
// (un éventuel préfixe anti-XSSI comme « )]}' » est ignoré).
function parseListAccounts(raw) {
  try {
    const text = String(raw || '');
    const start = text.indexOf('[');
    if (start < 0) return [];
    const data = JSON.parse(text.slice(start));
    // L'index dans la liste est le numéro de session Google (u/0, u/1…).
    return (Array.isArray(data[1]) ? data[1] : [])
      .map((a, i) => (Array.isArray(a) && typeof a[3] === 'string' && EMAIL_RE.test(a[3]) ? { email: a[3], name: a[2] || a[3], picture: a[4] || null, u: i } : null))
      .filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { ChromeSession, parseListAccounts };
