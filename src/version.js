'use strict';
// Numéros de version « 1.7.11 » : comparaison (sans dépendance, pour l'app installée).
const parse = (v) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const valid = (v) => !!parse(v);
function compare(a, b) {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return NaN;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
const gt = (a, b) => compare(a, b) > 0;
const lte = (a, b) => compare(a, b) <= 0;

// latest-mac.yml (écrit par electron-builder) : version, et la liste des fichiers (url, sha512, size).
function parseLatestYml(text) {
  const out = { files: [] };
  let cur = null;
  let inFiles = false;
  const val = (s) => s.trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const top = /^([A-Za-z]\w*):\s*(.*)$/.exec(line);
    if (top) {
      inFiles = top[1] === 'files';
      if (!inFiles) out[top[1]] = val(top[2]);
      continue;
    }
    if (!inFiles) continue;
    const item = /^\s*-\s+(\w+):\s*(.*)$/.exec(line);
    const field = /^\s+(\w+):\s*(.*)$/.exec(line);
    if (item) {
      cur = { [item[1]]: val(item[2]) };
      out.files.push(cur);
    } else if (field && cur) cur[field[1]] = val(field[2]);
  }
  for (const f of out.files) if (f.size) f.size = Number(f.size);
  return out;
}

module.exports = { valid, compare, gt, lte, parseLatestYml };
