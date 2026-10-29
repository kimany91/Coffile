'use strict';
// Notes : chaque feuille est un fichier texte (.txt, UTF-8) dans le dossier des notes.
// La mise en forme est écrite en texte lisible :
//   # Titre      ## Sous-titre      **gras**      {#E8772E}texte en couleur{/}
//   [Nom](<projet:C:\…\x.prproj>)  [Nom](<fichier:…>)  [Nom](<dossier:…>)  [Nom](<export:…>)
//   ![](<image:images/xxx.png>)  (chemin relatif au dossier des notes)
const fsp = require('fs/promises');
const path = require('path');
const { sanitizeName } = require('./drive');

const EXT = '.txt';

function fileOf(dir, name) {
  const clean = sanitizeName(name);
  const file = path.join(dir, clean + EXT);
  // Jamais en dehors du dossier des notes.
  if (path.dirname(file) !== path.resolve(dir)) throw new Error('Nom de note invalide.');
  return file;
}

async function list(dir) {
  await fsp.mkdir(dir, { recursive: true });
  const out = [];
  for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
    if (!ent.isFile() || path.extname(ent.name).toLowerCase() !== EXT) continue;
    const file = path.join(dir, ent.name);
    try {
      const st = await fsp.stat(file);
      const text = (await fsp.readFile(file, 'utf8')).slice(0, 400);
      out.push({ name: ent.name.slice(0, -EXT.length), mtime: st.mtimeMs, size: st.size, preview: plainPreview(text) });
    } catch {}
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// Aperçu sans la mise en forme.
function plainPreview(text) {
  return text
    .replace(/!\[[^\]]*\]\(<image:[^>]*>\)/g, '🖼')
    .replace(/\[([^\]]*)\]\(<(?:projet|fichier|dossier|export):[^>]*>\)/g, '$1')
    .replace(/\{#[0-9a-fA-F]{6}\}|\{\/\}|\*\*/g, '')
    .replace(/^#{1,2} /gm, '')
    .replace(/\\(.)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

async function read(dir, name) {
  try {
    return await fsp.readFile(fileOf(dir, name), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return '';
    throw e;
  }
}

// Écriture sûre : fichier temporaire puis remplacement.
async function save(dir, name, content) {
  await fsp.mkdir(dir, { recursive: true });
  const file = fileOf(dir, name);
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, String(content), 'utf8');
  await fsp.rename(tmp, file);
  const st = await fsp.stat(file);
  return { name, mtime: st.mtimeMs };
}

async function exists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

async function uniqueName(dir, base, except = null) {
  const clean = sanitizeName(base || 'Nouvelle note');
  for (let i = 1; ; i++) {
    const name = i === 1 ? clean : `${clean} ${i}`;
    if (except && name.toLowerCase() === except.toLowerCase()) return name;
    if (!(await exists(fileOf(dir, name)))) return name;
  }
}

async function create(dir, base) {
  await fsp.mkdir(dir, { recursive: true });
  const name = await uniqueName(dir, base || 'Nouvelle note');
  await fsp.writeFile(fileOf(dir, name), '', { encoding: 'utf8', flag: 'wx' });
  return name;
}

async function rename(dir, from, to) {
  const wanted = sanitizeName(to || '');
  if (!wanted || wanted === 'sans_nom') throw new Error('Donne un nom à la note.');
  if (wanted === from) return from;
  const name = await uniqueName(dir, wanted, from);
  const src = fileOf(dir, from);
  const dest = fileOf(dir, name);
  if (src.toLowerCase() === dest.toLowerCase()) {
    // Changement de majuscules seulement (Windows ne distingue pas) : en deux temps.
    const tmp = `${src}.renommage`;
    await fsp.rename(src, tmp);
    await fsp.rename(tmp, dest);
  } else await fsp.rename(src, dest);
  return name;
}

module.exports = { list, read, save, create, rename, fileOf, plainPreview };
