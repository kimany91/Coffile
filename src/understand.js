'use strict';
// Lecture détaillée d'un mail ou d'un message : ce qu'il faut faire, à qui envoyer, logiciels,
// personnes citées, retours avec timecodes, transcription / texte de voix off, musique,
// références, budget, téléphone… Et un petit modèle qui apprend de tes choix
// (projets créés = montage, « Pas un montage » = non) pour mieux repérer les demandes.

const nlp = require('./nlp');
const { findDeadline } = require('./nlp/dates');

const plain = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// ---------- Nettoyage : sans les réponses citées ni la signature ----------
const QUOTE_START = /^(le .{3,120}a [ée]crit\s?:|on .{3,120}wrote:|-{2,}\s*(original message|message d'origine|forwarded message|message transf[ée]r[ée])|de\s?:\s.+$|from:\s.+$)/im;
const SIGN_LINE = /^(--\s*|cordialement[ ,.!]*|bien [àa] (toi|vous)[ ,.!]*|bonne (journ[ée]e|soir[ée]e|fin de journ[ée]e)[ ,.!]*|belle journ[ée]e[ ,.!]*|[àa] (tr[èe]s )?bient[ôo]t[ ,.!]*|best( regards)?[ ,.!]*|regards[ ,.!]*|thanks?[ ,.!]*|sent from my .*|envoy[ée] de mon .*|bises?[ ,.!]*|merci d'avance[ ,.!]*|merci beaucoup[ ,.!]*|merci[ ,.!]*)$/i;

function mainBody(text) {
  let body = String(text || '').replace(/\r\n?/g, '\n');
  const q = body.search(QUOTE_START);
  if (q > 20) body = body.slice(0, q);
  const lines = body.split('\n').filter((l) => !/^\s*>/.test(l));
  // Signature : à partir de la 1re formule de politesse seule sur sa ligne (dans le dernier tiers).
  const cut = lines.findIndex((l, i) => i >= Math.floor(lines.length / 3) && l.trim().length < 40 && SIGN_LINE.test(l.trim()));
  return { main: (cut > 0 ? lines.slice(0, cut) : lines).join('\n').trim(), signature: cut > 0 ? lines.slice(cut).join('\n') : '' };
}

const clean = (s, max = 170) => {
  let t = String(s || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').replace(/^[\s\-–—•*·>]+/, '').trim();
  if (t.length > max) t = t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
  return t;
};
const uniq = (list, key = (x) => plain(x)) => {
  const seen = new Set();
  return list.filter((x) => {
    const k = key(x);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
const sentences = (text) =>
  String(text || '')
    .split('\n')
    .flatMap((l) => l.split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ0-9«"])/u))
    .map((s) => s.trim())
    .filter(Boolean);

// ---------- Ce qu'il faut faire ----------
const ASK_RE = /\b(peux[- ]tu|pourrais[- ]tu|pourriez[- ]vous|pouvez[- ]vous|tu peux|tu pourrais|vous pouvez|il faut|il faudra(it)?|faudrait|faut|merci de|n'oublie(z)? pas|pense[zr]? [àa]|[àa] faire|ce serait (bien|top|cool|parfait) de|j'aimerais|on aimerait|j'aimerai|je voudrais|on voudrait|nous voudrions|il me faut|on a besoin|j'ai besoin|besoin d[e']|essaie(z)? de|l'id[ée]e (c'est|serait) de|l'objectif (c'est|est) de|can you|could you|please|need to|make sure)\b/i;
const VERB_RE = /^(?:et |puis |aussi |ensuite |enfin )?(ajoute|ajouter|enl[èe]ve|enlever|retire|retirer|coupe|couper|raccourcis|raccourcir|rallonge|rallonger|mets|mettre|change|changer|remplace|remplacer|fais|faire|envoie|envoyer|exporte|exporter|int[èe]gre|int[ée]grer|monte|monter|garde|garder|utilise|utiliser|rajoute|rajouter|baisse|baisser|augmente|acc[ée]l[èe]re|ralentis|recadre|recadrer|stabilise|[ée]talonne|sous-titre|sous-titrer|corrige|corriger|supprime|supprimer|d[ée]place|ins[èe]re|ins[ée]rer|termine|finis|pr[ée]pare|v[ée]rifie|check|livre|livrer)\b/i;
const BULLET_RE = /^\s*(?:[-–—•*▪◦·]|\d{1,2}[.)]|[a-z][.)])\s+(.{3,})$/;

// preds : probabilités du réseau de neurones pour chaque phrase (tournures non prévues par les règles).
function findTasks(main, preds = []) {
  const out = [];
  for (const { s, p } of preds) if (p && p.tache >= 0.6 && p.salut < 0.5 && p.retour < 0.5) out.push(s);
  for (const line of main.split('\n')) {
    const b = line.match(BULLET_RE);
    if (b && !/^https?:/.test(b[1])) out.push(b[1]);
  }
  for (const s of sentences(main)) {
    if (ASK_RE.test(s) || VERB_RE.test(s)) out.push(s);
  }
  const tc = new RegExp(`^\\s*(?:[-–—•*]\\s*)?[\\[(]?${TC}|${TC_INSIDE.source}`, 'i');
  return uniq(out.filter((t) => !tc.test(t)).map((t) => clean(t.replace(/^(salut|hello|hey|coucou|bonjour|yo|hi)\b[^,!.]*[,!.]\s*/i, '')))).filter((t) => t.length > 6 && !/^(merci|thanks)\b/i.test(t)).slice(0, 10);
}

// ---------- Retours avec timecodes ----------
const TC = '\\d{1,2}:\\d{2}(?::\\d{2})?(?:[:;.]\\d{2})?';
const TC_LINE_START = new RegExp(`^\\s*(?:[-–—•*]\\s*)?[\\[(]?(${TC})[\\])]?\\s*[-–—:>]?\\s*(.*)$`);
const EDIT_WORD = /\b(ajout|enl[èe]v|retir|coup|raccourc|rallong|met|chang|rempla|fai|gard|suppr|d[ée]plac|ins[èe]r|baiss|augment|acc[ée]l|ralent|recadr|stabilis|[ée]talon|corrig|plan|cut|transition|musique|texte|titre|logo|couleur)/i;
const TC_INSIDE = new RegExp(`(?:[àa]|vers|au|de|from|at)\\s+(${TC})(?!\\s*(?:h|heures?|am|pm))`, 'i');

// Timecodes écrits autrement : « 1min20 », « 0'45 », « 45s ».
const LOOSE_TC = /(\d{1,2}\s?min\s?\d{0,2}(?:\s?s)?|\d{1,2}'\d{2}|\d{1,3}\s?(?:s|sec|secondes)\b)/i;

function findFeedback(main, preds = []) {
  const out = [];
  // Retours repérés par le réseau de neurones (« le son sature », « vers 1min20 on entend le vent »).
  for (const { s, p } of preds) {
    if (!p || p.retour < 0.6) continue;
    // Un titre comme « Retours V1 : » n'est pas un retour.
    if (/:\s*$/.test(s) && s.length < 30) continue;
    const exact = s.match(new RegExp(TC));
    const loose = exact ? null : s.match(LOOSE_TC);
    out.push({ tc: exact ? exact[0] : loose ? loose[1].replace(/\s+/g, '') : '', text: clean(s, 160) });
  }
  for (const line of main.split('\n')) {
    const s = line.trim();
    const start = s.match(TC_LINE_START);
    if (start && start[2] && !/^[A-ZÉÈ][\p{L}'-]{1,20}\s*:/u.test(start[2])) {
      out.push({ tc: start[1], text: clean(start[2], 160) });
      continue;
    }
    const inside = s.match(TC_INSIDE);
    if (inside && (EDIT_WORD.test(s) || ASK_RE.test(s))) {
      out.push({ tc: inside[1], text: clean(s, 160) });
    }
  }
  // Même retour trouvé par les règles et par le réseau : gardé une fois (même timecode, ou même texte).
  return uniq(out, (f) => (f.tc ? `tc:${f.tc}` : plain(f.text))).slice(0, 20);
}

// ---------- Transcription / texte de voix off ----------
// Titre seul sur sa ligne, ou suivi de « : » (« Voici… » ne compte pas).
const TRANSCRIPT_HEAD = /^\s*(transcription|transcript|verbatim|script|texte (de la |du |pour la )?(voix[- ]off|vo|interview)|voix[- ]off|vo|texte [àa] dire|texte de l'interview|sous[- ]titres?|dialogues?)(?![\p{L}])\s*(?::\s*(.*))?$/iu;
const SPEAKER_LINE = new RegExp(`^\\s*(?:[\\[(]?${TC}[\\])]?\\s*[-–—]?\\s*)?([A-ZÉÈÀ][\\p{L}'.-]{1,20}(?:\\s[A-ZÉÈÀ][\\p{L}'.-]{1,20})?)\\s*:\\s+\\S`, 'u');
const TC_ONLY_LINE = new RegExp(`^\\s*[\\[(]?${TC}[\\])]?\\s*[-–—:]?\\s+\\S`);

// Phrase qui annonce un texte joint (« Je te joins le texte aussi pour ton dérush : »).
// Le réseau de neurones la reconnaît d'après sa tournure ; ces règles servent de filet.
const ANNONCE_VERB = /\b(joins|joint|mets|colle|copie|envoie|partage|transmets|file|laisse|donne|ajoute|voici|voil[àa]|ci[- ]dessous|en dessous|trouveras|trouverez|tiens)\b/i;
const ANNONCE_TEXT = /\b(texte|transcri\w*|retranscri\w*|script|verbatim|voix[- ]off|vo|paroles|dialogues?|discours|traduction|trad|sous[- ]titres|ce qu'(?:il|elle) (?:dit|raconte|lit))\b/i;
const ANNONCE_ASK = /\b(peux[- ]tu|tu peux|pourrais|fais|faire|envoie[- ]moi|renvoie[- ]moi|il faut|faudra|ajoute le|mets le texte)\b/i;

// 2 = annonce sûre, 1 = probable (à confirmer par ce qui suit), 0 = non.
function annonceLevel(head) {
  const h = head.trim();
  if (h.length < 6 || h.length > 220) return 0;
  const p = nlp.sentence(h);
  if (p && p.annonce >= 0.9 && p.annonce > p.tache) return 2;
  if (p && p.annonce >= 0.6 && p.annonce > p.tache) return 1;
  return ANNONCE_VERB.test(h) && ANNONCE_TEXT.test(h) && !ANNONCE_ASK.test(h) && (!p || p.annonce >= 0.25) ? 1 : 0;
}

// Ce qui suit ressemble surtout à des consignes (« ajoute le logo », « exporte en 9:16 ») ?
function looksLikeInstructions(body) {
  const list = sentences(body).slice(0, 6);
  if (!list.length) return false;
  const asks = list.filter((x) => {
    const p = nlp.sentence(x);
    return p && (p.tache >= 0.7 || p.retour >= 0.7 || p.delai >= 0.7);
  }).length;
  return asks / list.length > 0.5;
}

// Texte qui suit, jusqu'à la signature ou la réponse citée. Les liens seuls sur leur ligne n'en font pas partie.
function bodyAfter(text, from) {
  let to = text.length;
  let pos = from;
  const rest = text.slice(from).split('\n');
  for (let k = 0; k < rest.length; k++) {
    const l = rest[k].trim();
    if (k > 0 && ((SIGN_LINE.test(l) && l.length < 40) || /^>/.test(l) || QUOTE_START.test(l))) {
      to = pos;
      break;
    }
    pos += rest[k].length + 1;
  }
  const body = text
    .slice(from, to)
    .split('\n')
    .filter((l) => !/^\s*https?:\/\/\S+\s*$/.test(l))
    .join('\n')
    .replace(/^\s*\n+|\s+$/g, '')
    .trim();
  return { body, to };
}
const enough = (body) => body.replace(/https?:\/\/\S+/g, '').replace(/\s/g, '').length >= 60;

// Renvoie { text, lines, title, intro, from, to, explicit } — from/to : position dans le texte
// (de la phrase d'annonce à la fin du texte joint), pour ne pas lire la transcription comme des consignes.
function findTranscript(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const result = (body, title, extra) => ({ text: body.slice(0, 6000), lines: body.split('\n').filter((l) => l.trim()).length, title, ...extra });
  let off = 0;
  for (let i = 0; i < lines.length; off += lines[i].length + 1, i++) {
    const line = lines[i];
    // 1) Une ligne « Transcription : » (ou « Voix off : ») suivie du texte.
    const m = line.match(TRANSCRIPT_HEAD);
    if (m) {
      const at = m[4] ? off + line.lastIndexOf(m[4]) : off + line.length;
      const { body, to } = bodyAfter(src, at);
      if (enough(body)) return result(body, m[1], { intro: '', from: off, to, explicit: true });
    }
    // 2) Une phrase qui annonce le texte (« je te joins le texte pour ton dérush : », « voici ce qu'elle dit »…) :
    //    tout ce qui suit est le texte joint, dans n'importe quelle langue.
    let segStart = 0;
    for (const seg of line.split(/(?<=[.!?])\s+/)) {
      const at = line.indexOf(seg, segStart);
      segStart = at + seg.length;
      const colon = seg.search(/:(?!\d)/);
      const head = (colon >= 0 ? seg.slice(0, colon) : seg).replace(/https?:\/\/\S+/g, '');
      const level = annonceLevel(head);
      if (!level) continue;
      const bodyFrom = off + at + (colon >= 0 ? colon + 1 : seg.length);
      const { body, to } = bodyAfter(src, bodyFrom);
      if (level === 1 && looksLikeInstructions(body)) continue;
      if (enough(body)) return result(body, 'texte joint', { intro: clean(head, 120), from: off + at, to, explicit: true });
    }
  }
  // 3) Au moins 3 lignes de suite « Nom : … » ou « 00:12 … ».
  let best = null;
  for (let i = 0; i < lines.length; ) {
    let k = i;
    // Lignes « Nom : … » ou « 00:12 … », et leurs suites (ligne qui commence en minuscule).
    const cont = (n) => n > i && /^\s*[a-zà-ÿ(«"]/.test(lines[n]);
    while (k < lines.length && (SPEAKER_LINE.test(lines[k]) || TC_ONLY_LINE.test(lines[k]) || cont(k))) k++;
    if (k - i >= 3 && (!best || k - i > best.n)) best = { i, n: k - i };
    i = Math.max(k, i + 1);
  }
  if (best) {
    const body = lines.slice(best.i, best.i + best.n).join('\n');
    return { text: body.slice(0, 6000), lines: best.n, title: 'transcription', intro: '', explicit: false };
  }
  // 4) Un long passage entre guillemets (texte à dire).
  const q = src.match(/[«"“]\s*([^»"”]{160,})\s*[»"”]/);
  if (q) return { text: q[1].trim().slice(0, 6000), lines: 1, title: 'texte entre guillemets', intro: '', explicit: false };
  return null;
}

// ---------- À qui envoyer, et comment ----------
// La suite de la phrase (un point dans une adresse mail ne la coupe pas).
const SEND_RE = /\b(envoi(?:e|es|ez|er)?|renvoi(?:e|ez|er)?|transf[èe]re[rz]?|partage[rz]?|livre[rz]?|fais[- ]le passer|fais[- ]la passer|transmets|transmettre|mets[- ]le|mets[- ]la|mets[- ]les|d[ée]pose[rz]?|upload(?:e|er)?|send|share)\b((?:[^\n!?.]|\.(?=\S)){0,100})/gi;
const DELIVERY = [
  [/\bdrive\b/i, 'Google Drive'],
  [/wetransfer|we\.tl/i, 'WeTransfer'],
  [/frame\.?io/i, 'Frame.io'],
  [/dropbox/i, 'Dropbox'],
  [/swisstransfer/i, 'SwissTransfer'],
  [/\b(par|en) mail\b|\bpar e-?mail\b|\bpar email\b/i, 'Par mail'],
  [/whatsapp/i, 'WhatsApp'],
  [/\byoutube\b/i, 'YouTube'],
  [/\bvimeo\b/i, 'Vimeo'],
  [/\bslack\b/i, 'Slack']
];
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function findSendTo(main, senderEmail) {
  const who = [];
  const how = [];
  for (const m of main.replace(/https?:\/\/\S+/g, ' ').matchAll(SEND_RE)) {
    const tail = m[2] || '';
    const to = tail.match(/(?:^|[\s,(])(?:à|a|au|aux|chez|to)\s+((?:[A-ZÉÈÀ][\p{L}'-]+(?:\s+[A-ZÉÈÀ][\p{L}'-]+)?)|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(?:l'|la |le |les )?(?:client|cliente|agence|prod|production|r[ée]al(?:isateur|isatrice)?|monteur|monteuse|chef de projet|[ée]quipe|boss|marque)\b)/u);
    if (to) who.push(to[1].trim());
    for (const [re, label] of DELIVERY) if (re.test(m[0])) how.push(label);
  }
  for (const m of main.matchAll(/\b(?:en copie|cc)\s*:\s*([^\n;]{2,60})/gi)) who.push(`${m[1].trim()} (en copie)`);
  for (const m of main.matchAll(/\bmet(?:s|tre|tez)?\s+([A-ZÉÈÀ][\p{L}'-]+(?:\s+[A-ZÉÈÀ][\p{L}'-]+)?)\s+en copie/gu)) who.push(`${m[1]} (en copie)`);
  for (const e of main.match(EMAIL_RE) || []) if (!senderEmail || e.toLowerCase() !== senderEmail.toLowerCase()) who.push(e);
  return { sendTo: uniq(who.map((w) => clean(w, 70))).slice(0, 6), delivery: uniq(how).slice(0, 4) };
}

// ---------- Logiciels ----------
const SOFTWARE = [
  [/premi[eè]re\s*pro|\bpremiere\b|\bppro\b/i, 'Premiere Pro'],
  [/after\s*effects?|\bae\b(?=.*(motion|effet|anim))/i, 'After Effects'],
  [/davinci|resolve/i, 'DaVinci Resolve'],
  [/final\s*cut/i, 'Final Cut Pro'],
  [/capcut/i, 'CapCut'],
  [/photoshop|\bpsd\b/i, 'Photoshop'],
  [/illustrator|\.ai\b/i, 'Illustrator'],
  [/lightroom/i, 'Lightroom'],
  [/audition/i, 'Audition'],
  [/media\s*encoder/i, 'Media Encoder'],
  [/frame\.?io/i, 'Frame.io'],
  [/\bcanva\b/i, 'Canva'],
  [/\bfigma\b/i, 'Figma'],
  [/blender/i, 'Blender'],
  [/cinema\s*4d|\bc4d\b/i, 'Cinema 4D'],
  [/\bavid\b/i, 'Avid'],
  [/pro\s*tools/i, 'Pro Tools'],
  [/ableton/i, 'Ableton'],
  [/logic\s*pro/i, 'Logic Pro'],
  [/descript/i, 'Descript'],
  [/runway/i, 'Runway'],
  [/topaz/i, 'Topaz'],
  [/handbrake/i, 'HandBrake'],
  [/filmora/i, 'Filmora'],
  [/inshot/i, 'InShot'],
  [/\bnotion\b/i, 'Notion'],
  [/\btrello\b/i, 'Trello'],
  [/\bmidjourney\b/i, 'Midjourney'],
  [/chat\s*gpt/i, 'ChatGPT']
];

// ---------- Personnes ----------
const FIRST_NAMES = new Set(
  (
    'adam adrien agathe alain alex alexandre alexandra alexis alice aline amandine amelie anais andre andrea anne annie antoine arnaud arthur aurelie aurelien axel ' +
    'baptiste bastien benjamin benoit bernard bruno camille capucine caroline catherine cecile celia celine charles charlotte chloe christian christophe claire clara clement ' +
    'coralie corentin cyril damien daniel david delphine denis diane dimitri dorian dylan eddy edouard elise elodie emilie emma emmanuel enzo eric estelle etienne eva fabien ' +
    'fanny fatima florence florian francois frederic gabriel gael gaelle gaetan gauthier georges gilles guillaume hannah helene henri hugo ines isabelle jade jason jean ' +
    'jeanne jeremy jerome jessica johan jonathan jordan joseph julia julie julien juliette justine karim kevin killian laetitia laura laure lauren lea leo leon lina ' +
    'lisa loic lola louis louise luc luca lucas lucie lucile manon marc margaux marie marine marion martin mathieu mathilde matteo matthieu maxime melanie melissa mickael ' +
    'mohamed morgane nadia nathalie nathan nicolas noah noemie oceane olivia olivier oscar pascal patrick paul pauline philippe pierre quentin rachel raphael remi romain ' +
    'romane rose sacha salome samuel sandra sara sarah sebastien simon sofia sophie stella stephane steven sylvain sylvie theo thibault thomas tim timothee tom tristan ' +
    'valentin valerie victor victoria vincent virginie william xavier yann yanis yasmine yohan zoe ines youssef mehdi amine nora leila sami ryan noe lou mael ' +
    'john james michael mike chris kate emily jack harry sam ben max anna'
  ).split(/\s+/)
);

function findPeople(main, { senderName = '', greetingName = '' } = {}) {
  const skip = new Set([...plain(senderName).split(/\s+/), plain(greetingName)].filter(Boolean));
  const found = new Map();
  for (const s of sentences(main)) {
    for (const m of s.matchAll(/(?<![\p{L}'])([A-ZÉÈÀÇ][\p{Ll}'-]{1,20})(?:\s+([A-ZÉÈÀÇ][\p{Ll}'-]{1,20}|[A-Z]\.))?/gu)) {
      const first = m[1];
      const key = plain(first);
      if (!FIRST_NAMES.has(key) || skip.has(key)) continue;
      const full = m[2] && !/^(le|la|les|de|du)$/i.test(m[2]) ? `${first} ${m[2]}` : first;
      if (!found.has(key)) found.set(key, { name: full, context: clean(s, 140) });
    }
  }
  return [...found.values()].slice(0, 8);
}

// ---------- Musique, références, budget, téléphone, points clés ----------
const MUSIC_LINK = /spotify|soundcloud|deezer|artlist|epidemic|musicbed|youtube\.com\/watch|youtu\.be|apple\.co|music\.apple/i;
const MUSIC_WORD = /\b(musique|music|son|sons|track|morceau|chanson|sound|playlist|bpm|instru|instrumentale?|beat|sfx|bruitage)\b/i;

function findMusic(main, links) {
  const lines = sentences(main).filter((s) => MUSIC_WORD.test(s) && !TC_INSIDE.test(s)).map((s) => clean(s, 150));
  const urls = links.filter((u) => MUSIC_LINK.test(u) && /spotify|soundcloud|deezer|artlist|epidemic|musicbed|apple/i.test(u));
  return { music: uniq(lines).slice(0, 4), musicLinks: urls.slice(0, 4) };
}

const REF_SERVICES = [
  [/youtube\.com|youtu\.be/i, 'YouTube'],
  [/instagram\.com/i, 'Instagram'],
  [/tiktok\.com/i, 'TikTok'],
  [/pinterest\./i, 'Pinterest'],
  [/behance\.net/i, 'Behance'],
  [/dribbble\.com/i, 'Dribbble'],
  [/linkedin\.com/i, 'LinkedIn'],
  [/facebook\.com|fb\.watch/i, 'Facebook'],
  [/twitter\.com|x\.com/i, 'X']
];

function findRefs(links) {
  const out = [];
  for (const url of links) {
    const r = REF_SERVICES.find(([re]) => re.test(url));
    if (r) out.push({ url, service: r[1] });
  }
  return uniq(out, (r) => r.url).slice(0, 6);
}

const BUDGET_RE = /(?:(\d[\d\s.,]*\d|\d)\s?(€|euros?|eur\b|k€|\$|dollars?)(\s?(HT|TTC))?)|(?:(€|\$)\s?(\d[\d\s.,]*\d|\d))/gi;
const PHONE_RE = /(?:\+33\s?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/g;

const POINTS = [
  [/sous[- ]?titr/i, 'Sous-titres'],
  [/voix[- ]off|\bvo\b/i, 'Voix off'],
  [/[ée]talonn|colorim|\blut\b/i, 'Étalonnage'],
  [/motion|anim(ation|er)/i, 'Motion design'],
  [/\blogo\b/i, 'Logo'],
  [/miniature|thumbnail/i, 'Miniature'],
  [/libre de droits?|royalty[- ]free/i, 'Musique libre de droits'],
  [/mixage|mix\b|niveau(x)? sonore|loudness|lufs/i, 'Mixage son'],
  [/\b4k\b|uhd/i, '4K'],
  [/\b(50|60)\s?(fps|i\/s|images)/i, '50/60 fps'],
  [/transition/i, 'Transitions'],
  [/texte[s]? (à|a) l'[ée]cran|titrage|carton/i, 'Textes à l\'écran'],
  [/cta|call to action/i, 'Call to action'],
  [/charte|brand ?book|identit[ée] visuelle/i, 'Charte graphique'],
  [/d[ée]rush/i, 'Dérush'],
  [/stabilis/i, 'Stabilisation'],
  [/ralenti|slow ?mo/i, 'Ralentis'],
  [/drone/i, 'Plans drone']
];

// ---------- Résumé ----------
function summaryOf(main) {
  const s = sentences(main)
    .map((x) => x.replace(/^(salut|hello|hey|coucou|bonjour|bonsoir|yo|hi)\b[^,!.]*[,!.]?\s*/i, '').trim())
    .filter((x) => x.length > 15 && !/^https?:/.test(x) && !/^(j'esp[èe]re que|comment (vas|allez)|[çc]a va)/i.test(x));
  return clean(s.slice(0, 2).join(' '), 220);
}

function details({ subject = '', text = '', sender = '', senderEmail = '', links = [], date = null } = {}) {
  const body = mainBody(text).main;
  // Texte joint annoncé (transcription, script…) : affiché à part, et retiré de ce qui est lu
  // comme des consignes (ce n'est pas à toi que ces phrases s'adressent).
  const inBody = findTranscript(body);
  const transcript = inBody || findTranscript(text);
  const main = inBody && inBody.explicit ? `${body.slice(0, inBody.from)}\n${body.slice(inBody.to)}`.trim() : body;
  // Chaque phrase passée au réseau de neurones (une seule fois).
  const preds = sentences(main)
    .slice(0, 80)
    .map((x) => ({ s: x, p: nlp.sentence(x) }));
  const byText = new Map(preds.map((x) => [x.s, x.p]));
  const deadline = findDeadline({
    subject,
    text: main,
    ref: date ? new Date(date) : new Date(),
    scoreSentence: (x) => {
      const p = byText.get(x.trim()) || nlp.sentence(x);
      return p ? p.delai : null;
    }
  });
  const urgent = !!(deadline && deadline.urgent) || preds.some(({ p }) => p && p.urgent >= 0.7);
  const greet = main.match(/^\s*(?:salut|hello|hey|coucou|bonjour|bonsoir|yo|hi)\s+([A-ZÉÈÀÇ][\p{Ll}'-]+)/mu);
  const send = findSendTo(main, senderEmail);
  // Envois compris par le réseau de neurones (« tu le balances sur le drive »).
  for (const { s: x, p } of preds) {
    if (!p || p.envoi < 0.6) continue;
    // Les adresses des liens (drive.google.com…) ne disent pas par où envoyer.
    const words = x.replace(/https?:\/\/\S+/g, ' ');
    for (const [re, label] of DELIVERY) if (re.test(words) && !send.delivery.includes(label)) send.delivery.push(label);
    const to = x.match(/(?:^|[\s,(])(?:à|a|chez)\s+([A-ZÉÈÀ][\p{L}'-]+(?:\s+[A-ZÉÈÀ][\p{L}'-]+)?|(?:la |le |l')(?:client|cliente|prod|production|agence|marque|com|réal))/u);
    if (to && !send.sendTo.some((w) => plain(w) === plain(to[1]))) send.sendTo.push(to[1]);
  }
  const { music, musicLinks } = findMusic(main, links);
  const all = `${subject}\n${main}`;
  const budget = uniq([...all.matchAll(BUDGET_RE)].map((m) => m[0].replace(/\s+/g, ' ').trim())).slice(0, 4);
  const d = {
    summary: summaryOf(main),
    tasks: findTasks(main, preds),
    feedback: findFeedback(main, preds),
    deadline,
    urgent,
    sendTo: send.sendTo,
    delivery: send.delivery,
    software: uniq(SOFTWARE.filter(([re]) => re.test(all)).map(([, n]) => n)),
    people: findPeople(main, { senderName: sender, greetingName: greet ? greet[1] : '' }),
    transcript: transcript ? { text: transcript.text, lines: transcript.lines, title: transcript.title, intro: transcript.intro } : null,
    music,
    musicLinks,
    refs: findRefs(links),
    budget,
    phones: uniq(all.match(PHONE_RE) || []).slice(0, 3),
    points: uniq(POINTS.filter(([re]) => re.test(all)).map(([, n]) => n))
  };
  d.count =
    d.tasks.length + d.feedback.length + d.sendTo.length + d.software.length + d.people.length + (d.transcript ? 1 : 0) + d.music.length + d.refs.length + d.budget.length + d.phones.length;
  return d;
}

// ---------- Apprentissage ----------
// Bayes naïf sur les mots : messages devenus projets (montage) contre messages marqués
// « Pas un montage ». Plus quelques retenues par expéditeur.
const STOP = new Set(
  ('les des une un le la de du et en est pour pas que qui dans sur avec ton ton tes vos nos mon mes son ses ces cet cette aux par plus mais ' +
    'tout tous toute bien comme fait faire ete etre avoir sont nous vous ils elles elle lui leur leurs moi toi suis peux peut ' +
    'salut bonjour hello merci bonne journee cordialement the and for you your with this that are from have will can')
    .split(/\s+/)
);

function tokenize(text) {
  return [
    ...new Set(
      plain(text)
        .replace(/https?:\/\/\S+/g, ' lien_web ')
        .split(/[^a-z0-9_]+/)
        .filter((w) => w.length >= 3 && w.length <= 24 && !STOP.has(w) && !/^\d+$/.test(w))
    )
  ].slice(0, 400);
}

const emptyModel = () => ({ v: 1, pos: 0, neg: 0, tp: {}, tn: {}, senders: {} });
let MODEL = emptyModel();

function setModel(m) {
  MODEL = m && m.v === 1 ? m : emptyModel();
}

function getModel() {
  return MODEL;
}

function learn({ subject = '', text = '', sender = '' } = {}, positive) {
  const table = positive ? MODEL.tp : MODEL.tn;
  for (const w of tokenize(`${subject}\n${mainBody(text).main}`)) table[w] = (table[w] || 0) + 1;
  if (positive) MODEL.pos++;
  else MODEL.neg++;
  const key = plain(sender).trim();
  if (key) {
    const s = MODEL.senders[key] || (MODEL.senders[key] = { p: 0, n: 0 });
    if (positive) s.p++;
    else s.n++;
  }
  // Taille raisonnable : on oublie les mots vus une seule fois quand le vocabulaire grossit.
  for (const t of [MODEL.tp, MODEL.tn]) {
    const keys = Object.keys(t);
    if (keys.length > 6000) for (const k of keys) if (t[k] < 2) delete t[k];
  }
  return MODEL;
}

// Log-cote « montage » apprise (null tant qu'il y a trop peu d'exemples).
function learnedOdds({ subject = '', text = '', sender = '' } = {}) {
  if (MODEL.pos < 2 || MODEL.pos + MODEL.neg < 4) return null;
  const P = MODEL.pos + 1;
  const N = MODEL.neg + 1;
  let lo = Math.log(P / N) * 0.5;
  for (const w of tokenize(`${subject}\n${mainBody(text).main}`)) {
    const a = MODEL.tp[w] || 0;
    const b = MODEL.tn[w] || 0;
    if (a + b < 2) continue;
    lo += Math.log((a + 0.5) / P) - Math.log((b + 0.5) / N);
  }
  const s = MODEL.senders[plain(sender).trim()];
  if (s) lo += Math.max(-2, Math.min(2, (s.p - s.n) * 0.7));
  return Math.max(-8, Math.min(8, lo));
}

module.exports = { details, mainBody, sentences, findTranscript, findTasks, findFeedback, findPeople, tokenize, setModel, getModel, learn, learnedOdds };
