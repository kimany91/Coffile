'use strict';
const { app, BrowserWindow, Menu, ipcMain, dialog, shell, net, nativeTheme, safeStorage, protocol, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const { ProjectJob, FOLDERS } = require('./project');
const { DriveClient, parseDriveUrl, sanitizeName } = require('./drive');
const notes = require('./notes');
const understand = require('./understand');
const nlp = require('./nlp');
const { scanLibrary, scanProject, scanExports } = require('./library');
const { GoogleAccounts } = require('./google');
const { openInBrowser, listChromeProfiles } = require('./browser');
const updater = require('./updater');
const mediaServer = require('./mediaserver');
const { renameExports } = require('./rename');
const { InboxClient } = require('./inbox');
const { ChromeSession } = require('./chrome');
const { ChromeInbox } = require('./chrome-inbox');
const { analyze } = require('./detect');
const autoedit = require('./autoedit');
const premiere = require('./premiere');
const transcribe = require('./transcribe');

protocol.registerSchemesAsPrivileged([mediaServer.privileges()]);

// Ancien nom de l'app (FILEDIT) : on reprend son dossier de données (réglages, comptes Google
// chiffrés, miniatures) pour que la mise à jour vers Coffile ne perde rien.
(function migrateFromFiledit() {
  try {
    const appData = app.getPath('appData');
    const oldDir = path.join(appData, 'FILEDIT');
    const newDir = path.join(appData, 'Coffile');
    if (path.resolve(app.getPath('userData')) !== path.resolve(newDir)) return; // --user-data-dir personnalisé
    if (!fs.existsSync(path.join(oldDir, 'settings.json')) || fs.existsSync(path.join(newDir, 'settings.json'))) return;
    try {
      fs.rmSync(newDir, { recursive: true, force: true });
      fs.renameSync(oldDir, newDir);
    } catch {
      app.setPath('userData', oldDir);
    }
  } catch {}
})();

const DEFAULT_SETTINGS = {
  projectsRoot: '',
  premiereTemplate: '',
  apiKey: '',
  links: { musique: '', sfx: '', template: '' },
  recent: [],
  onboarded: false,
  downloadMode: 'auto', // auto | browser | direct
  downloadsDir: '',
  deleteZips: true,
  chromeProfile: '', // dossier de profil Chrome utilisé pour ouvrir Google ('' = profil par défaut)
  defaultAccount: '', // compte Google proposé par défaut ('' = automatique)
  googleClient: { id: '', secret: '' },
  googleAccounts: [],
  projects: {}, // personnalisation par dossier de projet : { color, icon, pinned, pinnedAt }
  inboxHandled: {}, // messages déjà transformés en projet : { [id]: { dir, name, date } }
  inboxMode: 'chrome', // chrome : Chrome piloté par Coffile, sans clé | api : API Gmail / Chat
  chromeAccounts: [], // comptes Google connectés dans le Chrome de Coffile : [{ email, name, u }]
  inboxFilter: { enabled: false, senders: [] }, // filtre « montages » : seuls ces expéditeurs comptent
  inboxDismissed: [], // messages marqués « Pas un montage »
  inboxForced: [], // messages marqués « C'est un montage »
  subtitlePresets: null, // presets de sous-titres AUTOEDIT (null = presets fournis)
  subtitleModel: 'small', // modèle de transcription : base | small | medium
  premiereExe: '', // Adobe Premiere Pro.exe choisi à la main ('' = trouvé tout seul) — AUTOEDIT
  notesDir: '' // dossier des notes (un fichier .txt par feuille) ; '' = Documents/Coffile Notes
};

// Identifiant OAuth intégré à l'app (optionnel) : src/oauth-client.json { "id": "...", "secret": "..." }.
let bundledClient = null;
try {
  bundledClient = require('./oauth-client.json');
} catch {}

let settingsPath;
let settings;
let win;
let currentJob = null;
let inspectController = null;
let google;
let thumbs;

// Dossier des notes (un fichier .txt par feuille, images dans « images »).
function notesDir() {
  return settings.notesDir || path.join(app.getPath('documents'), 'Coffile Notes');
}

let currentAutoEditDir = null; // projet ouvert dans AUTOEDIT (ses fichiers sont lisibles dans l'aperçu)

function isInside(file, dir) {
  if (!dir) return false;
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Chiffrement des jetons Google avec le coffre de Windows (DPAPI).
const vault = {
  encrypt: (str) => (safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(str).toString('base64') : 'raw:' + Buffer.from(str).toString('base64')),
  decrypt: (val) =>
    val.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(val.slice(4), 'base64')) : Buffer.from(val.replace(/^raw:/, ''), 'base64').toString()
};

function effectiveClient() {
  const c = settings.googleClient || {};
  return c.id && c.secret ? c : bundledClient && bundledClient.id ? bundledClient : { id: '', secret: '' };
}

let chrome; // ChromeSession
let chromeInbox;

// Comptes utilisables pour le Drive : comptes OAuth, puis comptes de la session Chrome (« chrome:email »).
function validAccounts() {
  return [...google.list().filter((a) => !a.invalid).map((a) => a.email), ...(settings.chromeAccounts || []).map((a) => `chrome:${a.email}`)];
}

function chromeU(account) {
  const email = String(account).replace(/^chrome:/, '');
  const acc = (settings.chromeAccounts || []).find((a) => a.email === email);
  if (!acc) {
    const e = new Error(`Le compte ${email} n'est plus connecté dans le Chrome de Coffile.`);
    e.code = 'LOGIN';
    throw e;
  }
  return acc.u;
}

// Client Drive pour un compte : OAuth, session Chrome (cookies, sans clé) ou accès public.
function driveClientFor(account) {
  if (account && account.startsWith('chrome:')) {
    return new DriveClient({
      fetch: globalThis.fetch,
      cookieFor: (url) => chrome.cookieHeader(url),
      authuser: chromeU(account),
      // Liste des dossiers et téléchargements de secours faits par Chrome lui-même.
      browser: { fetchText: (url) => chrome.fetchText(url), download: (url, dir, opts) => chrome.download(url, dir, opts) }
    });
  }
  return new DriveClient({ fetch: fetchImpl, apiKey: settings.apiKey, getToken: account ? google.tokenFn(account) : null });
}

// Ordre d'essai en mode automatique : comptes OAuth, accès public, puis session Chrome
// (évite de lancer Chrome pour un lien public).
function autoCandidates() {
  return [...google.list().filter((a) => !a.invalid).map((a) => a.email), null, ...(settings.chromeAccounts || []).map((a) => `chrome:${a.email}`)];
}

async function refreshChromeAccounts() {
  const list = await chrome.listAccounts();
  settings.chromeAccounts = list.map(({ email, name, u }) => ({ email, name, u }));
  saveSettings();
  return settings.chromeAccounts;
}

function loadSettings() {
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    settings = { ...DEFAULT_SETTINGS, ...raw, links: { ...DEFAULT_SETTINGS.links, ...(raw.links || {}) } };
  } catch {
    settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    const videos = app.getPath('videos');
    settings.projectsRoot = path.join(videos, 'Coffile Projets');
  }
  if (!settings.downloadsDir) settings.downloadsDir = app.getPath('downloads');
}

async function runSelftest(out) {
  const { execFile } = require('child_process');
  const tryRun = (exe, args) =>
    new Promise((resolve) => {
      if (!exe) return resolve({ ok: false, error: 'introuvable' });
      execFile(exe, args, { timeout: 20000, windowsHide: true }, (err, stdout, stderr) => {
        const text = `${stdout}${stderr}`;
        resolve({ ok: !!text && !(err && err.code === 'ENOENT'), path: exe, out: text.split('\n').find(Boolean) || '', error: err && err.code === 'ENOENT' ? err.message : undefined });
      });
    });
  const r = {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    ffmpeg: await tryRun(autoedit.ffmpegPath(), ['-hide_banner', '-version']),
    whisper: await tryRun(transcribe.enginePath ? transcribe.enginePath() : null, ['--help']),
    changelog: require('./changelog.json').some((e) => e.version === app.getVersion())
  };
  fs.writeFileSync(out, JSON.stringify(r, null, 1));
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const tmp = `${settingsPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
  fs.renameSync(tmp, settingsPath);
}

const fetchImpl = (url, opts = {}) => net.fetch(url, { ...opts, redirect: 'follow' });

function createWindow() {
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#0a0a0c',
    title: 'Coffile',
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    titleBarStyle: 'hidden',
    // Windows : boutons de la fenêtre dessinés par le système à droite ; Mac : les trois pastilles à gauche.
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 15 } } : { titleBarOverlay: { color: '#0a0a0c', symbolColor: '#a1a1aa', height: 44 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  win.setMenuBarVisibility(false);
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Les liens externes s'ouvrent dans le navigateur.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

// Ce que l'interface peut voir : jamais les jetons ni le secret OAuth.
function publicSettings() {
  const { googleAccounts, googleClient, ...rest } = settings;
  return {
    ...rest,
    googleAccounts: google ? google.list() : [],
    googleClient: { id: (googleClient && googleClient.id) || '', configured: !!effectiveClient().id, bundled: !(googleClient && googleClient.id) && !!(bundledClient && bundledClient.id) },
    folders: FOLDERS,
    version: app.getVersion(),
    platform: process.platform,
    chromeAvailable: !!(chrome && chrome.available)
  };
}

function registerIpc() {
  ipcMain.handle('settings:get', () => publicSettings());

  ipcMain.handle('settings:set', (_e, patch) => {
    const allowed = ['projectsRoot', 'premiereTemplate', 'apiKey', 'onboarded', 'downloadMode', 'downloadsDir', 'deleteZips', 'chromeProfile', 'defaultAccount', 'inboxMode', 'inboxFilter', 'inboxDismissed', 'inboxForced', 'subtitlePresets', 'subtitleModel'];
    for (const k of allowed) if (k in patch) settings[k] = patch[k];
    if (patch.links) settings.links = { ...settings.links, ...patch.links };
    saveSettings();
    return publicSettings();
  });

  ipcMain.handle('recent:remove', (_e, dir) => {
    settings.recent = settings.recent.filter((r) => r.dir !== dir);
    saveSettings();
    return publicSettings();
  });

  ipcMain.handle('dialog:folder', async (_e, { title, defaultPath } = {}) => {
    const r = await dialog.showOpenDialog(win, {
      title: title || 'Choisir un dossier',
      defaultPath: defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory']
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('dialog:prproj', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choisir un projet Premiere Pro vide (modèle)',
      properties: ['openFile'],
      filters: [{ name: 'Projet Premiere Pro', extensions: ['prproj'] }]
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('fs:exists', (_e, p) => !!p && fs.existsSync(p));

  ipcMain.handle('fs:projectExists', (_e, name) => {
    if (!settings.projectsRoot || !name) return false;
    const dir = path.join(settings.projectsRoot, sanitizeName(name));
    try {
      return fs.readdirSync(dir).length > 0;
    } catch {
      return false;
    }
  });

  ipcMain.handle('shell:open', (_e, p) => (p ? shell.openPath(p) : ''));
  // Apprentissage des montages : projets créés (oui) et « Pas un montage » (non).
  const modelFile = path.join(app.getPath('userData'), 'apprentissage-montages.json');
  try {
    understand.setModel(JSON.parse(fs.readFileSync(modelFile, 'utf8')));
  } catch {}
  // Réseau de neurones : sa version personnelle (ce qu'il a appris de tes choix) est dans userData.
  nlp.init(app.getPath('userData'));
  let modelTimer = null;
  const modelStats = () => {
    const m = understand.getModel();
    const n = nlp.stats() || {};
    return { pos: m.pos, neg: m.neg, words: Object.keys(m.tp).length + Object.keys(m.tn).length, nnLearned: n.learned || 0, nnTrainedAt: n.trainedAt || null, nnExamples: n.examples || null };
  };
  ipcMain.handle('inbox:learn', (_e, msg, positive) => {
    understand.learn(msg || {}, !!positive);
    if (msg) nlp.learn(`${msg.subject || ''}\n${understand.mainBody(msg.text || '').main}`, !!positive);
    clearTimeout(modelTimer);
    modelTimer = setTimeout(() => fs.promises.writeFile(modelFile, JSON.stringify(understand.getModel())).catch(() => {}), 800);
    return modelStats();
  });
  ipcMain.handle('inbox:modelStats', () => modelStats());
  ipcMain.handle('inbox:modelReset', () => {
    understand.setModel(null);
    nlp.reset();
    fs.promises.rm(modelFile, { force: true }).catch(() => {});
    return modelStats();
  });
  ipcMain.handle('clipboard:write', (_e, text) => clipboard.writeText(String(text || '')));

  // Notes : une feuille = un fichier .txt dans le dossier des notes.
  ipcMain.handle('notes:list', () => wrap(async () => ({ dir: notesDir(), notes: await notes.list(notesDir()) })));
  ipcMain.handle('notes:read', (_e, name) => wrap(async () => ({ content: await notes.read(notesDir(), name) })));
  ipcMain.handle('notes:save', (_e, name, content) => wrap(() => notes.save(notesDir(), name, content)));
  ipcMain.handle('notes:create', (_e, base) => wrap(async () => ({ name: await notes.create(notesDir(), base) })));
  ipcMain.handle('notes:rename', (_e, from, to) => wrap(async () => ({ name: await notes.rename(notesDir(), from, to) })));
  ipcMain.handle('notes:delete', (_e, name) => wrap(async () => {
    await shell.trashItem(notes.fileOf(notesDir(), name));
    return {};
  }));
  ipcMain.handle('notes:open', () => shell.openPath(notesDir()));
  // /file, /folder, /image : choix sur le PC. Une image est copiée dans le dossier des notes
  // (images/…) pour que la note la garde même si l'original bouge.
  ipcMain.handle('notes:pick', (_e, kind) =>
    wrap(async () => {
      const opts = {
        file: { title: 'Lier un fichier', properties: ['openFile'] },
        folder: { title: 'Lier un dossier', properties: ['openDirectory'] },
        image: { title: 'Ajouter une image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'] }] }
      }[kind];
      if (!opts) throw new Error('Commande inconnue.');
      const r = await dialog.showOpenDialog(win, opts);
      if (r.canceled || !r.filePaths[0]) return { canceled: true };
      const src = r.filePaths[0];
      if (kind !== 'image') return { path: src, name: path.basename(src) };
      const dir = path.join(notesDir(), 'images');
      await fs.promises.mkdir(dir, { recursive: true });
      const ext = path.extname(src).toLowerCase();
      const name = `${Date.now().toString(36)}-${sanitizeName(path.basename(src, path.extname(src))).slice(0, 60)}${ext}`;
      await fs.promises.copyFile(src, path.join(dir, name));
      return { rel: `images/${name}`, path: path.join(dir, name), name: path.basename(src) };
    })
  );
  ipcMain.handle('notes:exists', (_e, paths) => (paths || []).map((p) => !!p && fs.existsSync(p)));
  ipcMain.handle('notes:chooseDir', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Dossier des notes', defaultPath: notesDir(), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled) return { ok: false };
    settings.notesDir = r.filePaths[0];
    saveSettings();
    return { ok: true, dir: settings.notesDir };
  });
  ipcMain.handle('shell:reveal', (_e, p) => p && shell.showItemInFolder(p));
  ipcMain.handle('shell:external', (_e, url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });

  ipcMain.handle('library:scan', () => scanLibrary(settings.projectsRoot));

  // Personnalisation d'un projet (icône, couleur, épingle).
  ipcMain.handle('project:meta', (_e, dir, patch) => {
    const cur = settings.projects[dir] || {};
    const next = { ...cur };
    if ('color' in patch) next.color = String(patch.color || '');
    if ('icon' in patch) next.icon = String(patch.icon || '');
    if ('renameTitle' in patch) next.renameTitle = String(patch.renameTitle || '');
    if ('pinned' in patch) {
      next.pinned = !!patch.pinned;
      next.pinnedAt = patch.pinned ? Date.now() : 0;
    }
    settings.projects = { ...settings.projects, [dir]: next };
    saveSettings();
    return publicSettings();
  });

  ipcMain.handle('thumb:lookup', (_e, items) => thumbs.lookup(items));
  ipcMain.handle('thumb:save', (_e, key, bytes) => thumbs.save(key, bytes));
  ipcMain.handle('library:project', (_e, dir) => scanProject(dir).catch(() => null));
  ipcMain.handle('exports:scan', () => scanExports(settings.projectsRoot));
  ipcMain.handle('exports:rename', (_e, ops) => renameExports(ops, (f) => isInside(f, settings.projectsRoot)));

  ipcMain.handle('chrome:profiles', () => listChromeProfiles());

  ipcMain.handle('google:setClient', (_e, { id, secret }) => {
    settings.googleClient = { id: (id || '').trim(), secret: (secret || '').trim() };
    saveSettings();
    return publicSettings();
  });
  ipcMain.handle('google:connect', async () => {
    try {
      const acc = await google.connect({ profile: settings.chromeProfile });
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
      return { ok: true, account: acc, settings: publicSettings() };
    } catch (e) {
      return { ok: false, cancelled: e.name === 'AbortError', error: e.message, settings: publicSettings() };
    }
  });
  ipcMain.handle('google:cancel', () => google.cancelLogin());

  // Autorise l'accès à Gmail ou Google Chat pour un compte déjà connecté.
  ipcMain.handle('google:authorize', async (_e, email, feature) => {
    try {
      const acc = google.list().find((a) => a.email === email);
      const features = [feature, ...Object.entries((acc && acc.features) || {}).filter(([, v]) => v).map(([k]) => k)];
      const res = await google.connect({ profile: settings.chromeProfile, features: [...new Set(features)], loginHint: email });
      if (win && !win.isDestroyed()) win.focus();
      const after = google.list().find((a) => a.email === res.email);
      if (!after || !after.features[feature]) return { ok: false, error: "L'accès n'a pas été accordé (case non cochée sur la page Google ?).", settings: publicSettings() };
      return { ok: true, account: res, settings: publicSettings() };
    } catch (e) {
      return { ok: false, cancelled: e.name === 'AbortError', error: e.message, settings: publicSettings() };
    }
  });

  // ---------- Messagerie (Gmail / Google Chat) ----------
  const inbox = (email) => new InboxClient({ fetch: fetchImpl, getToken: google.tokenFn(email) });
  const wrap = async (fn) => {
    try {
      return { ok: true, ...(await fn()) };
    } catch (e) {
      // Message lisible : sans le journal technique ni les codes couleur de Playwright.
      const msg = String(e.message || e).split(/\n\s*Call log:|Call log:/)[0].replace(/\u001b\[\d+m/g, '').trim();
      return { ok: false, code: e.code || 'OTHER', error: msg };
    }
  };
  // La liste n'embarque pas le HTML des mails (chargé à l'ouverture d'un mail).
  const light = (m) => ({ ...m, html: undefined, text: (m.text || '').slice(0, 6000) });
  // Comptes « chrome:email » : lecture dans le Chrome piloté par Coffile ; sinon API Google.
  const viaChrome = (account) => String(account || '').startsWith('chrome:');
  ipcMain.handle('inbox:mail', (_e, email, opts = {}) => wrap(async () => {
    const r = viaChrome(email)
      ? await chromeInbox.listMail({ u: chromeU(email), q: /^in:inbox$/.test(opts.q || '') ? '' : opts.q, page: Number(opts.pageToken) || 1, force: !!opts.force })
      : await inbox(email).listMail(opts);
    return { messages: r.messages.map(light), pending: r.pending || [], nextPageToken: r.nextPageToken };
  }));
  // Analyse complète des mails listés sans leur contenu (mode Chrome) : [{ id, text, analysis }].
  ipcMain.handle('inbox:mailBodies', (_e, email, items) =>
    wrap(async () => {
      const got = await chromeInbox.bodiesFor({ u: chromeU(email), items });
      const by = new Map(items.map((it) => [it.id, it]));
      return {
        bodies: got
          .filter((b) => !b.missing)
          .map((b) => {
            const it = by.get(b.id) || {};
            return { id: b.id, text: b.text, analysis: analyze({ subject: it.subject || '', text: b.text, html: b.html, sender: it.sender || '', senderEmail: it.senderEmail || '', date: it.date || null }) };
          })
      };
    })
  );
  ipcMain.handle('inbox:mailGet', (_e, email, id, threadId, meta = {}) =>
    wrap(async () => ({ message: viaChrome(email) ? await chromeInbox.getMail({ u: chromeU(email), id, threadId, ...meta }) : await inbox(email).getMail(id) }))
  );
  ipcMain.handle('inbox:spaces', (_e, email, opts = {}) =>
    wrap(async () => ({ spaces: viaChrome(email) ? await chromeInbox.listSpaces({ u: chromeU(email), force: !!opts.force }) : await inbox(email).listSpaces() }))
  );
  // Diagnostic anonyme de la page Chat, enregistré dans Téléchargements puis affiché.
  ipcMain.handle('inbox:chatDiagnostic', (_e, email, space) =>
    wrap(async () => {
      const data = await chromeInbox.chatDiagnostic({ u: chromeU(email), space });
      const file = path.join(app.getPath('downloads'), `coffile-diagnostic-chat-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
      shell.showItemInFolder(file);
      return { file };
    })
  );
  ipcMain.handle('inbox:chat', (_e, email, space, opts) => wrap(() => (viaChrome(email) ? chromeInbox.listChat({ u: chromeU(email), space }) : inbox(email).listChat(space, opts))));

  // ---------- Chrome piloté par Coffile ----------
  ipcMain.handle('chrome:login', (_e, add) =>
    wrap(async () => {
      const before = new Set((settings.chromeAccounts || []).map((a) => a.email));
      await chrome.login({ add: !!add });
      const list = await refreshChromeAccounts();
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
      return { accounts: list, added: list.filter((a) => !before.has(a.email)).map((a) => a.email), settings: publicSettings() };
    })
  );
  ipcMain.handle('chrome:refresh', () => wrap(async () => ({ accounts: await refreshChromeAccounts(), settings: publicSettings() })));
  ipcMain.handle('chrome:show', () => wrap(() => chrome.show().then(() => ({}))));
  ipcMain.handle('chrome:hide', () => wrap(() => chrome.hide().then(() => ({}))));
  // Remet le Chrome de Coffile à zéro (ferme Chrome, efface son profil et les comptes mémorisés).
  ipcMain.handle('chrome:reset', () =>
    wrap(async () => {
      await chrome.stop();
      chrome.accounts = [];
      await new Promise((r) => setTimeout(r, 800));
      fs.rmSync(chrome.profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      settings.chromeAccounts = [];
      saveSettings();
      return { settings: publicSettings() };
    })
  );
  ipcMain.handle('google:remove', (_e, email) => {
    google.remove(email);
    if (settings.defaultAccount === email) settings.defaultAccount = '';
    saveSettings();
    return publicSettings();
  });

  // Analyse rapide d'un lien pour l'aperçu (nombre de vidéos / images).
  ipcMain.handle('drive:inspect', async (_e, url, account = '') => {
    if (inspectController) inspectController.abort();
    const parsed = parseDriveUrl(url);
    if (!parsed) return { ok: false, error: 'Lien Google Drive invalide' };
    if (parsed.kind === 'native') return { ok: false, error: 'Ce lien pointe vers un document Google Docs/Sheets/Slides, pas vers un dossier.' };
    if (settings.downloadMode === 'browser') return { ok: true, mode: 'browser', reason: 'setting' };
    const controller = (inspectController = new AbortController());
    const timeout = setTimeout(() => controller.abort(), 45000);
    // Compte choisi d'abord, puis les autres comptes connectés et l'accès public.
    const candidates = account ? [account, ...autoCandidates().filter((c) => c !== account)] : autoCandidates();
    let res = null;
    let used = null;
    let lastErr = null;
    try {
      for (const email of candidates) {
        try {
          const client = driveClientFor(email);
          res = await client.resolve(url, { signal: controller.signal });
          if (!res.files.length && !res.skipped.length && email !== candidates[candidates.length - 1]) {
            res = null;
            continue;
          }
          used = email;
          break;
        } catch (e) {
          if (controller.signal.aborted) throw e;
          lastErr = e;
        }
      }
      if (!res) throw lastErr;
      const count = (c) => res.files.filter((f) => f.category === c).length;
      const sizes = res.files.map((f) => f.size).filter(Boolean);
      return {
        ok: true,
        mode: used ? 'account' : 'direct',
        account: used,
        kind: res.kind,
        title: res.title,
        total: res.files.length,
        videos: count('video'),
        images: count('image'),
        audio: count('audio'),
        others: count('other') + count('unknown'),
        skipped: res.skipped.length,
        bytes: sizes.length === res.files.length ? sizes.reduce((a, b) => a + b, 0) : null
      };
    } catch (e) {
      if (controller.signal.aborted) return { ok: false, aborted: true, error: 'Analyse interrompue' };
      // Drive privé ou illisible : import via le navigateur (connecté au compte Google).
      if (account) return { ok: false, error: `${account} n'a pas accès à ce lien (${e.message}).` };
      if (settings.downloadMode !== 'direct') return { ok: true, mode: 'browser', reason: 'private', detail: e.message, hasAccounts: validAccounts().length > 0 };
      return { ok: false, error: e.message || String(e) };
    } finally {
      clearTimeout(timeout);
    }
  });

  ipcMain.handle('project:create', async (_e, { name, driveUrl, sources = null, account = '', source = null, addTo = null, localDir = null, localMode = 'copy' }) => {
    if (currentJob) return { ok: false, error: 'Un projet est déjà en cours de création.' };
    const job = new ProjectJob({
      name,
      driveUrl,
      sources,
      addTo,
      localDir,
      localMode,
      root: settings.projectsRoot,
      settings: JSON.parse(JSON.stringify(settings)),
      fetch: fetchImpl,
      shell,
      account,
      accounts: autoCandidates(),
      tokenFor: (email) => google.tokenFn(email),
      makeClient: (email) => driveClientFor(email),
      emit: (state) => win && !win.isDestroyed() && win.webContents.send('job:update', state)
    });
    currentJob = job;
    win.setProgressBar(2, { mode: 'indeterminate' });
    const progressTimer = setInterval(() => {
      const s = job.state;
      if (s.bytesTotal > 0) win.setProgressBar(Math.min(1, s.bytesDone / s.bytesTotal));
    }, 1000);
    const state = await job.run();
    clearInterval(progressTimer);
    currentJob = null;
    if (!win.isDestroyed()) {
      win.setProgressBar(-1);
      if (state.status === 'done' && !win.isFocused()) win.flashFrame(true);
    }
    if (state.status === 'done') {
      settings.recent = [
        { name: state.name, dir: state.dir, date: new Date().toISOString(), driveUrl: driveUrl || '', localDir: localDir || '', account: state.account || '', ...state.result },
        ...settings.recent.filter((r) => r.dir !== state.dir)
      ].slice(0, 50);
      // Projet lancé depuis un mail ou un message Chat : on s'en souvient pour l'afficher.
      if (source && source.id) settings.inboxHandled = { ...settings.inboxHandled, [source.id]: { dir: state.dir, name: state.name, date: Date.now() } };
      saveSettings();
    }
    return { ok: state.status === 'done', state };
  });

  ipcMain.handle('project:cancel', () => {
    if (currentJob) currentJob.cancel();
    return true;
  });
  ipcMain.handle('project:finishImport', () => {
    if (currentJob) currentJob.finishImport();
    return true;
  });
  ipcMain.handle('project:reopenBrowser', () => currentJob && currentJob.reopenBrowser());

  ipcMain.handle('update:check', () => updater.check(true));
  // Nouveautés à montrer après une mise à jour : les versions installées depuis la dernière ouverture.
  ipcMain.handle('app:whatsNew', () => {
    const semver = require('./version');
    const cur = app.getVersion();
    const last = settings.lastVersion;
    let entries = [];
    try {
      const all = require('./changelog.json');
      if (last && semver.valid(last) && semver.gt(cur, last)) entries = all.filter((e) => semver.gt(e.version, last) && semver.lte(e.version, cur));
      // Mise à jour depuis une version qui ne notait pas encore sa version : celle-ci seulement.
      else if (!last && settings.onboarded) entries = all.filter((e) => e.version === cur);
    } catch {}
    if (last !== cur) {
      settings.lastVersion = cur;
      saveSettings();
    }
    return { version: cur, entries };
  });
  ipcMain.handle('update:state', () => updater.getState());
  ipcMain.handle('update:install', () => {
    if (currentJob) return false;
    updater.install();
    return true;
  });

  // Onglet AUTOEDIT : ce que contient un dossier du PC (avant d'en faire un projet).
  ipcMain.handle('local:inspect', async (_e, dir) => {
    try {
      const st = await fs.promises.stat(dir);
      if (!st.isDirectory()) return { ok: false, error: "Ce n'est pas un dossier." };
      const { categoryOf } = require('./drive');
      const out = { ok: true, dir, name: path.basename(dir), videos: 0, images: 0, audio: 0, others: 0, bytes: 0, files: 0, sample: [], inProjects: isInside(dir, settings.projectsRoot) };
      const walk = async (d, depth) => {
        for (const e of await fs.promises.readdir(d, { withFileTypes: true })) {
          if (e.name.startsWith('.') || out.files > 20000) continue;
          const full = path.join(d, e.name);
          if (e.isDirectory()) {
            if (depth < 10) await walk(full, depth + 1);
          } else if (e.isFile() && !/^(thumbs\.db|desktop\.ini)$/i.test(e.name)) {
            const c = categoryOf(e.name);
            out[c === 'video' ? 'videos' : c === 'image' ? 'images' : c === 'audio' ? 'audio' : 'others']++;
            out.files++;
            out.bytes += (await fs.promises.stat(full)).size;
            if (c === 'video' && out.sample.length < 8) out.sample.push(path.relative(dir, full));
          }
        }
      };
      await walk(dir, 0);
      return out;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ---------- AUTOEDIT ----------
  let aeAbort = null;
  const aeSend = (msg) => win && !win.isDestroyed() && win.webContents.send('autoedit:progress', msg);
  const sfxLibrary = () => (settings.links && settings.links.sfx) || '';
  ipcMain.handle('autoedit:open', async (_e, dir) => {
    try {
      if (!dir || !fs.existsSync(dir)) return { ok: false, error: 'Dossier du projet introuvable.' };
      currentAutoEditDir = dir;
      const [media, saved] = await Promise.all([autoedit.listMedia(dir, sfxLibrary()), autoedit.loadState(dir)]);
      return { ok: true, media, saved, sfxLibrary: sfxLibrary() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  // Infos et volume de chaque rush (2 à la fois) ; chaque résultat est envoyé dès qu'il est prêt.
  ipcMain.handle('autoedit:analyze', async (_e, files) => {
    if (aeAbort) aeAbort.abort();
    const ctrl = new AbortController();
    aeAbort = ctrl;
    const queue = [...files];
    const worker = async () => {
      while (queue.length && !ctrl.signal.aborted) {
        const file = queue.shift();
        try {
          const probe = await autoedit.probe(file);
          aeSend({ path: file, probe });
          const env = probe.hasAudio
            ? await autoedit.envelope(file, { duration: probe.duration, signal: ctrl.signal, onProgress: (p) => aeSend({ path: file, progress: p }) })
            : { rate: autoedit.ENV_RATE, db: [], noAudio: true };
          aeSend({ path: file, env });
        } catch (e) {
          if (!ctrl.signal.aborted) aeSend({ path: file, error: e.message });
        }
      }
    };
    await Promise.all([worker(), worker()]);
    if (aeAbort === ctrl) aeAbort = null;
    return { ok: !ctrl.signal.aborted };
  });
  ipcMain.handle('autoedit:cancel', () => {
    if (aeAbort) aeAbort.abort();
    aeAbort = null;
  });
  ipcMain.handle('autoedit:proxy', async (_e, file, duration) => {
    try {
      const out = await autoedit.proxy(file, { duration, onProgress: (p) => aeSend({ path: file, proxyProgress: p }) });
      return { ok: true, path: out };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  // Vignettes des vidéos : deux à la fois, les autres attendent leur tour.
  const thumbQueue = [];
  let thumbRunning = 0;
  const nextThumb = () => {
    while (thumbRunning < 2 && thumbQueue.length) {
      const { file, resolve } = thumbQueue.shift();
      thumbRunning++;
      autoedit
        .thumbnail(file)
        .then((out) => resolve({ ok: true, path: out }), (e) => resolve({ ok: false, error: e.message }))
        .finally(() => {
          thumbRunning--;
          nextThumb();
        });
    }
  };
  ipcMain.handle('autoedit:thumb', (_e, file) =>
    new Promise((resolve) => {
      thumbQueue.push({ file, resolve });
      nextThumb();
    })
  );
  ipcMain.handle('autoedit:save', async (_e, dir, data) => {
    try {
      await autoedit.saveState(dir, data);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('autoedit:sfxDir', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Dossier de tes sound effects', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    settings.links = { ...(settings.links || {}), sfx: r.filePaths[0] };
    saveSettings();
    return { ok: true, dir: r.filePaths[0] };
  });
  // Valider : séquence écrite, extension Coffile installée dans Premiere, montage déposé pour elle,
  // et Premiere ouvert sur le projet s'il ne tourne pas déjà avec l'extension.
  ipcMain.handle('autoedit:export', async (_e, payload) => {
    try {
      const res = await autoedit.exportEdit(payload);
      const inst = await premiere.install().catch((e) => ({ ok: false, error: e.message }));
      premiere.sendJob(res.job);
      const alive = premiere.alive();
      let running = false;
      let launched = null;
      if (!alive) {
        running = await premiere.isRunning();
        if (!running) launched = premiere.launch(res.job.projectPath, settings.premiereExe, shell);
      }
      return { ok: true, file: res.file, srt: res.srtPath, jobId: res.job.id, project: res.job.projectPath, alive, running, launched: !!(launched && launched.ok), noPremiere: !!(launched && !launched.ok), installed: inst.ok, fresh: !!inst.fresh };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  // ---------- Sous-titres automatiques (Whisper, hors ligne) ----------
  let subsAbort = null;
  ipcMain.handle('subs:status', () => transcribe.status());
  ipcMain.handle('subs:download', async (_e, model) => {
    try {
      await transcribe.downloadModel(model, (p) => aeSend({ subs: 'download', model, progress: p }));
      return { ok: true, status: transcribe.status() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  // Transcrit les rushes un par un ; chaque résultat est envoyé dès qu'il est prêt.
  ipcMain.handle('subs:transcribe', async (_e, files, opts) => {
    if (subsAbort) subsAbort.abort();
    const ctrl = new AbortController();
    subsAbort = ctrl;
    for (const file of files) {
      if (ctrl.signal.aborted) break;
      try {
        const res = await transcribe.transcribe(file, { ...opts, signal: ctrl.signal, onProgress: (p) => aeSend({ path: file, subsProgress: p }) });
        aeSend({ path: file, words: res.words, noAudio: !!res.noAudio });
      } catch (e) {
        if (!ctrl.signal.aborted) aeSend({ path: file, subsError: e.message });
      }
    }
    if (subsAbort === ctrl) subsAbort = null;
    return { ok: !ctrl.signal.aborted };
  });
  ipcMain.handle('subs:cancel', () => {
    if (subsAbort) subsAbort.abort();
    subsAbort = null;
  });
  ipcMain.handle('autoedit:jobState', async (_e, id, checkRunning) => {
    const st = premiere.jobState(id);
    if (checkRunning && st.state === 'waiting' && !st.alive) st.running = await premiere.isRunning();
    return st;
  });
  // Ouvre Premiere sur le projet (si le montage attend et que Premiere est fermé).
  ipcMain.handle('autoedit:launchPremiere', (_e, prproj) => premiere.launch(prproj, settings.premiereExe, shell).ok);
  ipcMain.handle('autoedit:saveSubs', async (_e, dir, images) => {
    try {
      const out = path.join(dir, FOLDERS.montage, 'AUTOEDIT sous-titres');
      await fs.promises.rm(out, { recursive: true, force: true });
      await fs.promises.mkdir(out, { recursive: true });
      const saved = [];
      for (const im of images) {
        const file = path.join(out, im.name);
        await fs.promises.writeFile(file, Buffer.from(im.bytes));
        saved.push({ path: file, name: im.name, start: im.start, duration: im.duration });
      }
      return { ok: true, images: saved };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  // Premiere installé ailleurs que dans Program Files : choisi une fois, retenu dans les réglages.
  ipcMain.handle('autoedit:pickPremiere', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Où est Adobe Premiere Pro ?',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Adobe Premiere Pro', extensions: ['exe'] }] : []
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    settings.premiereExe = r.filePaths[0];
    saveSettings();
    return { ok: true };
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.setAppUserModelId('fr.filedit.app');
  app.whenReady().then(() => {
    // Contrôle de l'app construite (workflow GitHub) : les outils inclus se lancent, puis on quitte.
    const selftest = process.argv.find((a) => a.startsWith('--coffile-selftest='));
    if (selftest) {
      runSelftest(selftest.slice('--coffile-selftest='.length)).finally(() => app.exit(0));
      return;
    }
    // Mac : menu de l'app (Copier / Coller, Cmd+Q, fenêtre) ; Windows n'en a pas.
    if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
    loadSettings();
    thumbs = new mediaServer.ThumbCache(path.join(app.getPath('userData'), 'thumbs'));
    autoedit.init(path.join(app.getPath('userData'), 'autoedit'));
    // Extension Coffile pour Premiere : installée (ou mise à jour) à chaque démarrage, sans attendre.
    premiere.init(app.getPath('userData'));
    transcribe.init(app.getPath('userData'), fetchImpl);
    premiere.install().catch(() => {});
    mediaServer.register(
      protocol,
      (file) =>
        isInside(file, settings.projectsRoot) ||
        isInside(file, thumbs.dir) ||
        isInside(file, path.join(notesDir(), 'images')) ||
        isInside(file, path.join(app.getPath('userData'), 'autoedit')) ||
        isInside(file, (settings.links && settings.links.sfx) || '') ||
        (currentAutoEditDir && isInside(file, currentAutoEditDir))
    );
    google = new GoogleAccounts({
      store: {
        client: effectiveClient,
        accounts: () => settings.googleAccounts || [],
        setAccounts: (list) => (settings.googleAccounts = list),
        save: saveSettings
      },
      fetch: fetchImpl,
      vault,
      openUrl: (url, profile) => openInBrowser(url, shell, profile)
    });
    chrome = new ChromeSession({ profileDir: path.join(app.getPath('userData'), 'chrome-profile') });
    chromeInbox = new ChromeInbox({ session: chrome });
    registerIpc();
    createWindow();
    updater.init((state) => win && !win.isDestroyed() && win.webContents.send('update:status', state));
  });
  app.on('window-all-closed', () => app.quit());
  // Ferme le Chrome de Coffile avec l'app : on attend qu'il soit vraiment fermé (2,5 s au plus),
  // sinon il resterait ouvert en arrière-plan avec ses onglets.
  let quitting = false;
  app.on('will-quit', (e) => {
    if (quitting || !chrome || !(chrome.running || chrome.proc)) return;
    e.preventDefault();
    quitting = true;
    Promise.race([chrome.stop(), new Promise((r) => setTimeout(r, 2500))]).finally(() => app.exit(0));
  });
}
