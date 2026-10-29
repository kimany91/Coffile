'use strict';
// Évaluation honnête : phrases écrites à la main, jamais vues pendant l'entraînement.
//   node tools/nlp-eval.js
const path = require('path');
const { Net } = require('../src/nlp/nn');
const model = require(path.join(__dirname, '..', 'src', 'nlp', 'model.json'));
const sentence = Net.fromJSON(model.sentence);
const message = Net.fromJSON(model.message);

const S = [
  ['pour ajdh il faudra monter cette vidéo', ['tache', 'delai']],
  ['Hello ! tu pourrais me sortir un petit reel avec les images de samedi ?', ['tache']],
  ['faudrait que ça parte chez le client avant jeudi', ['delai', 'envoi']],
  ['Le client attend la V2 pour vendredi matin', ['delai']],
  ["J'ai besoin du montage dans la soirée", ['tache', 'delai']],
  ['tu peux virer le passage où il bafouille', ['tache']],
  ['Coupe moi les 10 premières secondes stp', ['tache']],
  ['rajoute un sous-titrage en anglais', ['tache']],
  ["Une fois que c'est bon tu le balances sur le drive", ['envoi']],
  ['Tu peux le transférer à Hélène de la com ?', ['envoi', 'tache']],
  ['mets la version finale dans le dossier LIVRABLES', ['envoi', 'tache']],
  ['à 1min20 le son sature', ['retour']],
  ["Le plan d'ouverture est trop long", ['retour']],
  ['vers 0:45 on entend le vent dans le micro', ['retour']],
  ["c'est assez pressé on doit poster demain", ['urgent', 'delai']],
  ['URGENT besoin du teaser', ['urgent', 'tache']],
  ['Bonne soirée à toi !', ['salut']],
  ['Hello Kimany, comment tu vas ?', ['salut']],
  ['Les images du drone sont dans le sous-dossier DJI', ['info']],
  ['On a tourné 2h de rushes avec 3 caméras', ['info']],
  ['Votre commande n°4521 a été expédiée', []],
  ['Réunion d’équipe demain 9h30 en salle B', []],
  ['Le tournage est prévu lundi prochain', []],
  ['Ton abonnement Netflix a été renouvelé', []],
  ['Tu viens à la soirée samedi ?', []],
  ['On passe à table, à tout de suite', []],
  ['Livrable attendu le 18', ['delai']],
  ["Pour la semaine pro faudrait 3 reels d'1 min", ['tache', 'delai']],
  ['tu me fais une version carrée pour insta', ['tache']],
  ['envoie la vf a paul stp', ['envoi']]
];

// 2e série, écrite après l'entraînement et jamais utilisée pour régler les exemples.
const S2 = [
  ['Tu pourrais caler la musique sur le rythme des pas ?', ['tache']],
  ["faut que ce soit en ligne avant 17h c'est pour le lancement", ['delai']],
  ["J'aurais besoin d'une déclinaison 4:5 du spot", ['tache']],
  ['Tu le mets sur WeTransfer quand tu as fini', ['envoi']],
  ['envoie direct à la cliente stp', ['envoi']],
  ['à 2:14 la transition est moche', ['retour']],
  ['Le logo de fin est pixelisé', ['retour']],
  ['C’est pour hier 😅', ['delai', 'urgent']],
  ['On a besoin de 5 stories pour la semaine prochaine', ['tache', 'delai']],
  ['merci pour ton taf, top comme d’hab', ['salut']],
  ['Je te mets en PJ la charte graphique', ['info']],
  ['Il y a 4 interviews de 10 min chacune', ['info']],
  ['Ta carte bancaire expire bientôt', []],
  ["Le séminaire a lieu jeudi à l'hôtel", []],
  ['On fait un point demain matin ?', []],
  ['Peux-tu enlever les plans où on voit la marque concurrente', ['tache']],
  ["Dernier délai lundi 9h, après c'est trop tard", ['delai']],
  ['Je repasse au studio vendredi', []],
  ['Tu me prépares 3 miniatures YouTube', ['tache']],
  ['rends-le moi dès que tu peux', ['delai', 'tache']],
  ['le son de la voix off est trop compressé', ['retour']],
  ['Fais-le valider par Hugo avant de l’envoyer', ['tache', 'envoi']],
  ['Salut l’équipe !', ['salut']],
  ['Les rushes caméra A sont en 50 fps', ['info']],
  ['Votre code promo est valable 7 jours', []],
  ['Il me faudrait la version sous-titrée pour demain 10h', ['tache', 'delai']],
  ['Partage-moi le lien Frame.io pour les retours', ['envoi']],
  ['Vers la fin on entend un clic', ['retour']],
  ['Bon dimanche !', ['salut']],
  ['tu peux accélérer le passage du milieu x2', ['tache']]
];

function run(list) {
  let ok = 0;
  for (const [text, expect] of list) {
    const p = sentence.predict(text);
    const got = Object.keys(p).filter((k) => p[k] >= 0.5);
    const missing = expect.filter((e) => !got.includes(e));
    const extra = got.filter((g) => !expect.includes(g) && !(g === 'tache' && (expect.includes('retour') || expect.includes('envoi'))) && !(g === 'delai' && expect.includes('urgent')));
    const good = !missing.length && !extra.length;
    if (good) ok++;
    console.log(`${good ? 'OK ' : '-- '} ${text.padEnd(70)} ${got.join(',') || '(rien)'}${good ? '' : `   attendu: ${expect.join(',') || '(rien)'}`}`);
  }
  return ok;
}
console.log('--- 2e série (jamais vue, jamais réglée) ---');
const ok2 = run(S2);
console.log(`2e série : ${ok2}/${S2.length} entièrement justes\n`);

let ok = 0;
let total = 0;
for (const [text, expect] of S) {
  const p = sentence.predict(text);
  const got = Object.keys(p).filter((k) => p[k] >= 0.5);
  const missing = expect.filter((e) => !got.includes(e));
  // Tolérés : une demande d'envoi ou un retour est aussi « une chose à faire ».
  const extra = got.filter((g) => !expect.includes(g) && !(g === 'tache' && (expect.includes('retour') || expect.includes('envoi'))) && !(g === 'delai' && expect.includes('urgent')));
  const good = !missing.length && !extra.length;
  total++;
  if (good) ok++;
  console.log(`${good ? 'OK ' : '-- '} ${text.padEnd(70)} ${got.join(',') || '(rien)'}${good ? '' : `   attendu: ${expect.join(',') || '(rien)'}`}`);
}
console.log(`\nPhrases : ${ok}/${total} entièrement justes`);

const M = [
  ["Salut ! pour ajdh il faudra monter cette vidéo, les rushes sont dans le lien. Merci !", 1],
  ['Coucou, tu pourrais me faire un petit teaser de 20s avec les images du salon ? idéalement avant vendredi', 1],
  ['Hello, retours sur la V1 : 0:12 enlever le plan flou, 0:40 baisser la musique. Merci', 1],
  ['Bonjour, votre facture du mois de novembre est disponible dans votre espace client.', 0],
  ['Hey ! on se fait un resto ce soir ?', 0],
  ['Nouvelle vidéo sur notre chaîne : découvrez les coulisses du tournage !', 0],
  ['Salut, le tournage est décalé à jeudi, je te tiens au courant. Bonne journée', 0],
  ['Yo, besoin d’un reel 9:16 pour leur insta, urgent, je t’envoie les fichiers', 1]
];
let mok = 0;
for (const [text, y] of M) {
  const p = message.predict(text).montage;
  const good = (p >= 0.5 ? 1 : 0) === y;
  if (good) mok++;
  console.log(`${good ? 'OK ' : '-- '} ${(p * 100).toFixed(0).padStart(3)} %  ${text.slice(0, 90)}`);
}
console.log(`Messages : ${mok}/${M.length} justes`);
