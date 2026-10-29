'use strict';
// Mises à jour automatiques via GitHub Releases (electron-updater).
const { app } = require('electron');

let autoUpdater = null;
let state = { status: 'idle', version: app.getVersion(), available: null, percent: 0, error: null, checkedAt: null };
let emit = () => {};

function set(patch) {
  state = { ...state, ...patch };
  emit(state);
}

function init(onChange) {
  emit = onChange;
  if (!app.isPackaged) {
    set({ status: 'dev' });
    return;
  }
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-not-available', () => set({ status: 'latest', checkedAt: Date.now() }));
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', available: info.version, percent: 0, checkedAt: Date.now() }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', available: info.version, percent: 100 }));
  autoUpdater.on('error', (err) => set({ status: 'error', error: friendly(err) }));
  // Au lancement, puis toutes les heures.
  setTimeout(() => check(false), 3000);
  setInterval(() => check(false), 60 * 60 * 1000);
}

function friendly(err) {
  const msg = String((err && err.message) || err || '');
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|net::/i.test(msg)) return 'Pas de connexion Internet.';
  if (/404|Cannot find latest|No published versions/i.test(msg)) return 'Aucune version publiée pour le moment.';
  return msg.split('\n')[0].slice(0, 200);
}

async function check(manual) {
  if (!autoUpdater) return state;
  if (state.status === 'downloading' || state.status === 'ready') return state;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    set({ status: manual ? 'error' : 'idle', error: friendly(e) });
  }
  return state;
}

// Installation silencieuse, puis Coffile se relance tout seul sur la nouvelle version.
function install() {
  if (autoUpdater && state.status === 'ready') autoUpdater.quitAndInstall(true, true);
}

module.exports = { init, check, install, getState: () => state };
