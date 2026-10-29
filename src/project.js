'use strict';
// Création d'un projet de montage : arborescence, téléchargements Drive,
// copie des bibliothèques liées et projet Premiere Pro.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { DriveClient, filenameFromDisposition, categoryOf, sanitizeName, abortError } = require('./drive');
const { openInBrowser, DownloadWatcher, listZip, extractEntry, moveFile } = require('./browser');

const FOLDERS = {
  rushes: 'RUSHES',
  images: 'IMAGES',
  montage: 'MONTAGE',
  musique: 'MUSIQUE',
  sfx: 'SOUND EFFECT',
  template: 'TEMPLATE',
  other: 'AUTRES'
};

const CATEGORY_FOLDER = { video: FOLDERS.rushes, audio: FOLDERS.rushes, image: FOLDERS.images, other: FOLDERS.other };
const CONCURRENCY = 3;
const TMP_DIR = '.coffile-telechargement';

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

// Évite d'écraser un fichier homonyme : "clip.mp4" -> "clip (2).mp4".
async function uniquePath(p, reserved) {
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  let candidate = p;
  let i = 2;
  while (reserved.has(candidate.toLowerCase()) || (await exists(candidate))) {
    candidate = path.join(dir, `${base} (${i++})${ext}`);
  }
  reserved.add(candidate.toLowerCase());
  return candidate;
}

async function listFilesRecursive(dir) {
  const out = [];
  const walk = async (d) => {
    const entries = await fsp.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) out.push(full);
    }
  };
  await walk(dir);
  return out;
}

class ProjectJob {
  // account : e-mail du compte Google à utiliser ('' = automatique)
  // accounts : comptes Google connectés ; tokenFor(email) -> fonction qui renvoie un jeton d'accès
  // makeClient(compte) : client Drive pour un compte (OAuth, session Chrome « chrome:… » ou null = public).
  // sources : plusieurs liens Drive [{ url, label }] ; chaque lien nommé est rangé dans un
  // sous-dossier à son nom (RUSHES/<nom>, IMAGES/<nom>…).
  // addTo : dossier d'un projet existant ; les fichiers du Drive y sont ajoutés (RUSHES, IMAGES…)
  // sans recréer la structure, les bibliothèques ni le projet Premiere.
  // localDir : dossier du PC (onglet AUTOEDIT) copié ou déplacé (localMode 'copy' | 'move') dans le projet.
  constructor({ name, root, driveUrl, sources = null, addTo = null, localDir = null, localMode = 'copy', settings, fetch, emit, shell, account = '', accounts = [], tokenFor = null, makeClient = null }) {
    this.addTo = addTo ? path.resolve(addTo) : null;
    this.name = this.addTo ? path.basename(this.addTo) : sanitizeName(name);
    this.root = this.addTo ? path.dirname(this.addTo) : root;
    this.dir = this.addTo || path.join(root, this.name);
    this.sources = (sources || []).filter((src) => src && src.url).map((src) => ({ url: String(src.url).trim(), label: sanitizeName(src.label || '').replace(/^sans_nom$/, '') }));
    this.driveUrl = (driveUrl || (this.sources[0] && this.sources[0].url) || '').trim();
    this.localDir = localDir ? path.resolve(localDir) : null;
    this.localMode = localMode === 'move' ? 'move' : 'copy';
    this.clients = new Map(); // fichier -> client Drive qui l'a trouvé (liens de comptes différents)
    this.settings = settings;
    this.emit = emit;
    this.shell = shell;
    this.finishRequested = false;
    this.controller = new AbortController();
    this.fetch = fetch;
    this.account = account;
    this.accounts = accounts;
    this.tokenFor = tokenFor;
    this.makeClient =
      makeClient || ((email) => new DriveClient({ fetch: this.fetch, apiKey: this.settings.apiKey, getToken: email ? this.tokenFor(email) : null }));
    this.drive = new DriveClient({ fetch, apiKey: settings.apiKey });
    this.reserved = new Set();
    this.state = {
      name: this.name,
      dir: this.dir,
      addTo: !!this.addTo,
      source: this.localDir ? 'local' : 'drive',
      localMode: this.localMode,
      status: 'running',
      mode: 'direct',
      account: null,
      browser: null,
      step: 'structure',
      steps: {
        structure: { status: 'pending' },
        scan: { status: this.driveUrl || this.localDir ? 'pending' : 'skipped', found: 0 },
        download: { status: this.driveUrl || this.localDir ? 'pending' : 'skipped' },
        links: { status: 'pending', total: 0, done: 0, current: '' },
        premiere: { status: 'pending' }
      },
      files: [],
      bytesDone: 0,
      bytesTotal: 0,
      speed: 0,
      warnings: [],
      error: null,
      result: null
    };
    this.lastBytes = 0;
    this.lastTick = Date.now();
    this.timer = null;
  }

  get signal() {
    return this.controller.signal;
  }

  cancel() {
    this.controller.abort();
  }

  checkAbort() {
    if (this.signal.aborted) throw abortError();
  }

  setStep(key, patch) {
    Object.assign(this.state.steps[key], patch);
    if (patch.status === 'active') this.state.step = key;
  }

  snapshot() {
    const now = Date.now();
    const dt = (now - this.lastTick) / 1000;
    if (dt >= 0.5) {
      const inst = (this.state.bytesDone - this.lastBytes) / dt;
      this.state.speed = this.state.speed ? this.state.speed * 0.6 + inst * 0.4 : inst;
      this.lastBytes = this.state.bytesDone;
      this.lastTick = now;
    }
    this.emit(JSON.parse(JSON.stringify(this.state)));
  }

  async run() {
    this.timer = setInterval(() => this.snapshot(), 200);
    try {
      await this.createStructure();
      if (this.localDir) await this.importLocal();
      else if (this.driveUrl) await this.importDrive();
      if (this.addTo) {
        this.setStep('links', { status: 'skipped', reason: 'add' });
        this.setStep('premiere', { status: 'skipped', reason: 'add' });
      } else {
        await this.copyLinks();
        await this.createPremiere();
      }
      await fsp.rm(path.join(this.dir, '.filedit-tmp'), { recursive: true, force: true }).catch(() => {});
      const files = this.state.files;
      this.state.result = {
        videos: files.filter((f) => f.status === 'done' && f.category === 'video').length,
        images: files.filter((f) => f.status === 'done' && f.category === 'image').length,
        audio: files.filter((f) => f.status === 'done' && f.category === 'audio').length,
        others: files.filter((f) => f.status === 'done' && f.category === 'other').length,
        failed: files.filter((f) => f.status === 'error').length,
        already: files.filter((f) => f.skipped).length,
        bytes: this.state.bytesDone,
        prproj: this.state.steps.premiere.file || null
      };
      this.state.status = 'done';
      this.state.step = 'done';
    } catch (e) {
      if (e.name === 'AbortError' || this.signal.aborted) {
        this.state.status = 'cancelled';
        for (const f of this.state.files) if (f.status === 'active' || f.status === 'queued') f.status = 'cancelled';
      } else {
        this.state.status = 'error';
        this.state.error = e.message || String(e);
        const cur = this.state.steps[this.state.step];
        if (cur) cur.status = 'error';
      }
    } finally {
      clearInterval(this.timer);
      this.state.speed = 0;
      this.snapshot();
    }
    return this.state;
  }

  // Dossier du PC : chaque fichier rangé selon son type (vidéos et sons → RUSHES, images → IMAGES,
  // le reste → AUTRES), sous-dossiers gardés. Copie (l'original reste) ou déplacement. La date
  // des fichiers est conservée (AUTOEDIT s'en sert pour l'ordre de tournage).
  async importLocal() {
    this.setStep('scan', { status: 'active' });
    const inside = path.relative(this.localDir, this.dir);
    const list = (await listFilesRecursive(this.localDir)).filter((f) => {
      const name = path.basename(f);
      if (/^\.|^(thumbs\.db|desktop\.ini)$/i.test(name)) return false;
      // Le projet lui-même ne doit pas être relu s'il est créé dans le dossier choisi.
      return !(inside && !inside.startsWith('..') && !path.isAbsolute(inside) && f.startsWith(this.dir + path.sep));
    });
    const items = [];
    for (const file of list) {
      const st = await fsp.stat(file);
      items.push({ file, st, name: path.basename(file), rel: path.relative(this.localDir, path.dirname(file)).split(path.sep).filter(Boolean) });
    }
    if (!items.length) throw new Error('Le dossier choisi est vide.');
    this.setStep('scan', { status: 'done', found: items.length });
    this.setStep('download', { status: 'active' });
    this.state.mode = 'local';
    this.state.bytesTotal = items.reduce((a, x) => a + x.st.size, 0);
    for (const it of items) {
      this.checkAbort();
      const f = { key: this.state.files.length, id: null, name: it.name, rel: it.rel, category: categoryOf(it.name), size: it.st.size, received: 0, status: 'active', error: null };
      this.state.files.push(f);
      const destDir = path.join(this.dir, CATEGORY_FOLDER[f.category] || FOLDERS.other, ...it.rel);
      await fsp.mkdir(destDir, { recursive: true });
      const dest = await uniquePath(path.join(destDir, it.name), this.reserved);
      try {
        let moved = false;
        if (this.localMode === 'move') {
          try {
            await fsp.rename(it.file, dest);
            moved = true;
          } catch {}
        }
        if (!moved) {
          await pipeline(
            fs.createReadStream(it.file).on('data', (chunk) => {
              f.received += chunk.length;
              this.state.bytesDone += chunk.length;
            }),
            fs.createWriteStream(dest),
            { signal: this.signal }
          );
          await fsp.utimes(dest, it.st.atime, it.st.mtime).catch(() => {});
          if (this.localMode === 'move') await fsp.unlink(it.file).catch(() => {});
        } else {
          f.received = f.size;
          this.state.bytesDone += f.size;
        }
        f.status = 'done';
      } catch (e) {
        if (this.signal.aborted) throw abortError();
        f.status = 'error';
        f.error = e.message;
      }
    }
    this.setStep('download', { status: 'done' });
  }

  async createStructure() {
    this.setStep('structure', { status: 'active' });
    if (this.addTo) {
      // Projet existant : on vérifie qu'il est là et on s'assure que RUSHES et IMAGES existent.
      let st = null;
      try {
        st = await fsp.stat(this.dir);
      } catch {}
      if (!st || !st.isDirectory()) throw new Error(`Le projet « ${this.name} » est introuvable : ${this.dir}`);
      for (const key of ['rushes', 'images']) await fsp.mkdir(path.join(this.dir, FOLDERS[key]), { recursive: true });
      this.setStep('structure', { status: 'done', existing: true });
      return;
    }
    if (!this.root) throw new Error('Aucun dossier de projets défini. Choisis-le dans les Réglages.');
    await fsp.mkdir(this.root, { recursive: true });
    if (await exists(this.dir)) {
      const entries = await fsp.readdir(this.dir);
      if (entries.length) throw new Error(`Un dossier « ${this.name} » existe déjà à cet emplacement. Choisis un autre nom de projet.`);
    }
    for (const key of ['rushes', 'images', 'montage', 'musique', 'sfx', 'template']) {
      await fsp.mkdir(path.join(this.dir, FOLDERS[key]), { recursive: true });
    }
    this.setStep('structure', { status: 'done' });
  }

  // Téléchargement direct si le Drive est public, sinon import via le navigateur.
  // Comptes à essayer pour lire un lien : le compte choisi d'abord, puis les autres comptes
  // connectés et l'accès public (un lien peut être partagé avec une autre adresse).
  candidateList() {
    const pool = this.tokenFor || this.accounts.some((a) => a && /^chrome:/.test(a)) ? this.accounts : [];
    const list = this.account ? [this.account, ...pool.filter((a) => a !== this.account)] : pool;
    return list.includes(null) ? list : [...list, null];
  }

  async importDrive() {
    const mode = this.settings.downloadMode || 'auto';
    if (this.sources.length > 1 || (this.sources[0] && this.sources[0].label)) return this.importSources();
    if (mode === 'browser') {
      this.setStep('scan', { status: 'skipped', reason: 'browser' });
      return this.browserImport();
    }
    // Comptes Google connectés d'abord (accès aux Drive privés), puis accès public.
    const candidates = this.candidateList();
    let ok = false;
    let lastErr = null;
    for (const email of candidates) {
      this.checkAbort();
      this.setStep('scan', { status: 'active', account: email, found: 0 });
      try {
        this.drive = this.makeClient(email);
        await this.scan();
        this.state.account = email;
        ok = true;
        break;
      } catch (e) {
        if (e.name === 'AbortError' || this.signal.aborted) throw e;
        if (!lastErr || email === this.account) lastErr = e;
      }
    }
    if (!ok) {
      if (mode === 'direct' || this.account) throw new Error(`Lien Drive inaccessible avec les comptes connectés : ${lastErr.message}`);
      this.setStep('scan', { status: 'skipped', reason: 'private' });
      return this.browserImport();
    }
    await this.downloadAll();
    const files = this.state.files;
    if (mode === 'auto' && !this.account && files.length && files.every((f) => f.status === 'error')) {
      // Fichier privé : on bascule sur le navigateur.
      this.state.files = [];
      this.state.bytesDone = 0;
      this.state.bytesTotal = 0;
      this.state.warnings = this.state.warnings.filter((w) => !/n'ont pas pu être téléchargés/.test(w));
      return this.browserImport();
    }
  }

  // Plusieurs liens nommés : chaque lien est lu (avec le premier compte qui y a accès), ses
  // fichiers sont rangés sous son nom, puis tout est téléchargé d'un coup.
  async importSources() {
    const candidates = this.candidateList();
    this.state.files = [];
    this.setStep('scan', { status: 'active', found: 0 });
    const failures = [];
    for (const src of this.sources) {
      let lastErr = null;
      let done = false;
      for (const email of candidates) {
        this.checkAbort();
        try {
          const client = this.makeClient(email);
          const base = this.state.files.length;
          const res = await client.resolve(src.url, { signal: this.signal, onProgress: (n) => this.setStep('scan', { found: base + n, account: email }) });
          // Dossier vu comme vide : peut-être pas le bon compte, on essaie le suivant.
          if (!res.files.length && !res.skipped.length) {
            lastErr = lastErr || new Error('aucun fichier trouvé dans ce lien');
            continue;
          }
          for (const sk of res.skipped) this.state.warnings.push(`Ignoré : ${sk.name} — ${sk.reason}`);
          for (const f of res.files) {
            const key = this.state.files.length;
            this.state.files.push({
              key,
              id: f.id,
              resourceKey: f.resourceKey || null,
              name: f.name,
              rel: src.label ? [src.label, ...f.rel] : f.rel,
              source: src.label || null,
              category: f.category,
              size: f.size,
              received: 0,
              status: 'queued',
              error: null
            });
            this.clients.set(key, client);
          }
          if (this.state.account == null) this.state.account = email;
          done = true;
          break;
        } catch (e) {
          if (e.name === 'AbortError' || this.signal.aborted) throw e;
          if (!lastErr || email === this.account) lastErr = e;
        }
      }
      if (!done) {
        const why = `Lien « ${src.label || src.url} » : ${lastErr ? lastErr.message : 'erreur inconnue'}`;
        failures.push(why);
        this.state.warnings.push(why);
      }
    }
    this.state.bytesTotal = this.state.files.reduce((a, f) => a + (f.size || 0), 0);
    this.setStep('scan', { status: 'done', found: this.state.files.length });
    if (!this.state.files.length) {
      const tried = candidates.map((c) => (c ? c.replace(/^chrome:/, '') : 'accès public')).join(', ');
      throw new Error(`Aucun fichier récupéré (essayé avec : ${tried}).\n${failures.join('\n')}`);
    }
    await this.downloadAll();
  }

  finishImport() {
    this.finishRequested = true;
  }

  async reopenBrowser() {
    if (this.state.browser) this.state.browser.opener = await openInBrowser(this.driveUrl, this.shell, this.settings.chromeProfile);
  }

  async browserImport() {
    this.state.mode = 'browser';
    this.state.bytesTotal = 0;
    this.setStep('download', { status: 'active' });
    const dir = this.settings.downloadsDir;
    const b = (this.state.browser = { url: this.driveUrl, downloadsDir: dir, opener: null, partials: [], current: null, imported: 0, zips: 0 });
    const watcher = new DownloadWatcher(dir);
    await watcher.init();
    b.opener = await openInBrowser(this.driveUrl, this.shell, this.settings.chromeProfile);
    while (true) {
      this.checkAbort();
      const ready = await watcher.poll();
      b.partials = watcher.partials;
      for (const file of ready) await this.importDownloaded(file);
      if (this.finishRequested && !ready.length) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    b.partials = [];
    b.current = null;
    if (!b.imported) this.state.warnings.push("Aucun fichier n'a été importé depuis le navigateur.");
    this.setStep('download', { status: 'done' });
  }

  addFile(name, rel, size) {
    const f = { key: this.state.files.length, id: null, name, rel, category: categoryOf(name), size, received: 0, status: 'active', error: null };
    this.state.files.push(f);
    return f;
  }

  async importDownloaded(file) {
    const b = this.state.browser;
    if (/\.zip$/i.test(file.name)) {
      b.current = { name: file.name, done: 0, total: 0 };
      let zip;
      try {
        const listing = await listZip(file.path);
        zip = listing.zip;
        b.current.total = listing.files.reduce((a, f) => a + f.size, 0);
        this.state.bytesTotal += b.current.total;
        for (const item of listing.files) {
          this.checkAbort();
          const parts = item.parts.map(sanitizeName);
          const name = parts.pop() || 'sans_nom';
          const f = this.addFile(name, parts, item.size);
          const destDir = path.join(this.dir, CATEGORY_FOLDER[f.category] || FOLDERS.other, ...parts);
          await fsp.mkdir(destDir, { recursive: true });
          const dest = await uniquePath(path.join(destDir, name), this.reserved);
          await extractEntry(
            zip,
            item.entry,
            dest,
            (n) => {
              f.received += n;
              b.current.done += n;
              this.state.bytesDone += n;
            },
            this.signal
          );
          f.status = 'done';
          b.imported++;
        }
        b.zips++;
        zip.close();
        zip = null;
        if (this.settings.deleteZips !== false) await fsp.unlink(file.path).catch(() => {});
      } catch (e) {
        if (zip) zip.close();
        if (e.name === 'AbortError' || this.signal.aborted) throw abortError();
        this.state.warnings.push(`Impossible d'extraire ${file.name} : ${e.message}`);
      }
      b.current = null;
      return;
    }
    // Fichier téléchargé seul : on le déplace directement.
    const f = this.addFile(file.name, [], file.size);
    try {
      const destDir = path.join(this.dir, CATEGORY_FOLDER[f.category] || FOLDERS.other);
      await fsp.mkdir(destDir, { recursive: true });
      const dest = await uniquePath(path.join(destDir, sanitizeName(file.name)), this.reserved);
      await moveFile(file.path, dest);
      f.received = file.size;
      this.state.bytesDone += file.size;
      this.state.bytesTotal += file.size;
      f.status = 'done';
      b.imported++;
    } catch (e) {
      f.status = 'error';
      f.error = e.message;
    }
  }

  async scan() {
    this.setStep('scan', { status: 'active' });
    const res = await this.drive.resolve(this.driveUrl, {
      signal: this.signal,
      onProgress: (n) => this.setStep('scan', { found: n })
    });
    for (const s of res.skipped) this.state.warnings.push(`Ignoré : ${s.name} — ${s.reason}`);
    this.state.files = res.files.map((f, i) => ({
      key: i,
      id: f.id,
      resourceKey: f.resourceKey || null,
      name: f.name,
      rel: f.rel,
      category: f.category,
      size: f.size,
      received: 0,
      status: 'queued',
      error: null
    }));
    this.state.bytesTotal = this.state.files.reduce((a, f) => a + (f.size || 0), 0);
    this.setStep('scan', { status: 'done', found: this.state.files.length });
    if (!this.state.files.length) this.state.warnings.push('Aucun fichier téléchargeable trouvé dans ce lien Drive.');
  }

  async downloadAll() {
    this.setStep('download', { status: 'active' });
    const queue = this.state.files.slice();
    const worker = async () => {
      while (queue.length) {
        this.checkAbort();
        const f = queue.shift();
        await this.downloadWithRetry(f);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) || 1 }, worker));
    this.checkAbort();
    await fsp.rm(path.join(this.dir, TMP_DIR), { recursive: true, force: true }).catch(() => {});
    const failed = this.state.files.filter((f) => f.status === 'error');
    if (failed.length) this.state.warnings.push(`${failed.length} fichier(s) n'ont pas pu être téléchargés.`);
    this.setStep('download', { status: failed.length && failed.length === this.state.files.length ? 'error' : 'done' });
  }

  async downloadWithRetry(f) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.downloadOne(f);
        return;
      } catch (e) {
        if (e.name === 'AbortError' || this.signal.aborted) throw abortError();
        this.state.bytesDone -= f.received;
        f.received = 0;
        if (attempt === 3 || e.fatal) {
          f.status = 'error';
          f.error = e.message;
          return;
        }
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }

  async downloadOne(f) {
    f.status = 'active';
    if (await this.alreadyThere(f)) return;
    const drive = this.clients.get(f.key) || this.drive;
    let res;
    try {
      res = await drive.openDownload(f, this.signal);
    } catch (e) {
      if (e.name === 'AbortError' || this.signal.aborted || !drive.browser) throw e;
      // Drive privé refusé hors de Chrome : Chrome télécharge le fichier lui-même.
      return this.downloadViaChrome(f, drive);
    }
    if (!f.name) {
      f.name = filenameFromDisposition(res.headers.get('content-disposition')) || `fichier_${f.id}`;
      f.category = categoryOf(f.name, res.headers.get('content-type'));
    }
    const len = Number(res.headers.get('content-length')) || null;
    if (len && len !== f.size) {
      this.state.bytesTotal += len - (f.size || 0);
      f.size = len;
    }
    if (await this.alreadyThere(f)) {
      await res.body.cancel().catch(() => {});
      return;
    }
    const folder = CATEGORY_FOLDER[f.category] || FOLDERS.other;
    const destDir = path.join(this.dir, folder, ...f.rel);
    await fsp.mkdir(destDir, { recursive: true });
    const dest = f.dest || (f.dest = await uniquePath(path.join(destDir, sanitizeName(f.name)), this.reserved));
    const part = `${dest}.part`;
    const counter = new Transform({
      transform: (chunk, _enc, cb) => {
        f.received += chunk.length;
        this.state.bytesDone += chunk.length;
        cb(null, chunk);
      }
    });
    try {
      await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part), { signal: this.signal });
      await fsp.rename(part, dest);
    } catch (e) {
      await fsp.rm(part, { force: true }).catch(() => {});
      throw e;
    }
    if (!f.size) {
      f.size = f.received;
      this.state.bytesTotal += f.received;
    }
    f.status = 'done';
  }

  // Ajout à un projet existant : un fichier déjà présent (même nom, même taille) n'est pas
  // retéléchargé. La taille vient du listing, sinon de la réponse du serveur.
  async alreadyThere(f) {
    if (!this.addTo || !f.name || !f.size) return false;
    const file = path.join(this.dir, CATEGORY_FOLDER[f.category] || FOLDERS.other, ...f.rel, sanitizeName(f.name));
    const st = await fsp.stat(file).catch(() => null);
    if (!st || st.size !== f.size) return false;
    f.received = f.size;
    f.skipped = true;
    f.dest = file;
    this.state.bytesDone += f.size;
    f.status = 'done';
    return true;
  }

  async downloadViaChrome(f, drive) {
    const tmp = path.join(this.dir, TMP_DIR);
    let counted = 0;
    const r = await drive.browserDownload(f, tmp, {
      signal: this.signal,
      onProgress: (received, total) => {
        if (total && total !== f.size) {
          this.state.bytesTotal += total - (f.size || 0);
          f.size = total;
        }
        this.state.bytesDone += received - counted;
        f.received = counted = received;
      }
    });
    if (!f.name) {
      f.name = r.name || `fichier_${f.id}`;
      f.category = categoryOf(f.name);
    }
    const destDir = path.join(this.dir, CATEGORY_FOLDER[f.category] || FOLDERS.other, ...f.rel);
    await fsp.mkdir(destDir, { recursive: true });
    const dest = f.dest || (f.dest = await uniquePath(path.join(destDir, sanitizeName(f.name)), this.reserved));
    await fsp.rename(r.path, dest);
    if (!f.size) {
      f.size = r.size || f.received;
      this.state.bytesTotal += f.size;
    }
    f.status = 'done';
  }

  async copyLinks() {
    const links = this.settings.links || {};
    const jobs = [];
    for (const key of ['musique', 'sfx', 'template']) {
      const src = links[key];
      if (!src) continue;
      if (!(await exists(src))) {
        this.state.warnings.push(`Dossier lié introuvable pour ${FOLDERS[key]} : ${src}`);
        continue;
      }
      const files = await listFilesRecursive(src);
      jobs.push({ key, src, files });
    }
    const total = jobs.reduce((a, j) => a + j.files.length, 0);
    if (!jobs.length) {
      this.setStep('links', { status: 'skipped' });
      return;
    }
    this.setStep('links', { status: 'active', total, done: 0 });
    let done = 0;
    for (const job of jobs) {
      const destRoot = path.join(this.dir, FOLDERS[job.key]);
      for (const file of job.files) {
        this.checkAbort();
        const rel = path.relative(job.src, file);
        const dest = path.join(destRoot, rel);
        this.setStep('links', { current: `${FOLDERS[job.key]} · ${rel}` });
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.copyFile(file, dest);
        this.setStep('links', { done: ++done });
      }
    }
    this.setStep('links', { status: 'done', current: '' });
  }

  async createPremiere() {
    this.setStep('premiere', { status: 'active' });
    const tpl = this.settings.premiereTemplate;
    if (!tpl || !(await exists(tpl))) {
      this.state.warnings.push(
        "Aucun projet Premiere modèle configuré : le fichier .prproj n'a pas été créé. Ajoute-le dans Réglages › Premiere Pro."
      );
      this.setStep('premiere', { status: 'skipped' });
      return;
    }
    const dest = path.join(this.dir, FOLDERS.montage, `${this.name}.prproj`);
    await fsp.copyFile(tpl, dest);
    this.setStep('premiere', { status: 'done', file: dest });
  }
}

module.exports = { ProjectJob, FOLDERS };
