'use strict';
// Mises à jour sur Mac. Le système standard (Squirrel.Mac) n'accepte que les apps signées avec un
// compte développeur Apple payant : Coffile fait donc lui-même la même chose. Il lit
// latest-mac.yml dans la dernière version publiée sur GitHub, télécharge le .zip de son processeur
// (Apple Silicon ou Intel), vérifie son empreinte SHA-512, le décompresse, puis un petit script
// remplace Coffile.app une fois Coffile fermé et le relance.
const { app, net } = require('electron');
const { EventEmitter } = require('events');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const version = require('./version');

const FEED = (process.env.COFFILE_UPDATE_FEED || 'https://github.com/kimany91/Coffile/releases/latest/download').replace(/\/+$/, '');

const run = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().split('\n').pop())) : resolve(stdout)))
  );

// Remplace l'app quand Coffile est fermé (attend la fin du processus), puis la relance si demandé.
const SCRIPT = `#!/bin/bash
PID="$1"; OLD="$2"; NEW="$3"; RELAUNCH="$4"; LOG="$5"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
for i in $(seq 1 600); do kill -0 "$PID" 2>/dev/null || break; sleep 0.1; done
BAK="\${OLD%.app}.ancien-$$.app"
if mv "$OLD" "$BAK"; then
  if mv "$NEW" "$OLD"; then
    rm -rf "$BAK"
    log "remplacé : $OLD"
  else
    mv "$BAK" "$OLD"
    log "échec : impossible de mettre la nouvelle version en place"
  fi
else
  log "échec : impossible de déplacer $OLD"
fi
xattr -dr com.apple.quarantine "$OLD" 2>/dev/null
if [ "$RELAUNCH" = "1" ]; then open "$OLD" && log "relancé"; fi
exit 0
`;

class MacUpdater extends EventEmitter {
  constructor(log) {
    super();
    this.log = log || (() => {});
    this.ready = null; // { version, app } : nouvelle version décompressée, prête à remplacer l'ancienne
    this.busy = null;
  }

  dir() {
    return path.join(app.getPath('userData'), 'mises-a-jour');
  }

  // Coffile.app en cours d'utilisation (…/Coffile.app/Contents/MacOS/Coffile).
  currentApp() {
    return path.resolve(path.dirname(process.execPath), '..', '..');
  }

  // L'app peut-elle être remplacée là où elle est ?
  installable() {
    const cur = this.currentApp();
    if (!/\.app$/.test(cur)) return 'Coffile ne tourne pas depuis une app installée.';
    if (cur.startsWith('/Volumes/')) return "Coffile est ouvert depuis l'image disque : glisse-le dans le dossier Applications pour recevoir les mises à jour.";
    try {
      fs.accessSync(path.dirname(cur), fs.constants.W_OK);
      fs.accessSync(cur, fs.constants.W_OK);
    } catch {
      return `Coffile n'a pas le droit de se remplacer dans ${path.dirname(cur)}.`;
    }
    return null;
  }

  check() {
    if (!this.busy) this.busy = this._check().finally(() => (this.busy = null));
    return this.busy;
  }

  async _check() {
    this.emit('checking-for-update');
    try {
      const res = await net.fetch(`${FEED}/latest-mac.yml?t=${Date.now()}`, { cache: 'no-store' });
      if (res.status === 404) throw new Error('No published versions');
      if (!res.ok) throw new Error(`Recherche impossible (HTTP ${res.status})`);
      const info = version.parseLatestYml(await res.text());
      if (!version.valid(info.version)) throw new Error('Fichier latest-mac.yml illisible');
      if (!version.gt(info.version, app.getVersion())) {
        this.emit('update-not-available', info);
        return null;
      }
      const file = (info.files || []).find((f) => new RegExp(`-mac-${process.arch}\\.zip$`).test(f.url));
      if (!file) throw new Error(`Pas de version Mac pour ce processeur (${process.arch})`);
      const blocked = this.installable();
      if (blocked) throw new Error(blocked);
      this.emit('update-available', info);
      const appPath = await this.download(info, file);
      this.ready = { version: info.version, app: appPath };
      this.log(`téléchargé : ${info.version}`);
      this.emit('update-downloaded', info);
      return info;
    } catch (e) {
      this.emit('error', e);
      return null;
    }
  }

  async download(info, file) {
    const base = path.join(this.dir(), info.version);
    const extracted = path.join(base, 'app');
    const done = path.join(base, 'ok');
    const findApp = () => {
      const name = fs.existsSync(extracted) && fs.readdirSync(extracted).find((n) => n.endsWith('.app'));
      return name ? path.join(extracted, name) : null;
    };
    // Déjà téléchargée (recherche précédente).
    if (fs.existsSync(done) && findApp()) return findApp();
    // Les anciennes versions téléchargées ne servent plus.
    await fsp.rm(this.dir(), { recursive: true, force: true });
    await fsp.mkdir(base, { recursive: true });
    const zip = path.join(base, 'mise-a-jour.zip');
    const url = new URL(file.url, `${FEED}/`).toString();
    const res = await net.fetch(url, { cache: 'no-store' });
    if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (HTTP ${res.status})`);
    const total = Number(res.headers.get('content-length')) || file.size || 0;
    const hash = crypto.createHash('sha512');
    const out = fs.createWriteStream(zip);
    const reader = res.body.getReader();
    let got = 0;
    let last = 0;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      const chunk = Buffer.from(value);
      hash.update(chunk);
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      if (total && Date.now() - last > 250) {
        last = Date.now();
        this.emit('download-progress', { percent: Math.min(100, (got / total) * 100), transferred: got, total });
      }
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    if (file.sha512 && hash.digest('base64') !== file.sha512) throw new Error('Mise à jour abîmée pendant le téléchargement (empreinte différente) : elle sera retéléchargée.');
    await run('/usr/bin/ditto', ['-x', '-k', zip, extracted]);
    await fsp.rm(zip, { force: true });
    const appPath = findApp();
    if (!appPath) throw new Error('Mise à jour incomplète (Coffile.app absent du zip)');
    await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', appPath]).catch(() => {});
    await fsp.writeFile(done, info.version);
    return appPath;
  }

  // Ferme Coffile ; le script met la nouvelle version à la place de l'ancienne et la relance.
  install(relaunch = true) {
    if (!this.ready) return false;
    const blocked = this.installable();
    if (blocked) {
      this.emit('error', new Error(blocked));
      return false;
    }
    const script = path.join(this.dir(), 'installer.sh');
    fs.writeFileSync(script, SCRIPT, { mode: 0o755 });
    const logFile = path.join(app.getPath('userData'), 'mises-a-jour.log');
    spawn('/bin/bash', [script, String(process.pid), this.currentApp(), this.ready.app, relaunch ? '1' : '0', logFile], { detached: true, stdio: 'ignore' }).unref();
    this.log(`installation de ${this.ready.version} (Coffile se ferme)`);
    this.ready = null;
    setImmediate(() => app.quit());
    return true;
  }
}

module.exports = { MacUpdater };
