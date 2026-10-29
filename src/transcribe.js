'use strict';
// Sous-titres automatiques : transcription hors ligne avec Whisper (whisper.cpp, fourni avec
// Coffile). Le modèle de langue est téléchargé une seule fois ; ensuite tout se passe sur le PC,
// sans compte ni crédit. Chaque rush est transcrit une fois (mot par mot, avec ses temps) et
// gardé en cache : changer la coupe des blancs ne demande pas de tout refaire.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const autoedit = require('./autoedit');

const MODELS = {
  base: { file: 'ggml-base-q5_1.bin', size: 59707625, label: 'Rapide', mo: 60 },
  small: { file: 'ggml-small-q5_1.bin', size: 190085487, label: 'Précis', mo: 190 },
  medium: { file: 'ggml-medium-q5_0.bin', size: 539212467, label: 'Très précis (lent)', mo: 540 }
};
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';

let base = null;
let fetchFn = null;
function init(userDataDir, fetchImpl) {
  base = path.join(userDataDir, 'whisper');
  fs.mkdirSync(path.join(base, 'models'), { recursive: true });
  fs.mkdirSync(path.join(base, 'cache'), { recursive: true });
  fs.mkdirSync(path.join(base, 'tmp'), { recursive: true });
  fetchFn = fetchImpl;
}

function enginePath() {
  if (process.env.COFFILE_WHISPER) return process.env.COFFILE_WHISPER;
  const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'whisper', exe));
  if (process.platform === 'win32') candidates.push(path.join(__dirname, '..', 'vendor', 'whisper-win', exe));
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

const modelPath = (id) => path.join(base, 'models', (MODELS[id] || MODELS.small).file);

function status() {
  const models = {};
  for (const [id, m] of Object.entries(MODELS)) models[id] = { label: m.label, mo: m.mo, installed: fs.existsSync(modelPath(id)) };
  return { engine: !!enginePath(), models };
}

// Téléchargement du modèle (une fois), avec la progression.
const downloads = {};
async function downloadModel(id, onProgress) {
  if (!MODELS[id]) throw new Error('Modèle inconnu');
  if (fs.existsSync(modelPath(id))) return modelPath(id);
  if (downloads[id]) return downloads[id];
  downloads[id] = (async () => {
    const dest = modelPath(id);
    const tmp = `${dest}.part`;
    const res = await fetchFn(MODEL_URL + MODELS[id].file);
    if (!res.ok || !res.body) throw new Error(`Téléchargement du modèle impossible (${res.status})`);
    const total = Number(res.headers.get('content-length')) || MODELS[id].size;
    const out = fs.createWriteStream(tmp);
    const reader = res.body.getReader();
    let got = 0;
    let last = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
        if (onProgress && got - last > 1 << 20) {
          last = got;
          onProgress(Math.min(1, got / total));
        }
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    if (got < 1e6) {
      await fsp.rm(tmp, { force: true });
      throw new Error('Modèle incomplet, réessaie.');
    }
    await fsp.rename(tmp, dest);
    if (onProgress) onProgress(1);
    return dest;
  })();
  try {
    return await downloads[id];
  } finally {
    delete downloads[id];
  }
}

// Mots lus dans le JSON de Whisper (« -ml 1 -sow » : un mot par segment, temps en ms).
function parseWords(json) {
  const list = (json && json.transcription) || [];
  return list
    .map((x) => ({ w: String(x.text || '').trim(), t0: (x.offsets ? x.offsets.from : 0) / 1000, t1: (x.offsets ? x.offsets.to : 0) / 1000 }))
    .filter((x) => x.w && !/^\[.*\]$|^\(.*\)$|^♪+$|^\*.*\*$/.test(x.w) && x.t1 >= x.t0);
}

function runWhisper(args, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const exe = enginePath();
    if (!exe) return reject(new Error('Moteur de transcription introuvable : réinstalle Coffile.'));
    const proc = spawn(exe, args, { windowsHide: true, cwd: path.dirname(exe) });
    let err = '';
    let buf = '';
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      if (err.length < 100000) err += s;
      buf += s;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) {
        const m = l.match(/progress\s*=\s*(\d+)%/);
        if (m && onProgress) onProgress(Number(m[1]) / 100);
      }
    });
    proc.stdout.on('data', () => {});
    const abort = () => proc.kill();
    if (signal) signal.addEventListener('abort', abort, { once: true });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', abort);
      if (code === 0) resolve();
      else reject(new Error(signal && signal.aborted ? 'annulé' : err.split('\n').filter(Boolean).slice(-2).join(' ') || `Whisper a échoué (${code})`));
    });
  });
}

// Mots d'un rush : [{ w, t0, t1 }] en secondes dans le rush (en cache ensuite).
async function transcribe(file, { model = 'small', language = 'fr', onProgress, signal } = {}) {
  const st = await fsp.stat(file);
  const key = crypto.createHash('sha1').update(`${path.resolve(file)}|${st.size}|${Math.round(st.mtimeMs)}|${model}|${language}`).digest('hex');
  const cached = path.join(base, 'cache', `${key}.json`);
  try {
    return JSON.parse(await fsp.readFile(cached, 'utf8'));
  } catch {}
  if (!fs.existsSync(modelPath(model))) throw new Error('Modèle de transcription pas encore téléchargé.');
  const wav = path.join(base, 'tmp', `${key}.wav`);
  const outBase = path.join(base, 'tmp', key);
  try {
    // Son du rush en 16 kHz mono (ce que Whisper attend).
    const conv = await autoedit.ffmpeg(['-v', 'error', '-nostdin', '-y', '-i', file, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], { signal });
    if (conv.code !== 0 || !fs.existsSync(wav)) {
      const res = { words: [], noAudio: true };
      await fsp.writeFile(cached, JSON.stringify(res));
      return res;
    }
    const threads = Math.max(2, Math.min(8, os.cpus().length - 1));
    await runWhisper(['-m', modelPath(model), '-f', wav, '-l', language || 'auto', '-ml', '1', '-sow', '-oj', '-of', outBase, '-t', String(threads), '-np', '-pp'], { onProgress, signal });
    const json = JSON.parse(await fsp.readFile(`${outBase}.json`, 'utf8'));
    const res = { words: parseWords(json), language: (json.result && json.result.language) || language };
    await fsp.writeFile(cached, JSON.stringify(res));
    return res;
  } finally {
    await fsp.rm(wav, { force: true });
    await fsp.rm(`${outBase}.json`, { force: true });
  }
}

module.exports = { init, status, downloadModel, transcribe, parseWords, enginePath, MODELS };
