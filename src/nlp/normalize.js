'use strict';
// Mise à plat du texte avant analyse : minuscules, sans accents, abréviations et tournures
// courantes remplacées par leur forme complète (« ajdh » → « aujourd'hui », « dmain » → « demain »,
// « asap » → « au plus vite », « stp » → « s'il te plait »…).

const deaccent = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '');

// Mot entier : pas de lettre ni de chiffre autour.
const W = (alts) => new RegExp(`(?<![\\p{L}\\d])(?:${alts})(?![\\p{L}\\d])`, 'gu');

const SLANG = [
  [W("ajd|ajdh|ajdhui|ajrd|ajrdh|auj|aujd|aujdh|aujrd|aujrdh|aujourdhui|aujourd hui|aujourd'hui|aujourd’hui|ojd|ojdh|today|tdy|2day"), "aujourd'hui"],
  [W('apres[- ]demain|apdm|apres dmain|apres 2main'), 'apres-demain'],
  [W('dmain|dem1|2main|demin|dmn|tmrw|tomorrow|tomoro|tmr'), 'demain'],
  [W('aprem|aprm|apm|apres[- ]midi|this afternoon'), 'apres-midi'],
  [W('ce soir|ce soire|cesoir|2soir|tonight|tonite'), 'ce soir'],
  [W('stp|svp|plz|pls|please|sil te plait|sil vous plait|s il te plait|s il vous plait|s\'il te plait|s\'il vous plait'), "s'il te plait"],
  [W('asap|a\\.s\\.a\\.p|au plus vite|aussi vite que possible|le plus vite possible|le plus rapidement possible|des que possible|des que tu peux|rapidos|urgemment|en urgence|vite fait bien fait'), 'au plus vite'],
  [W('eod|fdj|end of day|fin de journee|en fin de journee|fin de jour'), 'fin de journee'],
  [W('eow|end of week|fin de semaine|fin de la semaine|en fin de semaine'), 'fin de semaine'],
  [W('next week|semaine pro|semaine prochaine|la semaine pro|sem pro|sem prochaine'), 'semaine prochaine'],
  [W('week end|weekend|week-end'), 'week-end'],
  [W('pr'), 'pour'],
  [W('ds'), 'dans'],
  [W('qd|qnd|kan'), 'quand'],
  [W('pk|pq|pkoi|pourkoi'), 'pourquoi'],
  [W('bcp|bcq'), 'beaucoup'],
  [W('tjrs|tjs|toujour'), 'toujours'],
  [W('mtn|mnt|mtnt|maintenan'), 'maintenant'],
  [W('qq|qqs|qqes'), 'quelques'],
  [W('qqch|qqc|qqchose'), 'quelque chose'],
  [W('rdv'), 'rendez-vous'],
  [W('tt'), 'tout'],
  [W('ts'), 'tous'],
  [W('vid|vids|vidz|videos|vidéos|vidéo'), 'video'],
  [W('tkt|tqt'), "t'inquiete"],
  [W('jsp'), 'je sais pas'],
  [W('dsl'), 'desole'],
  [W('mrc|mci|mercii+|thx|thanks|merki'), 'merci'],
  [W('bjr|bonjoir|bjour'), 'bonjour'],
  [W('slt|salu'), 'salut'],
  [W('ok|okay|oki|okey|d\'acc|dacc|dac'), 'ok'],
  [W('min|mn'), 'minutes'],
  [W('sec|secs'), 'secondes'],
  [W('h'), 'heures'],
  [W('jr|jrs'), 'jours'],
  [W('sem|sems'), 'semaines'],
  // Jours abrégés seulement avec un point ou une date derrière (« la mer », « le jeu » restent).
  [W('lun\\.|lun(?= \\d)'), 'lundi'],
  [W('mer\\.|mer(?= \\d)'), 'mercredi'],
  [W('jeu\\.|jeu(?= \\d)'), 'jeudi'],
  [W('ven\\.|ven(?= \\d)|vend\\.?|vdd'), 'vendredi'],
  [W('dim\\.|dim(?= \\d)'), 'dimanche'],
  [W('monday'), 'lundi'],
  [W('tuesday'), 'mardi'],
  [W('wednesday'), 'mercredi'],
  [W('thursday'), 'jeudi'],
  [W('friday'), 'vendredi'],
  [W('saturday'), 'samedi'],
  [W('sunday'), 'dimanche'],
  // « faudra » → « il faudra », sans doubler un « il » déjà là.
  [/(?<![\p{L}\d])(?<!il )(?:faudras?)(?![\p{L}\d])/gu, 'il faudra'],
  [/(?<![\p{L}\d])(?<!il )faudrait(?![\p{L}\d])/gu, 'il faudrait'],
  [/(?<![\p{L}\d])(?<!il )(?:faut|fo|fau)(?![\p{L}\d])/gu, 'il faut'],
  [W('tu peu|tu pe|tu peut|tu peus'), 'tu peux'],
  [W('peu tu|peut tu|peux tu|peut-tu|peus-tu'), 'peux-tu'],
  [W('envoi|envoye|envois'), 'envoie'],
  [W('monte moi|monte-moi|montes moi|montes-moi'), 'monte-moi'],
  [W('reels|reel'), 'reel'],
  [W('vf'), 'version finale'],
  [W('v1|v 1'), 'version 1'],
  [W('v2|v 2'), 'version 2'],
  [W('v3|v 3'), 'version 3']
];

// Nombres écrits en lettres (pour « dans deux jours », « sous trois heures »…).
const NUMBERS = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, quinze: 15, vingt: 20, trente: 30, quarante: 40, cinquante: 50 };

function normalize(text) {
  let s = deaccent(String(text || '').toLowerCase())
    .replace(/[’`´]/g, "'")
    .replace(/https?:\/\/\S+/g, ' lienweb ')
    .replace(/[\p{Extended_Pictographic}]/gu, ' ')
    .replace(/(\p{L})\1{2,}/gu, '$1$1'); // « merciiiii » → « mercii »
  for (const [re, rep] of SLANG) s = s.replace(re, rep);
  s = s.replace(W(Object.keys(NUMBERS).join('|')), (m) => String(NUMBERS[m]));
  return s.replace(/\s+/g, ' ').trim();
}

module.exports = { normalize, deaccent };
