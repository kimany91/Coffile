'use strict';
// Renommage groupé des exports (Auto rename), en deux temps pour gérer les échanges de noms
// (A -> B et B -> A) sans jamais écraser un fichier existant.
const fsp = require('fs/promises');
const path = require('path');
const { sanitizeName } = require('./drive');

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

// ops : [{ from: chemin complet, to: nouveau nom de fichier }]
// isAllowed(chemin) : le fichier doit être dans le dossier des projets.
async function renameExports(ops, isAllowed) {
  const plan = [];
  const errors = [];
  const sources = new Set(ops.map((o) => path.resolve(o.from).toLowerCase()));
  const targets = new Set();
  for (const op of ops) {
    const from = path.resolve(op.from);
    const name = sanitizeName(op.to);
    const to = path.join(path.dirname(from), name);
    if (!isAllowed(from)) {
      errors.push({ from, error: 'Fichier hors du dossier des projets' });
      continue;
    }
    if (!(await exists(from))) {
      errors.push({ from, error: 'Fichier introuvable' });
      continue;
    }
    if (to === from) continue;
    const key = to.toLowerCase();
    if (targets.has(key)) {
      errors.push({ from, error: `Nom en double : ${name}` });
      continue;
    }
    // Une cible existante n'est acceptée que si elle est elle-même renommée dans ce lot.
    if (key !== from.toLowerCase() && !sources.has(key) && (await exists(to))) {
      errors.push({ from, error: `Un fichier ${name} existe déjà` });
      continue;
    }
    targets.add(key);
    plan.push({ from, to, tmp: `${from}.filedit-rename` });
  }

  const done = [];
  // 1) noms temporaires
  for (const p of plan) {
    try {
      await fsp.rename(p.from, p.tmp);
      p.moved = true;
    } catch (e) {
      errors.push({ from: p.from, error: e.code === 'EBUSY' || e.code === 'EPERM' ? 'Fichier ouvert dans un autre logiciel' : e.message });
    }
  }
  // 2) noms définitifs
  for (const p of plan.filter((x) => x.moved)) {
    try {
      await fsp.rename(p.tmp, p.to);
      done.push({ from: p.from, to: p.to });
    } catch (e) {
      await fsp.rename(p.tmp, p.from).catch(() => {});
      errors.push({ from: p.from, error: e.message });
    }
  }
  return { done, errors };
}

module.exports = { renameExports };
