'use strict';
// Petit réseau de neurones (perceptron à une couche cachée), écrit pour Coffile, sans
// bibliothèque ni service en ligne. Il lit une phrase ou un message sous forme de « sacs » de
// mots, de paires de mots et de morceaux de 3-4 lettres (ce qui lui fait reconnaître les fautes
// de frappe et les abréviations), et donne une probabilité pour chaque étiquette.
// Il est entraîné par tools/train-nlp.js, et peut continuer d'apprendre sur le PC (tes choix).
const { normalize } = require('./normalize');

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Caractéristiques creuses : { idx: Int32Array, val: Float32Array }, normalisées (longueur 1).
function features(text, dim) {
  const norm = normalize(text);
  const words = norm.split(/[^a-z0-9']+/).filter(Boolean).slice(0, 400);
  const map = new Map();
  const add = (key, w) => {
    const i = fnv(key) % dim;
    map.set(i, (map.get(i) || 0) + w);
  };
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    add(`w:${w}`, 1);
    if (k + 1 < words.length) add(`b:${w} ${words[k + 1]}`, 0.8);
    if (w.length > 2 && !/^\d+$/.test(w)) {
      const p = `<${w}>`;
      for (let n = 3; n <= 4; n++) for (let i = 0; i + n <= p.length; i++) add(`c:${p.substr(i, n)}`, 0.35);
    }
  }
  if (!map.size) add('vide', 1);
  let norm2 = 0;
  for (const v of map.values()) norm2 += v * v;
  const inv = 1 / Math.sqrt(norm2);
  const idx = new Int32Array(map.size);
  const val = new Float32Array(map.size);
  let j = 0;
  for (const [i, v] of map) {
    idx[j] = i;
    val[j++] = v * inv;
  }
  return { idx, val };
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

class Net {
  constructor({ dim = 4096, hidden = 32, labels = [], W1, b1, W2, b2 } = {}) {
    this.dim = dim;
    this.hidden = hidden;
    this.labels = labels;
    const L = labels.length;
    this.W1 = W1 || randn(dim * hidden, Math.sqrt(2 / 60));
    this.b1 = b1 || new Float32Array(hidden);
    this.W2 = W2 || randn(hidden * L, Math.sqrt(1 / hidden));
    this.b2 = b2 || new Float32Array(L);
  }

  forward(f) {
    const H = this.hidden;
    const L = this.labels.length;
    const h = new Float32Array(H);
    h.set(this.b1);
    for (let k = 0; k < f.idx.length; k++) {
      const row = f.idx[k] * H;
      const v = f.val[k];
      for (let j = 0; j < H; j++) h[j] += this.W1[row + j] * v;
    }
    for (let j = 0; j < H; j++) if (h[j] < 0) h[j] = 0;
    const p = new Float32Array(L);
    for (let l = 0; l < L; l++) {
      let z = this.b2[l];
      for (let j = 0; j < H; j++) z += this.W2[j * L + l] * h[j];
      p[l] = sigmoid(z);
    }
    return { h, p };
  }

  predict(text) {
    const { p } = this.forward(features(text, this.dim));
    const out = {};
    this.labels.forEach((l, i) => (out[l] = p[i]));
    return out;
  }

  // Une étape d'apprentissage (entropie croisée, descente de gradient).
  // y : { étiquette: 0|1 } ; onlyOutput : n'ajuste que la dernière couche (apprentissage sur le PC).
  step(f, y, { lr = 0.05, l2 = 1e-5, onlyOutput = false, adam = null } = {}) {
    const H = this.hidden;
    const L = this.labels.length;
    const { h, p } = this.forward(f);
    const dz = new Float32Array(L);
    let loss = 0;
    for (let l = 0; l < L; l++) {
      const t = y[this.labels[l]];
      if (t == null) continue;
      dz[l] = p[l] - t;
      loss -= t ? Math.log(p[l] + 1e-7) : Math.log(1 - p[l] + 1e-7);
    }
    const dh = new Float32Array(H);
    for (let j = 0; j < H; j++) {
      if (h[j] <= 0) continue;
      let s = 0;
      for (let l = 0; l < L; l++) s += this.W2[j * L + l] * dz[l];
      dh[j] = s;
    }
    const upd = adam ? (arr, i, g, key) => adam.update(arr, i, g, key) : (arr, i, g) => (arr[i] -= lr * g);
    for (let j = 0; j < H; j++) for (let l = 0; l < L; l++) upd(this.W2, j * L + l, dz[l] * h[j] + l2 * this.W2[j * L + l], 'W2');
    for (let l = 0; l < L; l++) upd(this.b2, l, dz[l], 'b2');
    if (!onlyOutput) {
      for (let k = 0; k < f.idx.length; k++) {
        const row = f.idx[k] * H;
        const v = f.val[k];
        for (let j = 0; j < H; j++) if (dh[j]) upd(this.W1, row + j, dh[j] * v, 'W1');
      }
      for (let j = 0; j < H; j++) if (dh[j]) upd(this.b1, j, dh[j], 'b1');
    }
    return loss;
  }

  toJSON() {
    const b64 = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
    return { dim: this.dim, hidden: this.hidden, labels: this.labels, W1: b64(this.W1), b1: b64(this.b1), W2: b64(this.W2), b2: b64(this.b2) };
  }

  static fromJSON(o) {
    const f32 = (s) => {
      const buf = Buffer.from(s, 'base64');
      return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    };
    return new Net({ dim: o.dim, hidden: o.hidden, labels: o.labels, W1: f32(o.W1), b1: f32(o.b1), W2: f32(o.W2), b2: f32(o.b2) });
  }
}

// Adam « paresseux » : seules les cases touchées par l'exemple sont mises à jour.
class Adam {
  constructor(net, { lr = 0.005, b1 = 0.9, b2 = 0.999 } = {}) {
    this.lr = lr;
    this.b1 = b1;
    this.b2 = b2;
    this.t = 1;
    this.m = { W1: new Float32Array(net.W1.length), b1: new Float32Array(net.b1.length), W2: new Float32Array(net.W2.length), b2: new Float32Array(net.b2.length) };
    this.v = { W1: new Float32Array(net.W1.length), b1: new Float32Array(net.b1.length), W2: new Float32Array(net.W2.length), b2: new Float32Array(net.b2.length) };
  }

  tick() {
    this.t++;
  }

  update(arr, i, g, key) {
    const m = this.m[key];
    const v = this.v[key];
    m[i] = this.b1 * m[i] + (1 - this.b1) * g;
    v[i] = this.b2 * v[i] + (1 - this.b2) * g * g;
    const mh = m[i] / (1 - Math.pow(this.b1, this.t));
    const vh = v[i] / (1 - Math.pow(this.b2, this.t));
    arr[i] -= (this.lr * mh) / (Math.sqrt(vh) + 1e-8);
  }
}

// Petit générateur aléatoire reproductible (même entraînement à chaque fois).
let seed = 12345;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
function setSeed(s) {
  seed = s >>> 0;
}
function randn(n, scale) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = rand() || 1e-9;
    const v = rand();
    a[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * scale;
  }
  return a;
}

module.exports = { Net, Adam, features, fnv, rand, setSeed };
