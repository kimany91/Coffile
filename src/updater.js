'use strict';
// Mises à jour automatiques (versions publiées sur GitHub), pareil sur Windows et sur Mac :
// au lancement, Coffile cherche une nouvelle version ; s'il y en a une, il la télécharge, l'installe
// et redémarre dessus, puis affiche la liste des nouveautés. Pendant l'utilisation, une recherche
// toutes les heures prépare la version suivante sans rien interrompre : elle s'installe au
// lancement suivant. Windows : electron-updater (installateur NSIS) ; Mac : mac-updater.js.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

let engine = null;
let state = { status: 'idle', version: app.getVersion(), available: null, percent: 0, error: null, checkedAt: null, launch: false };
let emit = () => {};

function set(patch) {
  state = { ...state, ...patch };
  emit(state);
}

// Journal des mises à jour (dossier de données de Coffile) : utile pour comprendre un souci.
function log(msg) {
  try {
    const file = path.join(app.getPath('userData'), 'mises-a-jour.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 200000) fs.renameSync(file, `${file}.1`);
    fs.appendFileSync(file, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
}

function makeEngine() {
  if (process.platform === 'darwin') {
    const { MacUpdater } = require('./mac-updater');
    const u = new MacUpdater(log);
    return { emitter: u, check: () => u.check(), install: () => u.install(true) };
  }
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Tests : flux de mises à jour local à la place de GitHub.
  if (process.env.COFFILE_UPDATE_FEED) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.COFFILE_UPDATE_FEED });
  return { emitter: autoUpdater, check: () => autoUpdater.checkForUpdates(), install: () => autoUpdater.quitAndInstall(true, true) };
}

function init(onChange) {
  emit = onChange;
  log(`démarrage ${app.getVersion()} (${process.platform} ${process.arch})`);
  if (!app.isPackaged) {
    set({ status: 'dev' });
    return;
  }
  engine = makeEngine();
  const u = engine.emitter;
  u.on('checking-for-update', () => set({ status: 'checking', error: null }));
  u.on('update-not-available', () => {
    if (state.launch) log('à jour');
    set({ status: 'latest', checkedAt: Date.now(), launch: false });
  });
  u.on('update-available', (info) => {
    log(`nouvelle version trouvée : ${info.version}`);
    set({ status: 'downloading', available: info.version, percent: 0, checkedAt: Date.now() });
  });
  u.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent) }));
  u.on('update-downloaded', (info) => {
    set({ status: 'ready', available: info.version, percent: 100 });
    // Trouvée au lancement : installation tout de suite, Coffile redémarre sur la nouvelle version.
    if (state.launch) setTimeout(install, 1200);
  });
  u.on('error', (err) => {
    log(`erreur : ${friendly(err)}`);
    set({ status: 'error', error: friendly(err), launch: false });
  });
  // Au lancement, puis toutes les heures.
  set({ launch: true });
  setTimeout(() => check(false), 1500);
  setInterval(() => check(false), 60 * 60 * 1000);
}

function friendly(err) {
  const msg = String((err && err.message) || err || '');
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|net::|Failed to fetch/i.test(msg)) return 'Pas de connexion Internet.';
  if (/404|Cannot find latest|No published versions/i.test(msg)) return 'Aucune version publiée pour le moment.';
  return msg.split('\n')[0].slice(0, 240);
}

async function check(manual) {
  if (!engine) return state;
  if (state.status === 'downloading' || state.status === 'ready') return state;
  try {
    await engine.check();
  } catch (e) {
    set({ status: manual ? 'error' : 'idle', error: friendly(e), launch: false });
  }
  return state;
}

// Installation silencieuse, puis Coffile se relance tout seul sur la nouvelle version.
function install() {
  if (!engine || state.status !== 'ready') return;
  log(`installation de ${state.available}`);
  set({ status: 'installing' });
  engine.install();
}

module.exports = { init, check, install, getState: () => state };
