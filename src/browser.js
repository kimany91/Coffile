'use strict';
// Import via le navigateur : pour les Drive privés, Coffile ouvre le lien dans Chrome
// (déjà connecté au compte Google), surveille le dossier Téléchargements, puis
// extrait les .zip de Google Drive et range les fichiers.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const yauzl = require('yauzl');

const PARTIAL_RE = /\.(crdownload|part|partial|download|tmp|opdownload)$/i;
const IGNORE_RE = /^(desktop\.ini|thumbs\.db|\.ds_store)$|^~\$|^\./i;

function findChrome() {
  if (process.platform !== 'win32') return null;
  const bases = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  for (const b of bases) {
    const p = path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Profils Chrome (sessions Google) lus depuis « Local State ».
function listChromeProfiles() {
  const base = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Local State');
  if (!base || !fs.existsSync(base)) return [];
  try {
    const cache = JSON.parse(fs.readFileSync(base, 'utf8')).profile.info_cache || {};
    return Object.entries(cache)
      .map(([dir, p]) => ({ dir, name: p.name || dir, email: p.user_name || '', gaiaName: p.gaia_name || '' }))
      .sort((a, b) => (a.dir === 'Default' ? -1 : b.dir === 'Default' ? 1 : a.name.localeCompare(b.name)));
  } catch {
    return [];
  }
}

// Ouvre l'URL dans Chrome (avec le profil choisi) si installé, sinon dans le navigateur par défaut.
async function openInBrowser(url, shell, profile) {
  const chrome = findChrome();
  if (chrome) {
    try {
      const args = profile ? [`--profile-directory=${profile}`, url] : [url];
      const child = spawn(chrome, args, { detached: true, stdio: 'ignore' });
      child.unref();
      return 'Chrome';
    } catch {}
  }
  await shell.openExternal(url);
  return 'navigateur';
}

// Surveille un dossier et signale chaque nouveau fichier complet (taille stable).
class DownloadWatcher {
  constructor(dir) {
    this.dir = dir;
    this.known = new Set();
    this.pending = new Map(); // nom -> { size, stable }
    this.partials = [];
  }

  async init() {
    await fsp.mkdir(this.dir, { recursive: true });
    for (const name of await fsp.readdir(this.dir)) this.known.add(name);
  }

  // Retourne la liste des fichiers terminés depuis le dernier appel.
  async poll() {
    const ready = [];
    const partials = [];
    let names;
    try {
      names = await fsp.readdir(this.dir);
    } catch {
      return ready;
    }
    for (const name of names) {
      if (this.known.has(name) || IGNORE_RE.test(name)) continue;
      const full = path.join(this.dir, name);
      let st;
      try {
        st = await fsp.stat(full);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      if (PARTIAL_RE.test(name)) {
        partials.push({ name: name.replace(PARTIAL_RE, ''), size: st.size });
        continue;
      }
      const prev = this.pending.get(name);
      if (prev && prev.size === st.size) prev.stable++;
      else this.pending.set(name, { size: st.size, stable: 0 });
      const cur = this.pending.get(name);
      if (cur.stable >= 1 && (await isReadable(full))) {
        this.known.add(name);
        this.pending.delete(name);
        ready.push({ name, path: full, size: st.size });
      }
    }
    this.partials = partials;
    return ready;
  }
}

async function isReadable(p) {
  try {
    const fh = await fsp.open(p, 'r');
    await fh.close();
    return true;
  } catch {
    return false;
  }
}

const openZip = (p) =>
  new Promise((resolve, reject) =>
    yauzl.open(p, { lazyEntries: true, autoClose: false, decodeStrings: false }, (err, zip) => (err ? reject(err) : resolve(zip)))
  );

function readEntries(zip) {
  return new Promise((resolve, reject) => {
    const entries = [];
    zip.on('entry', (e) => {
      entries.push(e);
      zip.readEntry();
    });
    zip.on('end', () => resolve(entries));
    zip.on('error', reject);
    zip.readEntry();
  });
}

const openEntryStream = (zip, entry) =>
  new Promise((resolve, reject) => zip.openReadStream(entry, (err, s) => (err ? reject(err) : resolve(s))));

// Liste les fichiers d'un zip, en retirant le dossier racine commun
// (Google Drive met souvent tout dans « NomDuDossier/ »).
async function listZip(zipPath) {
  const zip = await openZip(zipPath);
  // Noms décodés sans validation stricte (un nom invalide ne doit pas bloquer tout le zip) ;
  // les segments « . » et « .. » sont retirés pour rester dans le dossier du projet.
  const entries = [];
  const split = [];
  for (const e of await readEntries(zip)) {
    const name = yauzl.getFileNameLowLevel(e.generalPurposeBitFlag, e.fileName, e.extraFields, false);
    if (/\/$/.test(name)) continue;
    const parts = name.split(/[\\/]+/).filter((x) => x && x !== '.' && x !== '..');
    if (!parts.length) continue;
    entries.push(e);
    split.push(parts);
  }
  const first = split.length && split[0].length > 1 ? split[0][0] : null;
  const strip = first && split.every((s) => s.length > 1 && s[0] === first);
  const files = entries.map((e, i) => ({
    entry: e,
    parts: strip ? split[i].slice(1) : split[i],
    size: e.uncompressedSize
  }));
  return { zip, files };
}

async function extractEntry(zip, entry, dest, onBytes, signal) {
  const stream = await openEntryStream(zip, entry);
  const counter = new Transform({
    transform(chunk, _e, cb) {
      onBytes(chunk.length);
      cb(null, chunk);
    }
  });
  const part = `${dest}.part`;
  try {
    await pipeline(stream, counter, fs.createWriteStream(part), { signal });
    await fsp.rename(part, dest);
  } catch (e) {
    await fsp.rm(part, { force: true }).catch(() => {});
    throw e;
  }
}

async function moveFile(src, dest) {
  try {
    await fsp.rename(src, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fsp.copyFile(src, dest);
    await fsp.unlink(src);
  }
}

module.exports = { openInBrowser, listChromeProfiles, DownloadWatcher, listZip, extractEntry, moveFile, findChrome };
