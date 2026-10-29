'use strict';
// Détection des demandes de montage dans un mail ou un message Chat :
// liens Drive (téléchargeables par Coffile), autres liens de transfert, formats,
// durées, date limite, mots-clés, et proposition de nom de projet.
const { parseDriveUrl, sanitizeName } = require('./drive');
const understand = require('./understand');
const nlp = require('./nlp');

const TRANSFER = [
  [/wetransfer\.com|we\.tl/i, 'WeTransfer'],
  [/dropbox\.com/i, 'Dropbox'],
  [/frame\.io|f\.io\//i, 'Frame.io'],
  [/swisstransfer\.com/i, 'SwissTransfer'],
  [/fromsmash\.com|smash\./i, 'Smash'],
  [/onedrive\.live\.com|1drv\.ms|sharepoint\.com/i, 'OneDrive'],
  [/icloud\.com\/iclouddrive/i, 'iCloud'],
  [/box\.com/i, 'Box'],
  [/vimeo\.com/i, 'Vimeo']
];

const KEYWORDS = [
  'montage', 'monter', 'rush', 'rushes', 'rushs', 'tournage', 'footage', 'vidéo', 'video', 'clip', 'edit', 'editing', 'export',
  'reel', 'reels', 'tiktok', 'short', 'shorts', 'story', 'teaser', 'trailer', 'interview', 'pub', 'spot', 'vlog', 'aftermovie',
  'mariage', 'derush', 'dérush', 'étalonnage', 'etalonnage', 'mixage', 'sous-titres', 'sous titres', 'livrable', 'livraison', 'brief',
  'premiere', 'cut', 'plans', 'b-roll', 'broll', 'motion'
];
const KW_RE = new RegExp(`(^|[^\\p{L}])(${KEYWORDS.map((k) => k.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})(?=$|[^\\p{L}])`, 'giu');

const FORMAT_RULES = [
  [/(^|[^0-9])9\s*[:x×/]\s*16([^0-9]|$)|vertical|verticale|story|stories|reels?\b|tiktok|shorts?\b/i, '9:16'],
  [/(^|[^0-9])16\s*[:x×/]\s*9([^0-9]|$)|horizontal|paysage|youtube/i, '16:9'],
  [/(^|[^0-9])1\s*[:x×]\s*1([^0-9]|$)|carr[ée]|square/i, '1:1'],
  [/(^|[^0-9])4\s*[:x×]\s*5([^0-9]|$)/i, '4:5']
];

const DAYS = 'lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche';
const MONTHS = 'janv(?:ier)?|f[ée]vr?(?:ier)?|mars|avr(?:il)?|mai|juin|juil(?:let)?|ao[uû]t|sept(?:embre)?|oct(?:obre)?|nov(?:embre)?|d[ée]c(?:embre)?';
const DEADLINE_RE = new RegExp(
  `(?:pour|avant|d'ici|deadline|d[ée]lai|livraison|rendu|à rendre|a rendre)\\s*(?:le|la|:|au plus tard)?\\s*((?:${DAYS})(?:\\s+\\d{1,2}(?:\\s+(?:${MONTHS}))?)?|\\d{1,2}[/.]\\d{1,2}(?:[/.]\\d{2,4})?|\\d{1,2}\\s+(?:${MONTHS})|demain|ce soir|aujourd'hui|fin de (?:la )?semaine|la semaine prochaine|semaine prochaine|lundi prochain)`,
  'i'
);
const DURATION_RE = /(\d{1,3})\s*(s|sec|secondes?|seconds?|min|minutes?|mn)(?![\p{L}])/giu;

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function htmlToText(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<(style|script|head|title)[\s\S]*?<\/\1>/gi, ' ')
      // Balises dans le fil du texte (Gmail coupe les longs liens avec <wbr>) : sans espace ajouté.
      .replace(/<\/?(wbr|a|span|b|strong|i|em|u|font|small|sub|sup|abbr|code)\b[^>]*>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

// Version imprimable d'un fil Gmail (?view=pt) : titre, compte connecté, objet, puis pour chaque
// message une ligne « Expéditeur <adresse>  date », une ligne « À : … » et le texte.
// Renvoie les messages séparés ; self = adresse du compte (en haut de la page).
const EMAIL_IN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
function parsePrintView(html) {
  const src = String(html || '');
  const parts = src.split(/<table\b[^>]*class=["']?message["']?[^>]*>/i);
  if (parts.length < 2) return null;
  const headMatch = htmlToText(parts[0].split(/class=["']?maincontent/i)[0]).match(EMAIL_IN);
  const messages = parts.slice(1).map((seg) => {
    const first = seg.match(/^[\s\S]*?<\/tr>/);
    let from = '';
    let email = '';
    let date = '';
    let rest = seg;
    // 1re ligne = en-tête (nom en gras, adresse, date à droite) ; sinon c'est déjà le texte.
    if (first && /<b\b|&lt;[^&]*@|align=["']?right/i.test(first[0])) {
      const head = first[0];
      const b = head.match(/<b\b[^>]*>([\s\S]*?)<\/b>/i);
      from = b ? htmlToText(b[1]).trim() : '';
      const e = htmlToText(head).match(EMAIL_IN);
      email = e ? e[0].toLowerCase() : '';
      const d = head.match(/<td[^>]*align=["']?right["']?[^>]*>([\s\S]*?)<\/td>/i);
      date = d ? htmlToText(d[1]).trim() : '';
      rest = seg.slice(head.length);
    }
    const rec = rest.match(/<font[^>]*class=["']?recipient["']?[^>]*>([\s\S]*?)<\/font>/i);
    const to = rec ? htmlToText(rec[1]).replace(/\s+/g, ' ').trim() : '';
    if (rec) rest = rest.replace(rec[0], '');
    // Le trait qui sépare deux messages dans la page n'appartient pas au message.
    return { from, email, date, to, html: rest.replace(/<hr[^>]*>\s*$/i, '') };
  });
  return { self: headMatch ? headMatch[0].toLowerCase() : '', messages };
}

// Ne garde que le texte des messages (sans en-têtes ni ta propre adresse) ; tes réponses dans le fil
// sont laissées de côté quand d'autres personnes ont écrit.
function cleanPrintView(html) {
  const pv = parsePrintView(html);
  if (!pv || !pv.messages.length) return html;
  const others = pv.messages.filter((m) => !pv.self || m.email !== pv.self);
  const keep = others.length ? others : pv.messages;
  return keep.map((m) => `<div class="coffile-msg">${m.html}</div>`).join('<hr>');
}

// Les liens de Gmail passent parfois par google.com/url?q=… : on retrouve la vraie adresse.
function unwrap(url) {
  try {
    const u = new URL(url);
    if (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname === '/url') return u.searchParams.get('q') || u.searchParams.get('url') || url;
  } catch {}
  return url;
}

function extractLinks(text, html) {
  const found = new Set();
  const add = (u) => {
    u = unwrap(decodeEntities(u).replace(/[)\].,;:!?'"»>]+$/, ''));
    if (/^https?:\/\//i.test(u)) found.add(u);
  };
  for (const m of String(text || '').matchAll(/https?:\/\/[^\s<>"'`]+/gi)) add(m[0]);
  for (const m of String(html || '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  return [...found];
}

// Texte du mail avec les liens écrits en clair (« texte du lien adresse »), pour retrouver
// ce qui est écrit juste avant chaque lien.
function htmlToTextWithLinks(html) {
  return htmlToText(
    String(html || '').replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
      const label = htmlToText(inner);
      // Texte de lien sans intérêt (« ici », l'adresse elle-même…) : seul le lien est gardé.
      const keep = label && !/^(ici|là|la|here|lien|link|cliquez ici|click here|ouvrir|open|voir|view|https?:\/\/\S+)$/i.test(label.trim());
      return `${keep ? label : ''} ${unwrap(decodeEntities(href))} `;
    })
  );
}

const cleanContext = (str) =>
  String(str || '')
    .replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, ' ')
    .replace(/^[\s\-–—•*·>]+/, '')
    .replace(/[\s:：\-–—→>»|•*=(]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();

// Texte écrit juste avant un lien : sur la même ligne (après un éventuel lien précédent),
// sinon la ligne au-dessus. Ex. « Rushes caméra A : https://… » → « Rushes caméra A ».
function contextBefore(text, key) {
  const idx = String(text || '').indexOf(key);
  if (idx < 0) return '';
  let start = text.lastIndexOf('http', idx);
  if (start < 0 || idx - start > 400) start = idx;
  const lines = text.slice(0, start).split('\n');
  const segment = (line) => cleanContext(line.split(/https?:\/\/\S+/).pop());
  let ctx = segment(lines[lines.length - 1]);
  for (let k = lines.length - 2; ctx.length < 3 && k >= Math.max(0, lines.length - 4); k--) ctx = segment(lines[k]);
  return ctx.length >= 3 ? ctx.slice(-120) : '';
}

// Nom de dossier proposé pour un lien, à partir de son texte (« Rushes caméra A »).
function labelFrom(context, i) {
  let str = cleanContext(context).replace(/[:/\\|]+/g, ' ');
  // Retire les mots d'introduction (« Voici les », « Et le », « le lien des »…).
  for (let k = 0; k < 4; k++) str = str.replace(/^(voici|voilà|voila|ici|et|puis|aussi|le lien|les liens|lien|link|le|la|les|l'|des|du|de)\b['\s,]*/i, '');
  const words = str.split(/\s+/).filter(Boolean);
  let label = sanitizeName(words.slice(-6).join(' ')).replace(/^sans_nom$/, '');
  label = label.charAt(0).toUpperCase() + label.slice(1);
  return label.length >= 2 ? label.slice(0, 50) : `Lien ${i + 1}`;
}

// Nom de projet proposé à partir de l'objet (ou du texte), sans « Re: », « TR: », émojis…
function suggestName(subject, text, sender) {
  let s = String(subject || '');
  const quoted = s.match(/["“«]\s*([^"”»]{2,80})\s*["”»]/);
  if (quoted) s = quoted[1];
  s = s
    .replace(/^\s*((re|fwd?|tr|réf|ref|aw|wg)\s*:\s*)+/i, '')
    .replace(/\b(dossier|fichier)s?\s+partag[ée]s?\s+avec\s+vous\b\s*:?/i, '')
    .replace(/\b(shared with you|invitation to (edit|view))\b\s*:?/i, '')
    .replace(/[\p{Extended_Pictographic}‍️]/gu, '')
    .replace(/[\[\]{}()]/g, ' ')
    .trim();
  // Objet trop vague (« Rushes », « Lien drive »…) : on part de l'expéditeur et de la 1re ligne du texte.
  if (!s || /^(rush(es)?|lien( drive)?|drive|vid[ée]os?|montage|fichiers?|les fichiers)$/i.test(s)) {
    const first = String(text || '')
      .replace(/https?:\/\/\S+/g, '')
      .split('\n')
      .map((l) => l.trim())
      .map((l) => l.replace(/^((salut|hello|hey|coucou|bonjour|yo|hi|voici|voilà|voila|ci-joint|les|le|la|des|du)\b[\s,!:.]*)+/i, ''))
      .find((l) => l.length > 3) || '';
    s = [sender, first ? first.split(/\s+/).slice(0, 4).join(' ') : ''].filter(Boolean).join(' ') || s;
  }
  const words = s.split(/\s+/).filter((w) => w && !/^[-–—:|·•+]+$/.test(w)).slice(0, 8);
  return sanitizeName(words.join('_')).replace(/_+/g, '_').slice(0, 60) || 'Nouveau_montage';
}

// date : date du message (les « demain », « vendredi »… sont calculés à partir d'elle).
function analyze({ subject = '', text = '', html = '', attachments = [], sender = '', senderEmail = '', date = null } = {}) {
  const body = text || htmlToText(html);
  const all = `${subject}\n${body}`;
  const links = extractLinks(body, html);
  const drive = [];
  const others = [];
  const seen = new Set();
  for (const url of links) {
    const p = parseDriveUrl(url);
    if (p && p.kind !== 'native') {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      drive.push({ url, id: p.id, kind: p.kind === 'folder' ? 'folder' : p.kind === 'file' ? 'file' : 'link' });
      continue;
    }
    const t = TRANSFER.find(([re]) => re.test(url));
    if (t) others.push({ url, service: t[1] });
  }
  // Texte écrit avant chaque lien (affiché devant le lien, et nom de dossier proposé).
  const rich = html ? htmlToTextWithLinks(html) : '';
  // Liens dans l'ordre où ils apparaissent dans le message.
  const where = (d) => {
    const pos = (rich || body).indexOf(d.id);
    return pos < 0 ? Infinity : pos;
  };
  drive.sort((x, y) => where(x) - where(y));
  drive.forEach((d, i) => {
    d.context = contextBefore(body, d.id) || contextBefore(rich, d.id);
    d.label = labelFrom(d.context, i);
  });
  for (const o of others) {
    const key = o.url.replace(/^https?:\/\//, '').slice(0, 40);
    o.context = contextBefore(body, key) || contextBefore(rich, key);
  }

  const words = all.replace(/https?:\/\/\S+/g, ' ');
  const keywords = [...new Set([...words.matchAll(KW_RE)].map((m) => m[2].toLowerCase()))].slice(0, 8);
  const formats = FORMAT_RULES.filter(([re]) => re.test(all)).map(([, f]) => f);
  const durations = [...new Set([...all.matchAll(DURATION_RE)].map((m) => `${Number(m[1])} ${/^m/i.test(m[2]) ? 'min' : 's'}`))].slice(0, 4);
  const details = understand.details({ subject, text: body, sender, senderEmail, links, date });
  // Date limite comprise (« pour ajdh » → la date du jour du message) ; sinon l'ancienne règle.
  const dl = all.match(DEADLINE_RE);
  const deadline = details.deadline ? details.deadline.label : dl ? dl[1].trim() : null;
  const videoFiles = attachments.filter((a) => /\.(mp4|mov|mxf|avi|mkv|m4v|r3d|braw)$/i.test(a.filename || '') || /^video\//.test(a.mimeType || ''));

  let score = 0;
  score += drive.filter((d) => d.kind === 'folder').length * 6 + drive.filter((d) => d.kind !== 'folder').length * 4;
  score += others.length * 3;
  score += Math.min(keywords.length, 5);
  score += formats.length ? 1 : 0;
  score += durations.length ? 1 : 0;
  score += deadline ? 1 : 0;
  score += videoFiles.length * 3;

  // Ce que Coffile a appris de tes choix (projets créés, « Pas un montage »).
  const odds = understand.learnedOdds({ subject, text: body, sender });
  if (odds != null) score += Math.max(-3, Math.min(3, Math.round(odds / 2)));

  // Un lien Drive vers des fichiers suffit (c'est ce que Coffile sait télécharger) ;
  // un autre service de transfert doit être accompagné de mots-clés de montage.
  // L'apprentissage ajoute les demandes sans lien qui ressemblent à tes montages,
  // et écarte les transferts qui ressemblent à ce que tu as refusé.
  let isMontage = drive.length > 0 || (others.length > 0 && keywords.length > 0) || videoFiles.length > 0;
  if (isMontage && !drive.length && !videoFiles.length && odds != null && odds < -3) isMontage = false;
  // Réseau de neurones : repère les demandes formulées autrement (« tu peux me sortir un reel… »).
  const nnMontage = nlp.montage(`${subject}\n${understand.mainBody(body).main}`);
  if (nnMontage != null) {
    score += nnMontage > 0.9 ? 2 : nnMontage < 0.1 ? -1 : 0;
    if (isMontage && !drive.length && !videoFiles.length && nnMontage < 0.05 && (odds == null || odds < 1)) isMontage = false;
  }
  return {
    isMontage,
    score,
    level: !isMontage ? 'none' : score >= 9 ? 'strong' : 'medium',
    drive,
    others,
    keywords,
    formats,
    durations,
    deadline,
    deadlineDate: details.deadline ? details.deadline.date : null,
    deadlineTime: details.deadline ? details.deadline.time : null,
    deadlinePart: details.deadline ? details.deadline.part : null,
    urgent: details.urgent,
    nn: nnMontage == null ? null : Math.round(nnMontage * 100),
    videoFiles: videoFiles.map((a) => ({ filename: a.filename, size: a.size || 0 })),
    name: suggestName(subject, body, sender),
    learned: odds == null ? null : Math.round(100 / (1 + Math.exp(-odds))),
    details
  };
}

// Messages Chat : une demande est souvent écrite en plusieurs messages à la suite (les liens, puis
// « je te joins le texte… », puis le texte). Les messages d'une même personne à moins de 20 min
// d'écart sont lus ensemble ; la demande est rattachée au message qui porte le lien (sinon le 1er),
// les autres messages du groupe n'en sont pas une de plus.
const GROUP_GAP = 20 * 60000;
function analyzeChat(messages) {
  const list = messages.filter(Boolean).slice().sort((a, b) => (a.date || 0) - (b.date || 0));
  const groups = [];
  for (const m of list) {
    const g = groups[groups.length - 1];
    const last = g && g[g.length - 1];
    if (last && last.sender === m.sender && Math.abs((m.date || 0) - (last.date || 0)) <= GROUP_GAP) g.push(m);
    else groups.push([m]);
  }
  for (const g of groups) {
    const own = g.map((m) => analyze({ text: m.text, attachments: m.attachments || [], sender: '', date: m.date }));
    g.forEach((m, i) => (m.analysis = own[i]));
    if (g.length < 2) continue;
    const owner = g.findIndex((m, i) => own[i].drive.length || own[i].others.length || own[i].videoFiles.length);
    if (owner < 0) continue;
    const whole = analyze({ text: g.map((m) => m.text).join('\n'), attachments: g.flatMap((m) => m.attachments || []), sender: '', date: g[0].date });
    whole.group = g.map((m) => m.id);
    g.forEach((m, i) => {
      if (i === owner) m.analysis = whole;
      else if (whole.isMontage) m.analysis = { ...own[i], isMontage: false, level: 'none', partOf: g[owner].id };
    });
  }
  return messages;
}

module.exports = { analyze, analyzeChat, parsePrintView, cleanPrintView, extractLinks, htmlToText, htmlToTextWithLinks, suggestName, unwrap, contextBefore, labelFrom };
