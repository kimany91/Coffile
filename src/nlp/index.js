'use strict';
// Accès au réseau de neurones de Coffile (entraîné par tools/train-nlp.js, livré avec l'app).
// Le réseau « message » continue d'apprendre sur le PC à partir de tes choix ; sa version
// personnelle est enregistrée dans le dossier de l'app.
const fs = require('fs');
const path = require('path');
const { Net, features } = require('./nn');

let sentenceNet = null;
let messageNet = null;
let userFile = null;
let saveTimer = null;
let info = null;

function load() {
  if (sentenceNet) return;
  try {
    const model = JSON.parse(fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8'));
    sentenceNet = Net.fromJSON(model.sentence);
    messageNet = Net.fromJSON(model.message);
    info = { trainedAt: model.trainedAt, examples: model.examples, learned: 0 };
    if (userFile) {
      try {
        const mine = JSON.parse(fs.readFileSync(userFile, 'utf8'));
        if (mine.dim === messageNet.dim && mine.hidden === messageNet.hidden) {
          messageNet = Net.fromJSON(mine);
          info.learned = mine.learned || 0;
        }
      } catch {}
    }
  } catch {
    sentenceNet = null;
    messageNet = null;
  }
}

// À appeler au démarrage : dossier où garder la version personnelle du réseau.
function init(userDir) {
  userFile = path.join(userDir, 'reseau-neurones.json');
  sentenceNet = null;
  messageNet = null;
  load();
}

// Probabilités pour une phrase : { tache, delai, envoi, retour, urgent, salut, info }.
function sentence(text) {
  load();
  return sentenceNet ? sentenceNet.predict(text) : null;
}

// Probabilité qu'un message soit une demande de montage.
function montage(text) {
  load();
  return messageNet ? messageNet.predict(text).montage : null;
}

// Apprentissage sur le PC : quelques petits pas sur ce message, sans tout réentraîner.
function learn(text, positive) {
  load();
  if (!messageNet || !text) return;
  const f = features(text, messageNet.dim);
  for (let i = 0; i < 6; i++) messageNet.step(f, { montage: positive ? 1 : 0 }, { lr: 0.08 });
  info.learned = (info.learned || 0) + 1;
  if (!userFile) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const out = { ...messageNet.toJSON(), learned: info.learned };
    fs.promises.writeFile(userFile, JSON.stringify(out)).catch(() => {});
  }, 1000);
}

function reset() {
  if (userFile) fs.rmSync(userFile, { force: true });
  sentenceNet = null;
  messageNet = null;
  load();
}

function stats() {
  load();
  return info;
}

module.exports = { init, sentence, montage, learn, reset, stats };
