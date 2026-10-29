'use strict';
// Exports vidéo : détection, version (V1, V2.1, VF…) et format (résolution, ratio, durée, codec).
const fsp = require('fs/promises');
const path = require('path');

// ---------- Détection ----------
const EXPORT_DIR = /(^|[\s_\-.])(exports?|rendus?|renders?|outputs?|livrables?|deliver(y|ables)?|finals?|diffusions?|masters?|sorties?|publi(é|e)s?)([\s_\-.]|$)/i;
const NOT_EXPORT_DIR = /(^|[\s_\-.])(rush(es)?|raw|footage|sources?|cam(era)?|drone|b-?roll|proxy|proxies|previews?|cache|auto-save|media cache( files)?|video previews|transcoded|images|musique|music|sound effects?|sfx|template)([\s_\-.\d]|$)/i;

// Sous-version uniquement avec un point (« v1.2 ») : « V1_9x16 » = V1 en 9:16, pas V1.9.
const VERSION_RE = /(?:^|[\s_\-.(\[])((?:v|ver|version)[\s_\-]?(\d{1,3})(?:\.(\d{1,2})(?![x×:]\d))?)(?=$|[\s_\-.)\]a-z])/i;
const FINAL_RE = /(?:^|[\s_\-.(\[])(vf|final|finale|def|d[ée]finiti(?:f|ve)|master|livraison)(?=$|[\s_\-.)\]])/i;
// Date au format JJMMAA ou JJMMAAAA (ajoutée par l'Auto rename) : ignorée pour regrouper les versions.
const DATE_RE = /(?:^|[\s_\-.])\d{6}(?:\d{2})?(?=$|[\s_\-.])/g;

function parseVersion(fileName) {
  const base = fileName.replace(/\.[^.]+$/, '');
  const m = base.match(VERSION_RE);
  const f = base.match(FINAL_RE);
  const major = m ? Number(m[2]) : null;
  const minor = m && m[3] != null ? Number(m[3]) : null;
  const final = !!f;
  let label = null;
  if (major != null) label = `V${major}${minor != null ? '.' + minor : ''}`;
  if (final) label = label ? `${label} · FINAL` : 'VF';
  // « Famille » : le nom sans la version, pour regrouper V1, V2, V3 d'un même montage.
  let family = base;
  if (m) family = family.replace(m[0], ' ');
  if (f) family = family.replace(f[0], ' ');
  family = family.replace(DATE_RE, ' ');
  // Libellé lisible de la famille (casse d'origine conservée).
  const familyLabel = family.replace(/^[\s_\-.]+|[\s_\-.]+$/g, '').replace(/([\s_\-.])[\s_\-.]+/g, '$1') || base;
  family = family.replace(/[\s_\-.()\[\]]+/g, ' ').trim().toLowerCase() || base.toLowerCase();
  const rank = (final ? 1e6 : 0) + (major != null ? major * 1000 + (minor || 0) : 0);
  // Intitulé de version tel qu'écrit par l'utilisateur (« v2 », « V3_FINAL »…), pour l'Auto rename.
  const raw = [m && m[1], f && f[1]].filter(Boolean).join('_') || null;
  return { label, major, minor, final, rank, family, familyLabel, raw, hasToken: !!(m || f) };
}

function isExport(relDirs, name, category) {
  if (category !== 'video') return false;
  if (relDirs.some((d) => NOT_EXPORT_DIR.test(d))) return false;
  if (relDirs.some((d) => EXPORT_DIR.test(d))) return true;
  if (parseVersion(name).hasToken) return true;
  // Vidéo posée à la racine du projet ou dans MONTAGE : c'est un rendu.
  return relDirs.length === 0 || /^montage$/i.test(relDirs[0]);
}

// ---------- Format ----------
const RATIOS = [
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['1:1', 1],
  ['4:5', 4 / 5],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['21:9', 2.37],
  ['1.9:1', 256 / 135],
  ['2:1', 2],
  ['1.85:1', 1.85]
];

function aspectOf(w, h) {
  if (!w || !h) return null;
  const r = w / h;
  let best = null;
  for (const [label, v] of RATIOS) {
    const d = Math.abs(r - v) / v;
    if (d < 0.035 && (!best || d < best.d)) best = { label, d };
  }
  return best ? best.label : `${w}×${h}`;
}

function aspectFromName(name) {
  if (/(^|[^0-9])9[x×_\-:]16([^0-9]|$)|vertical|verticale|story|stories|reels?|tiktok|shorts?/i.test(name)) return '9:16';
  if (/(^|[^0-9])16[x×_\-:]9([^0-9]|$)|horizontal|paysage|youtube/i.test(name)) return '16:9';
  if (/(^|[^0-9])1[x×_\-:]1([^0-9]|$)|carr[ée]|square/i.test(name)) return '1:1';
  if (/(^|[^0-9])4[x×_\-:]5([^0-9]|$)|portrait/i.test(name)) return '4:5';
  return null;
}

function resolutionLabel(w, h) {
  if (!w || !h) return null;
  const s = Math.min(w, h);
  if (s >= 4320) return '8K';
  if (s >= 2160) return '4K';
  if (s >= 1440) return '1440p';
  if (s >= 1080) return '1080p';
  if (s >= 720) return '720p';
  return `${s}p`;
}

const CODECS = {
  avc1: 'H.264', avc3: 'H.264', hvc1: 'H.265', hev1: 'H.265', av01: 'AV1', vp09: 'VP9',
  apco: 'ProRes Proxy', apcs: 'ProRes LT', apcn: 'ProRes 422', apch: 'ProRes HQ', ap4h: 'ProRes 4444', ap4x: 'ProRes 4444 XQ',
  'mp4v': 'MPEG-4', dvh1: 'Dolby Vision', dnxh: 'DNxHD/HR', jpeg: 'Motion JPEG'
};

// Lecture des boîtes MP4/MOV (moov > trak > tkhd / stsd, mvhd) sans dépendance.
function* boxes(buf, start, end) {
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    let header = 8;
    if (size === 1) {
      if (off + 16 > end) return;
      size = Number(buf.readBigUInt64BE(off + 8));
      header = 16;
    } else if (size === 0) size = end - off;
    if (size < header || off + size > end) return;
    yield { type, start: off + header, end: off + size };
    off += size;
  }
}

function child(buf, box, type) {
  for (const b of boxes(buf, box.start, box.end)) if (b.type === type) return b;
  return null;
}

function parseMoov(buf) {
  const moov = { start: 0, end: buf.length };
  const out = {};
  const mvhd = child(buf, moov, 'mvhd');
  if (mvhd) {
    const v = buf[mvhd.start];
    const ts = v === 1 ? buf.readUInt32BE(mvhd.start + 20) : buf.readUInt32BE(mvhd.start + 12);
    const dur = v === 1 ? Number(buf.readBigUInt64BE(mvhd.start + 24)) : buf.readUInt32BE(mvhd.start + 16);
    if (ts) out.duration = dur / ts;
  }
  for (const trak of boxes(buf, moov.start, moov.end)) {
    if (trak.type !== 'trak') continue;
    const mdia = child(buf, trak, 'mdia');
    const hdlr = mdia && child(buf, mdia, 'hdlr');
    if (!hdlr || buf.toString('latin1', hdlr.start + 8, hdlr.start + 12) !== 'vide') continue;
    const tkhd = child(buf, trak, 'tkhd');
    if (tkhd) {
      const v = buf[tkhd.start];
      const base = tkhd.start + (v === 1 ? 52 : 40); // début de la matrice
      const a = buf.readInt32BE(base);
      const b = buf.readInt32BE(base + 4);
      let w = Math.round(buf.readUInt32BE(base + 36) / 65536);
      let h = Math.round(buf.readUInt32BE(base + 40) / 65536);
      if (a === 0 && Math.abs(b) === 65536) [w, h] = [h, w]; // vidéo tournée de 90°
      out.width = w;
      out.height = h;
    }
    const minf = child(buf, mdia, 'minf');
    const stbl = minf && child(buf, minf, 'stbl');
    const stsd = stbl && child(buf, stbl, 'stsd');
    if (stsd && stsd.start + 16 <= stsd.end) {
      const fourcc = buf.toString('latin1', stsd.start + 12, stsd.start + 16);
      out.codec = CODECS[fourcc] || fourcc.trim().toUpperCase();
    }
    break;
  }
  return out;
}

async function probeMp4(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const head = Buffer.alloc(16);
    let off = 0;
    for (let i = 0; i < 64 && off + 8 <= size; i++) {
      await fh.read(head, 0, 16, off);
      let boxSize = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      let header = 8;
      if (boxSize === 1) {
        boxSize = Number(head.readBigUInt64BE(8));
        header = 16;
      } else if (boxSize === 0) boxSize = size - off;
      if (boxSize < 8) break;
      if (type === 'moov') {
        const len = boxSize - header;
        if (len > 128 * 1024 * 1024) return {};
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, off + header);
        return parseMoov(buf);
      }
      off += boxSize;
    }
    return {};
  } finally {
    await fh.close();
  }
}

const cache = new Map();

// Métadonnées d'un export (mises en cache tant que le fichier ne change pas).
async function probe(file, size, mtime) {
  const key = `${file}|${size}|${mtime}`;
  if (cache.has(key)) return cache.get(key);
  let meta = {};
  if (/\.(mp4|mov|m4v|3gp)$/i.test(file)) {
    try {
      meta = await probeMp4(file);
    } catch {
      meta = {};
    }
  }
  cache.set(key, meta);
  return meta;
}

async function describeExport(e) {
  const meta = await probe(e.path, e.size, e.mtime);
  const v = parseVersion(e.name);
  const aspect = aspectOf(meta.width, meta.height) || aspectFromName(e.name);
  return {
    ...e,
    ext: path.extname(e.name).slice(1).toUpperCase() || '?',
    width: meta.width || null,
    height: meta.height || null,
    duration: meta.duration || null,
    codec: meta.codec || null,
    resolution: resolutionLabel(meta.width, meta.height),
    aspect: aspect || 'Inconnu',
    version: v.label,
    versionRank: v.rank,
    final: v.final,
    family: v.family,
    familyLabel: v.familyLabel,
    versionRaw: v.raw
  };
}

module.exports = { parseVersion, isExport, aspectOf, aspectFromName, probeMp4, probe, describeExport };
