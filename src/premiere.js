'use strict';
// Liaison avec Premiere : Coffile installe une petite extension (src/premiere-ext) qui démarre
// avec Premiere, puis lui dépose les montages AUTOEDIT à construire. Premiere ne sait pas ouvrir
// un fichier de montage passé au lancement : c'est l'extension, dans Premiere, qui l'importe.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile, spawn } = require('child_process');

const EXT_ID = 'fr.coffile.premiere';
const EXT_VERSION = '1.0.0';
const SRC = path.join(__dirname, 'premiere-ext');

let dir = null; // dossier d'échange : inbox (montages à faire), outbox (comptes rendus, alive.json)
function init(userDataDir) {
  dir = path.join(userDataDir, 'premiere');
  fs.mkdirSync(path.join(dir, 'inbox'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'outbox'), { recursive: true });
}

// Dossier des extensions de l'utilisateur (pas besoin d'être administrateur).
function extensionsDir() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'), 'Adobe', 'CEP', 'extensions');
  if (process.platform === 'darwin') return path.join(require('os').homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions');
  return path.join(require('os').homedir(), '.coffile-cep-extensions');
}

const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout))));

// Extension non signée (installée par Coffile, pas par la boutique Adobe) : Premiere doit
// accepter les extensions « en mode développement » (réglage PlayerDebugMode, par version de CEP).
async function allowUnsigned() {
  const versions = [9, 10, 11, 12, 13, 14];
  if (process.platform === 'win32') {
    for (const v of versions) await run('reg', ['add', `HKCU\\Software\\Adobe\\CSXS.${v}`, '/v', 'PlayerDebugMode', '/t', 'REG_SZ', '/d', '1', '/f']);
  } else if (process.platform === 'darwin') {
    for (const v of versions) await run('defaults', ['write', `com.adobe.CSXS.${v}`, 'PlayerDebugMode', '1']);
  }
}

async function copyDir(from, to) {
  await fsp.mkdir(to, { recursive: true });
  // readdirSync + statSync : fonctionne aussi dans l'archive de l'app (app.asar).
  for (const name of fs.readdirSync(from)) {
    const a = path.join(from, name);
    const b = path.join(to, name);
    if (fs.statSync(a).isDirectory()) await copyDir(a, b);
    else await fsp.writeFile(b, fs.readFileSync(a));
  }
}

// Installe (ou met à jour) l'extension. fresh = vient d'être installée : un Premiere déjà
// ouvert ne la verra qu'après avoir été relancé.
async function install() {
  const dest = path.join(extensionsDir(), EXT_ID);
  const conf = { dir, version: EXT_VERSION };
  let current = null;
  try {
    current = JSON.parse(fs.readFileSync(path.join(dest, 'coffile.json'), 'utf8'));
  } catch {}
  const same = current && current.version === EXT_VERSION && current.dir === dir && fs.existsSync(path.join(dest, 'CSXS', 'manifest.xml'));
  // Le script Premiere est toujours recopié (il est relu avant chaque montage).
  if (same) {
    await fsp.writeFile(path.join(dest, 'host.jsx'), fs.readFileSync(path.join(SRC, 'host.jsx')));
    return { ok: true, dest, fresh: false };
  }
  await copyDir(SRC, dest);
  await fsp.writeFile(path.join(dest, 'coffile.json'), JSON.stringify(conf, null, 1));
  await allowUnsigned();
  return { ok: true, dest, fresh: !current };
}

// L'extension tourne-t-elle dans un Premiere ouvert ? (elle écrit alive.json toutes les 2 s)
function alive() {
  try {
    const st = fs.statSync(path.join(dir, 'outbox', 'alive.json'));
    return Date.now() - st.mtimeMs < 7000;
  } catch {
    return false;
  }
}

async function isRunning() {
  if (process.platform === 'win32') {
    const out = await run('tasklist', ['/FO', 'CSV', '/NH']);
    return !!out && /"Adobe Premiere[^"]*\.exe"/i.test(out);
  }
  const out = await run('pgrep', ['-fl', 'Adobe Premiere']);
  return !!(out && out.trim());
}

function sendJob(job) {
  const file = path.join(dir, 'inbox', `${job.id}.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(job));
  fs.renameSync(`${file}.tmp`, file);
  return file;
}

// État d'un montage envoyé : waiting (pas encore pris), working, done (avec le compte rendu).
function jobState(id) {
  const out = path.join(dir, 'outbox', `${id}.json`);
  if (fs.existsSync(out)) {
    try {
      return { state: 'done', result: JSON.parse(fs.readFileSync(out, 'utf8')), alive: alive() };
    } catch {}
  }
  if (fs.existsSync(path.join(dir, 'inbox', `${id}.json.working`)) || fs.existsSync(path.join(dir, 'outbox', `${id}.state.json`))) return { state: 'working', alive: alive() };
  return { state: 'waiting', alive: alive() };
}

// Premiere installé (le plus récent) : « Adobe Premiere Pro 2025 », « Adobe Premiere 2026 »…
function findPremiere(custom) {
  if (custom && fs.existsSync(custom)) return custom;
  if (process.platform === 'win32') {
    const roots = [process.env.ProgramFiles, process.env.ProgramW6432, 'C:\\Program Files'].filter(Boolean);
    for (const root of [...new Set(roots)]) {
      const adobe = path.join(root, 'Adobe');
      let dirs = [];
      try {
        dirs = fs.readdirSync(adobe).filter((d) => /^Adobe Premiere(?! Elements| Rush)/i.test(d));
      } catch {
        continue;
      }
      const year = (d) => Number((d.match(/\b(20\d\d)\b/) || [0])[0]);
      dirs.sort((x, y) => year(y) - year(x) || y.localeCompare(x));
      for (const d of dirs) {
        let exes = [];
        try {
          exes = fs.readdirSync(path.join(adobe, d)).filter((f) => /^Adobe Premiere.*\.exe$/i.test(f));
        } catch {}
        exes.sort((a, b) => a.length - b.length);
        if (exes[0]) return path.join(adobe, d, exes[0]);
      }
    }
  }
  if (process.platform === 'darwin') {
    try {
      const apps = fs.readdirSync('/Applications').filter((d) => /^Adobe Premiere(?! Elements| Rush)/i.test(d)).sort().reverse();
      for (const d of apps) {
        const inner = fs.readdirSync(path.join('/Applications', d)).find((x) => /\.app$/.test(x));
        if (inner) return path.join('/Applications', d, inner);
      }
    } catch {}
  }
  return null;
}

// Ouvre Premiere sur le projet (.prproj) ; sans projet, Premiere s'ouvre et l'extension le crée.
function launch(prproj, custom, shell) {
  const exe = findPremiere(custom);
  if (prproj && fs.existsSync(prproj) && !exe && shell) {
    shell.openPath(prproj);
    return { ok: true, how: 'association' };
  }
  if (!exe) return { ok: false };
  const args = prproj && fs.existsSync(prproj) ? [prproj] : [];
  const child = process.platform === 'darwin' ? spawn('open', ['-a', exe, ...args], { detached: true, stdio: 'ignore' }) : spawn(exe, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  return { ok: true, how: 'exe', exe };
}

module.exports = { init, install, alive, isRunning, sendJob, jobState, findPremiere, launch, extensionsDir, EXT_ID };
