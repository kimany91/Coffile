'use strict';
// Entraîne le réseau de neurones de Coffile et l'enregistre dans src/nlp/model.json.
//   node tools/train-nlp.js
// Deux réseaux : « phrase » (tâche, date limite, envoi, retour, urgent, salutation, info)
// et « message » (demande de montage ou non).
const fs = require('fs');
const path = require('path');
const { Net, Adam, features, setSeed, rand } = require('../src/nlp/nn');
const { sentenceData, messageData, LABELS } = require('./nlp-data');

const DIM = 4096;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function train(net, data, { epochs, lr }) {
  const adam = new Adam(net, { lr });
  const feats = data.map((d) => features(d.text, net.dim));
  const order = data.map((_, i) => i);
  for (let e = 0; e < epochs; e++) {
    shuffle(order);
    let loss = 0;
    for (const i of order) {
      loss += net.step(feats[i], data[i].y, { adam, l2: 1e-6 });
      adam.tick();
    }
    console.log(`  époque ${e + 1}/${epochs} : perte moyenne ${(loss / data.length).toFixed(4)}`);
  }
}

function evaluate(net, data) {
  const stats = {};
  for (const l of net.labels) stats[l] = { tp: 0, fp: 0, fn: 0, ok: 0, n: 0 };
  for (const d of data) {
    const p = net.predict(d.text);
    for (const l of net.labels) {
      const t = d.y[l] >= 0.75 ? 1 : d.y[l] <= 0.25 ? 0 : null;
      if (t == null) continue;
      const yhat = p[l] >= 0.5 ? 1 : 0;
      const s = stats[l];
      s.n++;
      if (yhat === t) s.ok++;
      if (yhat && t) s.tp++;
      if (yhat && !t) s.fp++;
      if (!yhat && t) s.fn++;
    }
  }
  const out = {};
  for (const [l, s] of Object.entries(stats)) {
    const prec = s.tp / Math.max(1, s.tp + s.fp);
    const rec = s.tp / Math.max(1, s.tp + s.fn);
    out[l] = { exactitude: +(s.ok / Math.max(1, s.n)).toFixed(3), f1: +((2 * prec * rec) / Math.max(1e-9, prec + rec)).toFixed(3) };
  }
  return out;
}

setSeed(20261028);
console.log('Génération des exemples…');
const sTrain = sentenceData(40000);
const sTest = sentenceData(4000);
const mTrain = messageData(10000);
const mTest = messageData(1500);

console.log('Réseau « phrase »');
const sentenceNet = new Net({ dim: DIM, hidden: 32, labels: LABELS });
train(sentenceNet, sTrain, { epochs: 4, lr: 0.003 });
const sStats = evaluate(sentenceNet, sTest);
console.log(sStats);

console.log('Réseau « message »');
const messageNet = new Net({ dim: DIM, hidden: 16, labels: ['montage'] });
train(messageNet, mTrain, { epochs: 4, lr: 0.003 });
const mStats = evaluate(messageNet, mTest);
console.log(mStats);

const out = {
  version: 1,
  trainedAt: new Date().toISOString().slice(0, 10),
  examples: { phrases: sTrain.length, messages: mTrain.length },
  stats: { phrase: sStats, message: mStats },
  sentence: sentenceNet.toJSON(),
  message: messageNet.toJSON()
};
const file = path.join(__dirname, '..', 'src', 'nlp', 'model.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log(`Enregistré : ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} Ko)`);
