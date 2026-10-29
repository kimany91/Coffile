'use strict';
// Analyse du dossier des projets : chaque sous-dossier est un projet,
// qu'il ait été créé par Coffile ou non.
const fsp = require('fs/promises');
const path = require('path');
const { categoryOf } = require('./drive');
const { isExport, describeExport, parseVersion } = require('./media');

// Formats lisibles directement dans l'app (aperçus et miniatures).
const PLAYABLE = /\.(mp4|m4v|mov|webm)$/i;
const PICTURE = /\.(jpe?g|png|webp|avif)$/i;

const MAX_FILES = 200000;
const SKIP_DIRS = /^(\$recycle\.bin|system volume information|node_modules|\.git)$/i;

async function scanProject(dir) {
  const st = await fsp.stat(dir);
  const totals = { video: { count: 0, bytes: 0 }, image: { count: 0, bytes: 0 }, audio: { count: 0, bytes: 0 }, other: { count: 0, bytes: 0 } };
  const folders = new Map(); // dossier de 1er niveau -> { count, bytes }
  const prproj = [];
  const exports = [];
  let coverRush = null; // 1re vidéo lisible hors exports (pour la miniature)
  let coverImage = null;
  let files = 0;
  let bytes = 0;
  let lastModified = 0;
  let truncated = false;

  const walk = async (d, rel) => {
    let entries;
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files >= MAX_FILES) {
        truncated = true;
        return;
      }
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.test(e.name)) continue;
        await walk(full, rel.concat(e.name));
        continue;
      }
      if (!e.isFile() || /^(desktop\.ini|thumbs\.db|\.ds_store)$/i.test(e.name)) continue;
      let s;
      try {
        s = await fsp.stat(full);
      } catch {
        continue;
      }
      files++;
      bytes += s.size;
      if (s.mtimeMs > lastModified) lastModified = s.mtimeMs;
      if (/\.prproj$/i.test(e.name)) {
        if (!/auto-save/i.test(full)) prproj.push({ path: full, name: e.name, mtime: s.mtimeMs });
      } else {
        const cat = categoryOf(e.name);
        const t = totals[cat];
        t.count++;
        t.bytes += s.size;
        // created : date de création de l'export (la plus ancienne entre création et modification,
        // une copie de fichier pouvant réinitialiser la date de création).
        const item = { path: full, name: e.name, rel, size: s.size, mtime: s.mtimeMs, created: Math.min(s.birthtimeMs || s.mtimeMs, s.mtimeMs) };
        if (isExport(rel, e.name, cat)) exports.push(item);
        else if (cat === 'video' && PLAYABLE.test(e.name) && !/proxy|preview/i.test(rel.join('/')) && (!coverRush || full < coverRush.path)) coverRush = item;
        else if (cat === 'image' && PICTURE.test(e.name) && (!coverImage || full < coverImage.path)) coverImage = item;
      }
      const key = rel[0] || '';
      const f = folders.get(key) || { count: 0, bytes: 0 };
      f.count++;
      f.bytes += s.size;
      folders.set(key, f);
    }
  };
  await walk(dir, []);
  if (!lastModified) lastModified = st.mtimeMs;

  // Inclut aussi les dossiers vides de 1er niveau (MUSIQUE vide, etc.).
  try {
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !SKIP_DIRS.test(e.name) && !folders.has(e.name)) folders.set(e.name, { count: 0, bytes: 0 });
    }
  } catch {}

  prproj.sort((a, b) => {
    const am = /[\\/]MONTAGE[\\/]/i.test(a.path) ? 0 : 1;
    const bm = /[\\/]MONTAGE[\\/]/i.test(b.path) ? 0 : 1;
    return am - bm || b.mtime - a.mtime;
  });

  // Dernière version exportée : version la plus haute, puis la plus récente.
  let latestExport = null;
  for (const e of exports) {
    const v = parseVersion(e.name);
    const cand = { ...e, version: v.label, versionRank: v.rank, playable: PLAYABLE.test(e.name) };
    if (!latestExport || cand.versionRank > latestExport.versionRank || (cand.versionRank === latestExport.versionRank && cand.mtime > latestExport.mtime)) latestExport = cand;
  }

  return {
    name: path.basename(dir),
    latestExport,
    coverRush,
    coverImage,
    dir,
    created: st.birthtimeMs || st.ctimeMs,
    modified: lastModified,
    files,
    bytes,
    totals,
    prproj,
    exports,
    truncated,
    folders: [...folders.entries()]
      .map(([name, v]) => ({ name: name || '(racine)', ...v }))
      .sort((a, b) => (a.name === '(racine)') - (b.name === '(racine)') || b.bytes - a.bytes || a.name.localeCompare(b.name))
  };
}

async function scanLibrary(root) {
  if (!root) return [];
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.test(e.name)).map((e) => path.join(root, e.name));
  const out = [];
  const queue = dirs.slice();
  const worker = async () => {
    while (queue.length) {
      const d = queue.shift();
      try {
        out.push(await scanProject(d));
      } catch {}
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return out.sort((a, b) => b.modified - a.modified);
}

// Tous les exports de tous les projets, avec version et format.
async function scanExports(root) {
  const lib = await scanLibrary(root);
  const flat = [];
  for (const p of lib) for (const e of p.exports) flat.push({ ...e, project: p.name, projectDir: p.dir });
  const out = [];
  const queue = flat.slice();
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (queue.length) out.push(await describeExport(queue.shift()));
    })
  );
  return out;
}

module.exports = { scanLibrary, scanProject, scanExports };
