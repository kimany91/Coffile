'use strict';
// AUTOEDIT : après le téléchargement, tu classes les rushes, Coffile fait le bout à bout sans les
// blancs, tu ajoutes des images (avec un sound effect si tu veux), puis le montage s'ouvre dans
// Premiere Pro (séquence au format XML de Final Cut Pro 7, que Premiere sait ouvrir).
// ffmpeg (fourni avec l'app) lit le son des rushes, donne leurs infos et prépare des aperçus légers.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { FOLDERS } = require('./project');

const VIDEO_EXT = /\.(mp4|mov|m4v|mxf|avi|mkv|mts|m2ts|webm|3gp|wmv|mpg|mpeg)$/i;
// Images affichables dans Coffile (et importables dans Premiere).
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const AUDIO_EXT = /\.(wav|mp3|aif|aiff|m4a|aac|ogg|flac)$/i;
// Modèles d'animation Premiere / After Effects (placés dans Premiere par l'extension Coffile).
const MOGRT_EXT = /\.mogrt$/i;
const TEMPLATE_EXT = new RegExp(`${VIDEO_EXT.source}|${IMAGE_EXT.source}|${MOGRT_EXT.source}`, 'i');
const kindOf = (name) => (MOGRT_EXT.test(name) ? 'mogrt' : IMAGE_EXT.test(name) ? 'image' : 'video');
const ENV_RATE = 20; // valeurs de volume par seconde
const ENV_HZ = 8000; // le son est relu en mono 8 kHz : suffisant pour repérer la parole
const STATE_FILE = '.coffile-autoedit.json';

let cacheDir = null;
function init(dir) {
  cacheDir = dir;
  fs.mkdirSync(path.join(dir, 'proxys'), { recursive: true });
}

// ---------- ffmpeg ----------
function ffmpegPath() {
  if (process.env.COFFILE_FFMPEG) return process.env.COFFILE_FFMPEG;
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'ffmpeg', exe));
  if (process.platform === 'win32') candidates.push(path.join(__dirname, '..', 'vendor', 'ffmpeg-win', exe));
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return 'ffmpeg';
}

// Lance ffmpeg ; onData reçoit la sortie standard, onErr chaque ligne d'erreur/progression.
function run(args, { onData, onErr, signal } = {}) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(ffmpegPath(), args, { windowsHide: true });
    } catch (e) {
      reject(e);
      return;
    }
    let stderr = '';
    let buf = '';
    proc.stdout.on('data', (d) => onData && onData(d));
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      if (stderr.length < 200000) stderr += s;
      if (!onErr) return;
      buf += s;
      const lines = buf.split(/\r?\n|\r/);
      buf = lines.pop();
      for (const l of lines) onErr(l);
    });
    const abort = () => proc.kill();
    if (signal) signal.addEventListener('abort', abort, { once: true });
    proc.on('error', (e) => {
      if (signal) signal.removeEventListener('abort', abort);
      reject(e.code === 'ENOENT' ? new Error('ffmpeg est introuvable : réinstalle Coffile.') : e);
    });
    proc.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', abort);
      resolve({ code, stderr });
    });
  });
}

const hms = (s) => {
  const m = String(s).match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
};

// Infos d'un fichier, lues dans ce qu'affiche « ffmpeg -i ».
function parseProbe(text) {
  const out = { duration: null, width: null, height: null, fps: null, vcodec: null, hasVideo: false, hasAudio: false, sampleRate: null, channels: 0, rotation: 0 };
  const d = text.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/);
  if (d) out.duration = hms(d[1]);
  const v = text.match(/Stream #\d+:\d+[^\n]*?: Video: ([^\n]+)/);
  if (v) {
    out.hasVideo = true;
    out.vcodec = v[1].split(/[\s,(]/)[0];
    const size = v[1].match(/,\s*(\d{2,5})x(\d{2,5})[\s,[]/);
    if (size) [out.width, out.height] = [Number(size[1]), Number(size[2])];
    const fps = v[1].match(/([\d.]+)\s*fps/) || v[1].match(/([\d.]+)\s*tbr/);
    if (fps) out.fps = Number(fps[1]);
  }
  const rot = text.match(/rotation of (-?[\d.]+) degrees/) || text.match(/rotate\s*:\s*(-?\d+)/);
  if (rot) out.rotation = Math.round(Number(rot[1]));
  if (Math.abs(out.rotation) % 180 === 90 && out.width) [out.width, out.height] = [out.height, out.width];
  const a = text.match(/Stream #\d+:\d+[^\n]*?: Audio: ([^\n]+)/);
  if (a) {
    out.hasAudio = true;
    const hz = a[1].match(/(\d+)\s*Hz/);
    if (hz) out.sampleRate = Number(hz[1]);
    const ch = a[1].match(/Hz,\s*([^,]+)/);
    const c = ch ? ch[1].trim() : '';
    out.channels = /mono/.test(c) ? 1 : /stereo|2 channels|2\.0/.test(c) ? 2 : /(\d+)\s*channels/.test(c) ? Number(c.match(/(\d+)/)[1]) : /5\.1|7\.1|quad/.test(c) ? 6 : 2;
  }
  return out;
}

async function probe(file) {
  const { stderr } = await run(['-hide_banner', '-nostdin', '-i', file]);
  return parseProbe(stderr);
}

const keyOf = async (file) => {
  const st = await fsp.stat(file);
  return { st, key: crypto.createHash('sha1').update(`${path.resolve(file)}|${st.size}|${Math.round(st.mtimeMs)}`).digest('hex') };
};

// Volume du son tous les 1/20 s, en dB (de -90 à 0). Gardé en cache tant que le fichier ne change pas.
async function envelope(file, { onProgress, signal, duration } = {}) {
  const { key } = await keyOf(file);
  const cached = cacheDir && path.join(cacheDir, `${key}.json`);
  if (cached) {
    try {
      return JSON.parse(await fsp.readFile(cached, 'utf8'));
    } catch {}
  }
  const win = ENV_HZ / ENV_RATE;
  const db = [];
  let acc = 0;
  let n = 0;
  let carry = null;
  let samples = 0;
  const total = duration ? duration * ENV_HZ : 0;
  let lastReport = 0;
  const { code, stderr } = await run(['-v', 'error', '-nostdin', '-i', file, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', String(ENV_HZ), '-f', 's16le', 'pipe:1'], {
    signal,
    onData: (chunk) => {
      let b = chunk;
      if (carry) {
        b = Buffer.concat([carry, chunk]);
        carry = null;
      }
      const len = b.length - (b.length % 2);
      if (len < b.length) carry = b.subarray(len);
      for (let i = 0; i < len; i += 2) {
        const s = b.readInt16LE(i);
        acc += s * s;
        if (++n === win) {
          const rms = Math.sqrt(acc / n);
          db.push(rms < 1 ? -90 : Math.max(-90, Math.round(20 * Math.log10(rms / 32768))));
          acc = 0;
          n = 0;
        }
      }
      samples += len / 2;
      if (onProgress && total && samples - lastReport > ENV_HZ * 20) {
        lastReport = samples;
        onProgress(Math.min(1, samples / total));
      }
    }
  });
  if (signal && signal.aborted) throw new Error('annulé');
  const noAudio = !db.length && /matches no streams|does not contain any stream|Stream map/i.test(stderr);
  if (code !== 0 && !db.length && !noAudio) throw new Error(stderr.split('\n').filter(Boolean).pop() || 'Lecture du son impossible');
  const out = { rate: ENV_RATE, db, noAudio };
  if (cached) await fsp.writeFile(cached, JSON.stringify(out)).catch(() => {});
  return out;
}

// Aperçu léger (540p, H.264) pour les formats que Coffile ne sait pas lire (ProRes, MXF, HEVC sans décodeur…).
async function proxy(file, { onProgress, signal, duration } = {}) {
  const { key } = await keyOf(file);
  const out = path.join(cacheDir, 'proxys', `${key}.mp4`);
  if (fs.existsSync(out)) return out;
  const tmp = `${out}.tmp.mp4`;
  const { code, stderr } = await run(
    ['-v', 'error', '-nostdin', '-y', '-i', file, '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'scale=-2:540', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', '-progress', 'pipe:2', tmp],
    {
      signal,
      onErr: (l) => {
        const m = l.match(/^out_time_us=(\d+)/) || l.match(/^out_time_ms=(\d+)/);
        if (m && duration && onProgress) onProgress(Math.min(1, Number(m[1]) / 1e6 / duration));
      }
    }
  );
  if (code !== 0) {
    await fsp.rm(tmp, { force: true });
    throw new Error(signal && signal.aborted ? 'annulé' : stderr.split('\n').filter((l) => l && !/=/.test(l)).pop() || 'Aperçu impossible');
  }
  await fsp.rename(tmp, out);
  return out;
}

// ---------- Fichiers du projet ----------
async function walk(dir, test, out = [], base = dir, depth = 0) {
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || out.length >= 3000) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < 8) await walk(full, test, out, base, depth + 1);
    } else if (test.test(e.name)) {
      try {
        const st = await fsp.stat(full);
        out.push({ path: full, name: e.name, rel: path.relative(base, path.dirname(full)).split(path.sep).filter(Boolean), size: st.size, mtime: st.mtimeMs });
      } catch {}
    }
  }
  return out;
}

// ---------- Fins (outro, écran de fin, générique…) ----------
// Noms qui désignent une fin, du plus sûr au moins sûr. Comparés au nom du fichier et de ses
// dossiers, sans accents ni majuscules, mots séparés (« EndCard_V2 » → « end card v2 »).
const ENDING_WORDS = [
  [3, ['outro', 'outros', 'fin', 'the end', 'end', 'ending', 'endcard', 'end card', 'endscreen', 'end screen', 'end page', 'endpage', 'end slate', 'end frame', 'end title', 'end titles', 'end tag', 'endtag',
    'generique', 'generique de fin', 'credits', 'credit', 'ecran de fin', 'ecran fin', 'page de fin', 'page fin', 'carton de fin', 'carton fin', 'plan de fin', 'plan fin', 'slide de fin', 'slide fin',
    'clap de fin', 'image de fin', 'video de fin', 'logo de fin', 'logo fin', 'logo end', 'logo outro', 'packshot', 'pack shot', 'cloture', 'closing', 'closing card', 'closer']],
  [1, ['conclusion', 'signature', 'cta', 'call to action', 'abonne toi', 'abonnez vous', 'subscribe', 'merci', 'thanks', 'thank you', 'bye', 'a bientot', 'see you', 'bumper']]
];
function nameWords(s) {
  return ` ${String(s)
    .replace(/\.[^.]+$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}
// Note et mot reconnu pour un fichier (0 = pas une fin).
function endingScore(f) {
  const own = nameWords(f.name);
  const dirs = nameWords((f.rel || []).join(' '));
  let best = { score: 0, word: '' };
  for (const [weight, words] of ENDING_WORDS) {
    for (const w of words) {
      const k = ` ${w} `;
      // Dans le nom du fichier, ou dans le nom d'un dossier (un peu moins sûr).
      const sc = own.includes(k) ? weight + w.length / 100 : dirs.includes(k) ? weight - 0.5 + w.length / 100 : 0;
      if (sc > best.score) best = { score: sc, word: w };
    }
  }
  return best;
}
function findEndings(rushes, images, templates = []) {
  const out = [];
  for (const [kind, list] of [['video', rushes], ['image', images], [null, templates]]) {
    for (const f of list) {
      const m = endingScore(f);
      if (m.score > 0) out.push({ ...f, kind: kind || f.kind || kindOf(f.name), word: m.word.toUpperCase(), score: Math.round(m.score * 100) / 100 });
    }
  }
  return out.sort((a, b) => b.score - a.score || (a.kind === b.kind ? 0 : a.kind === 'video' ? -1 : 1) || a.name.localeCompare(b.name, 'fr', { numeric: true }));
}

const byName = (a, b) => a.rel.join('/').localeCompare(b.rel.join('/'), 'fr', { numeric: true }) || a.name.localeCompare(b.name, 'fr', { numeric: true });

// Rushes vidéo, images, et sound effects (dossier du projet + ta bibliothèque liée).
async function listMedia(projectDir, sfxLibrary) {
  const rushes = (await walk(path.join(projectDir, FOLDERS.rushes), VIDEO_EXT)).sort(byName).map((f) => ({ ...f, kind: 'video', folder: FOLDERS.rushes }));
  const images = (await walk(path.join(projectDir, FOLDERS.images), IMAGE_EXT)).sort(byName).map((f) => ({ ...f, kind: 'image', folder: FOLDERS.images }));
  // TEMPLATE : vidéos, images et modèles d'animation (.mogrt), pour les overlays et les fins.
  const templates = (await walk(path.join(projectDir, FOLDERS.template), TEMPLATE_EXT)).sort(byName).map((f) => ({ ...f, kind: kindOf(f.name), folder: FOLDERS.template }));
  const projSfx = path.join(projectDir, FOLDERS.sfx);
  const sfx = (await walk(projSfx, AUDIO_EXT)).sort(byName).map((f) => ({ ...f, source: 'projet' }));
  if (sfxLibrary && path.resolve(sfxLibrary) !== path.resolve(projSfx) && fs.existsSync(sfxLibrary)) {
    const inProject = new Set(sfx.map((f) => `${f.rel.join('/')}/${f.name}`.toLowerCase()));
    for (const f of (await walk(sfxLibrary, AUDIO_EXT)).sort(byName)) if (!inProject.has(`${f.rel.join('/')}/${f.name}`.toLowerCase())) sfx.push({ ...f, source: 'bibliotheque' });
  }
  return { rushes, images, templates, sfx, endings: findEndings(rushes, images, templates) };
}

// Ton travail (classement, réglages, images) est gardé dans MONTAGE, pour reprendre plus tard.
async function loadState(projectDir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(projectDir, FOLDERS.montage, STATE_FILE), 'utf8'));
  } catch {
    return null;
  }
}

async function saveState(projectDir, data) {
  const dir = path.join(projectDir, FOLDERS.montage);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, STATE_FILE), JSON.stringify({ ...data, savedAt: Date.now() }, null, 1));
}

// ---------- Séquence Premiere (XML Final Cut Pro 7 / xmeml) ----------
// Échelle (en %) qui fait tenir un média dans le cadre de la séquence.
function fitScale(m, W, H) {
  return m && m.width && m.height ? Math.round(Math.min(W / m.width, H / m.height) * 10000) / 100 : 100;
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Images par seconde → base de temps XML (29,97 = 30 « NTSC »).
function rateOf(fps) {
  const f = Number(fps) || 25;
  for (const [nominal, real] of [[24, 23.976], [30, 29.97], [48, 47.952], [60, 59.94], [120, 119.88]]) if (Math.abs(f - real) < 0.02) return { timebase: nominal, ntsc: true, fps: (nominal * 1000) / 1001 };
  const tb = Math.max(1, Math.round(f));
  return { timebase: tb, ntsc: false, fps: tb };
}
const rateXml = (r) => `<rate><timebase>${r.timebase}</timebase><ntsc>${r.ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`;

function pathUrl(p, P = path) {
  const abs = P.resolve(p);
  const parts = abs.split(/[\\/]+/).filter(Boolean);
  const enc = parts.map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)));
  return `file://localhost/${enc.join('/')}`;
}

// clips : [{ path, name, duration, width, height, hasAudio, channels, sampleRate }]
// segments : [{ clip, in, out }] dans l'ordre (secondes) ; overlays : [{ start, duration, image: { path, name, width, height }, sfx: { path, name, duration, channels } }]
// Overlay enregistré par une ancienne version ({ image: {...} }) → { kind: 'image', path, … }.
function normOverlay(o) {
  if (o.kind) return o;
  const img = o.image || {};
  return { ...o, kind: 'image', path: img.path, name: img.name, width: img.width, height: img.height };
}

// Pistes : V1 rushes (+ fin), V2 overlays, V3 modèles .mogrt (posés dans Premiere par l'extension),
// V4 sous-titres incrustés ; A1-A2 son des rushes, A3-A4 sound effects, A5-A6 son des overlays vidéo.
// subtitles : [{ path, name, start, duration }] (images PNG au format de la séquence).
function buildXml({ name, fps, width, height, clips, segments, overlays = [], subtitles = [] }) {
  const r = rateOf(fps);
  const fr = (sec) => Math.round(sec * r.fps);
  const W = width || 1920;
  const H = height || 1080;
  const files = new Map();
  let fileN = 0;
  let itemN = 0;
  const fileXml = (f, kind) => {
    if (files.has(f.path)) return `<file id="${files.get(f.path)}"/>`;
    const id = `file-${++fileN}`;
    files.set(f.path, id);
    const len = fr(f.duration || 10);
    const video = kind !== 'audio' ? `<video><samplecharacteristics>${rateXml(r)}<width>${f.width || W}</width><height>${f.height || H}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></video>` : '';
    const audio = f.hasAudio !== false && kind !== 'image' ? `<audio><samplecharacteristics><depth>16</depth><samplerate>${f.sampleRate || 48000}</samplerate></samplecharacteristics><channelcount>${Math.min(2, f.channels || 2)}</channelcount></audio>` : '';
    return `<file id="${id}"><name>${xmlEsc(f.name)}</name><pathurl>${xmlEsc(pathUrl(f.path))}</pathurl>${rateXml(r)}<duration>${len}</duration><media>${video}${audio}</media></file>`;
  };
  // Image ajustée au cadre (comme « Ajuster à la taille de l'image »).
  const motionXml = (img) => {
    const scale = fitScale(img, W, H);
    if (scale === 100) return '';
    return `<filter><effect><name>Basic Motion</name><effectid>basic</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype><parameter><parameterid>scale</parameterid><name>Scale</name><valuemin>0</valuemin><valuemax>1000</valuemax><value>${scale}</value></parameter></effect></filter>`;
  };
  const linkXml = (refs) => refs.map((l) => `<link><linkclipref>${l.id}</linkclipref><mediatype>${l.type}</mediatype><trackindex>${l.track}</trackindex><clipindex>${l.index}</clipindex>${l.type === 'audio' ? `<groupindex>1</groupindex>` : ''}</link>`).join('');

  // Piste vidéo 1 et pistes audio 1-2 : les rushes, coupés, dans l'ordre.
  const v1 = [];
  const a = [[], []];
  // Position en images entières : chaque morceau commence exactement où finit le précédent.
  let cursor = 0;
  for (const seg of segments) {
    // Fin en modèle d'animation : posée par Premiere (extension), la place est laissée libre.
    if (seg.mogrt) {
      cursor += Math.max(1, fr(seg.duration || 5));
      continue;
    }
    // Image de fin posée sur V1 après les rushes.
    if (seg.still) {
      const len = Math.max(1, fr(seg.duration || 4));
      v1.push(`<clipitem id="clipitem-${++itemN}"><name>${xmlEsc(seg.still.name)}</name><enabled>TRUE</enabled><duration>${len}</duration>${rateXml(r)}<start>${cursor}</start><end>${cursor + len}</end><in>0</in><out>${len}</out>${fileXml({ ...seg.still, duration: seg.duration || 4, hasAudio: false }, 'image')}${motionXml(seg.still)}</clipitem>`);
      cursor += len;
      continue;
    }
    const c = clips[seg.clip];
    const start = cursor;
    const len = Math.max(1, fr(seg.out) - fr(seg.in));
    const end = start + len;
    cursor = end;
    const vid = `clipitem-${++itemN}`;
    const chans = c.hasAudio ? Math.min(2, c.channels || 2) : 0;
    const aud = Array.from({ length: chans }, () => `clipitem-${++itemN}`);
    const refs = [{ id: vid, type: 'video', track: 1, index: v1.length + 1 }, ...aud.map((id, k) => ({ id, type: 'audio', track: k + 1, index: a[k].length + 1 }))];
    const common = `<enabled>TRUE</enabled><duration>${fr(c.duration || seg.out)}</duration>${rateXml(r)}<start>${start}</start><end>${end}</end><in>${fr(seg.in)}</in><out>${fr(seg.in) + len}</out>`;
    v1.push(`<clipitem id="${vid}"><name>${xmlEsc(c.name)}</name>${common}${fileXml(c, 'video')}${linkXml(refs)}</clipitem>`);
    aud.forEach((id, k) => {
      a[k].push(`<clipitem id="${id}"><name>${xmlEsc(c.name)}</name>${common}${fileXml(c, 'video')}<sourcetrack><mediatype>audio</mediatype><trackindex>${k + 1}</trackindex></sourcetrack>${linkXml(refs)}</clipitem>`);
    });
  }
  const total = cursor;

  // Piste vidéo 2 : les overlays (images, vidéos) ; pistes audio 3-4 : leurs sound effects ;
  // 5-6 : le son des overlays vidéo (si gardé).
  const v2 = [];
  const fx = [[], []];
  const oa = [[], []];
  const ends = [];
  for (const raw of [...overlays].sort((x, y) => x.start - y.start)) {
    const o = normOverlay(raw);
    if (o.kind === 'mogrt' || !o.path) continue;
    const start = fr(o.start);
    const len = Math.max(1, fr(o.duration || 3));
    ends.push(start + len);
    const id = `clipitem-${++itemN}`;
    if (o.kind === 'video') {
      const from = fr(o.from || 0);
      const keep = o.audio && o.hasAudio ? Math.min(2, o.channels || 2) : 0;
      const aud = Array.from({ length: keep }, () => `clipitem-${++itemN}`);
      const refs = keep ? [{ id, type: 'video', track: 2, index: v2.length + 1 }, ...aud.map((x, k) => ({ id: x, type: 'audio', track: 5 + k, index: oa[k].length + 1 }))] : [];
      const common = `<enabled>TRUE</enabled><duration>${fr(o.fileDuration || o.from + o.duration)}</duration>${rateXml(r)}<start>${start}</start><end>${start + len}</end><in>${from}</in><out>${from + len}</out>`;
      const file = { path: o.path, name: o.name, duration: o.fileDuration || o.from + o.duration, width: o.width, height: o.height, hasAudio: !!o.hasAudio, channels: o.channels, sampleRate: o.sampleRate };
      v2.push(`<clipitem id="${id}"><name>${xmlEsc(o.name)}</name>${common}${fileXml(file, 'video')}${motionXml(o)}${linkXml(refs)}</clipitem>`);
      aud.forEach((x, k) => oa[k].push(`<clipitem id="${x}"><name>${xmlEsc(o.name)}</name>${common}${fileXml(file, 'video')}<sourcetrack><mediatype>audio</mediatype><trackindex>${k + 1}</trackindex></sourcetrack>${linkXml(refs)}</clipitem>`));
    } else {
      v2.push(`<clipitem id="${id}"><name>${xmlEsc(o.name)}</name><enabled>TRUE</enabled><duration>${len}</duration>${rateXml(r)}<start>${start}</start><end>${start + len}</end><in>0</in><out>${len}</out>${fileXml({ ...o, duration: o.duration || 3, hasAudio: false }, 'image')}${motionXml(o)}</clipitem>`);
    }
    if (o.sfx) {
      const sfx = o.sfx;
      const slen = Math.max(1, fr(sfx.duration || 2));
      const chans = Math.min(2, sfx.channels || 2);
      for (let k = 0; k < chans; k++) {
        fx[k].push(`<clipitem id="clipitem-${++itemN}"><name>${xmlEsc(sfx.name)}</name><enabled>TRUE</enabled><duration>${slen}</duration>${rateXml(r)}<start>${start}</start><end>${start + slen}</end><in>0</in><out>${slen}</out>${fileXml({ ...sfx, hasAudio: true }, 'audio')}<sourcetrack><mediatype>audio</mediatype><trackindex>${k + 1}</trackindex></sourcetrack></clipitem>`);
      }
    }
  }
  // Piste vidéo 4 : sous-titres incrustés (une image transparente par sous-titre).
  const v4 = [];
  for (const sub of subtitles) {
    const start = fr(sub.start);
    const len = Math.max(1, fr(sub.duration));
    ends.push(start + len);
    v4.push(`<clipitem id="clipitem-${++itemN}"><name>${xmlEsc(sub.name)}</name><enabled>TRUE</enabled><duration>${len}</duration>${rateXml(r)}<start>${start}</start><end>${start + len}</end><in>0</in><out>${len}</out>${fileXml({ path: sub.path, name: sub.name, width: W, height: H, duration: sub.duration, hasAudio: false }, 'image')}</clipitem>`);
  }
  const seqEnd = Math.max(total, ...ends, 1);
  const track = (items, extra = '') => `<track>${items.join('')}<enabled>TRUE</enabled><locked>FALSE</locked>${extra}</track>`;
  const audioTracks = [a[0], a[1], fx[0], fx[1], oa[0], oa[1]].map((items, i) => track(items, `<outputchannelindex>${(i % 2) + 1}</outputchannelindex>`));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
<sequence id="sequence-1">
<name>${xmlEsc(name)}</name>
<duration>${seqEnd}</duration>
${rateXml(r)}
<timecode>${rateXml(r)}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
<media>
<video>
<format><samplecharacteristics>${rateXml(r)}<width>${W}</width><height>${H}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>
${track(v1)}
${track(v2)}
${track([])}
${track(v4)}
</video>
<audio>
<numOutputChannels>2</numOutputChannels>
<format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>
${audioTracks.join('\n')}
</audio>
</media>
</sequence>
</xmeml>
`;
}

// ---------- Validation : fichiers rangés, XML écrit, Premiere ouvert ----------
async function sameFile(a, b) {
  try {
    const [x, y] = await Promise.all([fsp.stat(a), fsp.stat(b)]);
    return x.size === y.size;
  } catch {
    return false;
  }
}

// Les sound effects pris dans ta bibliothèque sont copiés dans « SOUND EFFECT » du projet.
async function bringSfx(projectDir, overlays) {
  const dest = path.join(projectDir, FOLDERS.sfx);
  const out = [];
  for (const o of overlays) {
    if (!o.sfx || !o.sfx.path) {
      out.push(o);
      continue;
    }
    if (path.resolve(o.sfx.path).startsWith(path.resolve(projectDir) + path.sep)) {
      out.push(o);
      continue;
    }
    await fsp.mkdir(dest, { recursive: true });
    let target = path.join(dest, o.sfx.name);
    if (fs.existsSync(target) && !(await sameFile(o.sfx.path, target))) {
      const ext = path.extname(o.sfx.name);
      const base = path.basename(o.sfx.name, ext);
      for (let n = 2; fs.existsSync(target); n++) target = path.join(dest, `${base}_${n}${ext}`);
    }
    if (!fs.existsSync(target)) await fsp.copyFile(o.sfx.path, target);
    out.push({ ...o, sfx: { ...o.sfx, path: target, name: path.basename(target) } });
  }
  return out;
}

// Projet Premiere du montage : celui de MONTAGE (créé depuis ton modèle), sinon un nouveau.
async function projectFile(projectDir, name) {
  const dir = path.join(projectDir, FOLDERS.montage);
  const own = path.join(dir, `${name}.prproj`);
  if (fs.existsSync(own)) return own;
  let best = null;
  try {
    for (const f of await fsp.readdir(dir)) {
      if (!/\.prproj$/i.test(f) || /auto-save/i.test(f)) continue;
      const st = await fsp.stat(path.join(dir, f));
      if (!best || st.mtimeMs > best.mtime) best = { file: path.join(dir, f), mtime: st.mtimeMs };
    }
  } catch {}
  return best ? best.file : own;
}

const safeName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '_');

// Écrit la séquence (XML) et le .srt, et prépare le « bon de travail » pour l'extension Premiere :
// projet à ouvrir, XML à importer, et le montage détaillé (secondes) pour le reconstruire par l'API
// si l'import ne donne rien. captions : { mode: 'premiere' | 'burn', srt, images: [{ path, name, start, duration }] }
async function exportEdit({ projectDir, name, fps, width, height, clips, segments, overlays, captions = null }) {
  if (!segments || !segments.length) throw new Error('Aucun rush dans le montage.');
  const W = width || 1920;
  const H = height || 1080;
  const placed = (await bringSfx(projectDir, (overlays || []).map(normOverlay))).map(normOverlay);
  for (const o of placed) {
    // Durée et canaux des sound effects (pour la longueur des clips audio).
    if (o.sfx && !o.sfx.duration) {
      const p = await probe(o.sfx.path).catch(() => ({}));
      o.sfx.duration = p.duration || 2;
      o.sfx.channels = p.channels || 2;
    }
    // Vidéo en overlay (TEMPLATE, RUSHES…) : taille, son et durée du fichier.
    if (o.kind === 'video' && (!o.width || o.fileDuration == null)) {
      const p = await probe(o.path).catch(() => ({}));
      Object.assign(o, { width: o.width || p.width, height: o.height || p.height, hasAudio: p.hasAudio, channels: p.channels, sampleRate: p.sampleRate, fileDuration: p.duration });
    }
  }
  const dir = path.join(projectDir, FOLDERS.montage);
  await fsp.mkdir(dir, { recursive: true });
  const base = safeName(name);
  let srtPath = null;
  if (captions && captions.srt) {
    srtPath = path.join(dir, `${base}_sous-titres.srt`);
    await fsp.writeFile(srtPath, captions.srt, 'utf8');
  }
  const burned = captions && captions.mode === 'burn' ? captions.images || [] : [];
  const sequenceName = `${name} AUTOEDIT`;
  const xml = buildXml({ name: sequenceName, fps, width, height, clips, segments, overlays: placed, subtitles: burned });
  const file = path.join(dir, `${base}_AUTOEDIT.xml`);
  await fsp.writeFile(file, xml, 'utf8');

  // Montage détaillé, en secondes, pour la reconstruction par l'API de Premiere (plan B).
  let t = 0;
  const steps = segments.map((seg) => {
    if (seg.mogrt) {
      const st = { mogrt: true, path: seg.mogrt.path, start: t, duration: seg.duration || 5 };
      t += st.duration;
      return st;
    }
    if (seg.still) {
      const st = { still: true, path: seg.still.path, start: t, duration: seg.duration || 4, scale: fitScale(seg.still, W, H) };
      t += st.duration;
      return st;
    }
    const st = { path: clips[seg.clip].path, in: seg.in, out: seg.out, start: t };
    t += seg.out - seg.in;
    return st;
  });
  const jobOverlays = placed.map((o) => ({ kind: o.kind, path: o.path, start: o.start, duration: o.duration, from: o.from || 0, scale: fitScale(o, W, H), sfx: o.sfx ? o.sfx.path : null, track: 2, audioTrack: 6 }));
  // Fin en .mogrt : sur V1, juste après les rushes.
  for (const st of steps) if (st.mogrt) jobOverlays.push({ kind: 'mogrt', path: st.path, start: st.start, duration: st.duration, track: 0, audioTrack: 6 });
  const media = [...new Set([...steps.filter((x) => !x.mogrt).map((x) => x.path), ...placed.filter((o) => o.kind !== 'mogrt').map((o) => o.path), ...placed.filter((o) => o.sfx).map((o) => o.sfx.path)])];
  const job = {
    id: `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    projectPath: await projectFile(projectDir, name),
    xmlPath: file,
    sequenceName,
    binName: 'AUTOEDIT',
    media,
    segments: steps,
    overlays: jobOverlays,
    srtPath: captions && captions.mode === 'premiere' ? srtPath : null
  };
  return { file, job, srtPath, overlays: placed };
}

module.exports = {
  init,
  ffmpegPath,
  ffmpeg: run,
  parseProbe,
  probe,
  envelope,
  proxy,
  listMedia,
  loadState,
  saveState,
  buildXml,
  findEndings,
  endingScore,
  rateOf,
  pathUrl,
  exportEdit,
  normOverlay,
  fitScale,
  ENV_RATE,
  kindOf,
  MOGRT_EXT,
  VIDEO_EXT,
  IMAGE_EXT,
  AUDIO_EXT
};
