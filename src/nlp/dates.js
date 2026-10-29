'use strict';
// Dates limites : retrouve « pour ajdh », « d'ici demain soir », « vendredi 18h », « sous 48h »,
// « le 14/11 », « semaine pro », « asap »… et les transforme en vraie date, calculée à partir
// de la date du message (« demain » dans un mail d'hier, c'est aujourd'hui).
const { normalize } = require('./normalize');

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = [
  ['janvier', 'janv'],
  ['fevrier', 'fevr', 'fev'],
  ['mars'],
  ['avril', 'avr'],
  ['mai'],
  ['juin'],
  ['juillet', 'juil'],
  ['aout'],
  ['septembre', 'sept'],
  ['octobre', 'oct'],
  ['novembre', 'nov'],
  ['decembre', 'dec']
];
const MONTH_RE = MONTHS.map((m) => m.join('|')).join('|');
const monthIndex = (word) => MONTHS.findIndex((m) => m.includes(word));

// Mots qui annoncent une échéance (« pour », « avant », « d'ici »…) et mots d'événements
// qui n'en sont pas (« tournage vendredi », « réunion demain »).
const CUE_NEAR = /(pour|avant|d'ici|au plus tard|max|maximum|deadline|delai|dernier delai|a rendre|a livrer|livraison|rendu|due|jusqu'a|il me le faut|il me la faut|il nous le faut|on le veut|on la veut)(?:[\s:,=-]|c'est|est|sera|prevue?|fixee?)*(?:le|la|ce|cette|l')?\s*$/;
// Mot d'échéance juste après la date : « ajd ou dmain max », « vendredi dernier délai ».
const CUE_AFTER = /^\s*(?:,\s*)?(max|maximum|au plus tard|dernier delai|grand max|sans faute|imperativement|s'il te plait)/;
// « pas pressé », « quand tu peux » : pas d'urgence.
const NOT_URGENT = /\b(pas|plus|rien d')\s*(?:tres |si |trop )?(presse|pressee|urgent|urgente|d'urgence)|sans urgence|pas de rush|prends? ton temps|quand tu (?:peux|pourras|as le temps|auras le temps|veux)|a ton rythme/;
const CUE_ANY = /\b(il faut|faut|max|il faudra|il faudrait|besoin|attend|pret|prete|prets|dispo|disponible|termine|terminee|fini|finie|finir|boucler|livr\w*|rend\w*|publi\w*|post\w*|sortie|en ligne|diffus\w*|valid\w*|envoie\w*|envoyer|monter|montee|monte|export\w*|urgent|urgence|vite|deadline|delai)\b/;
const ANTI = /\b(tournage|tourne|tournee|on tourne|filme|filmer|filmera|reunion|rendez-vous|call|visio|appel|on se voit|on s'appelle|vacances|absent|absente|ferme|fermee|anniversaire|soiree|diner|dejeuner|match|concert|reveillon|ouvert|ouverture|depuis|hier|la semaine derniere|dernier|derniere|passe|il y a)\b/;
const ASAP = /\b(au plus vite|urgent|urgente|urgence|presse|pressee|tout de suite|immediatement|en priorite|priorite|des maintenant|maintenant)\b/;

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function nextWeekday(ref, day, { strict = false, nextWeek = false } = {}) {
  let delta = (day - ref.getDay() + 7) % 7;
  if (strict && delta === 0) delta = 7;
  if (nextWeek) {
    // « lundi prochain » : le lundi de la semaine suivante.
    const monday = addDays(ref, ((1 - ref.getDay() + 7) % 7) || 7);
    return addDays(monday, (day + 6) % 7);
  }
  return addDays(ref, delta);
}

function timeAfter(s, from) {
  const m = s.slice(from, from + 22).match(/^\s*(?:,|a|avant|vers|pour|d'ici|max|au plus tard)?\s*(\d{1,2})\s*(?:h|heures|:)\s*(\d{2})?(?!\d)|^\s*(?:a |avant |vers )?(midi|minuit)/);
  if (!m) return null;
  if (m[3]) return { time: m[3] === 'midi' ? '12:00' : '23:59', len: m[0].length };
  const h = Number(m[1]);
  if (h > 23) return null;
  return { time: `${pad(h)}:${m[2] || '00'}`, len: m[0].length };
}

// Toutes les expressions de date d'une phrase (déjà normalisée).
function findDates(s, ref) {
  const today = startOfDay(ref);
  const out = [];
  const taken = [];
  const free = (a, b) => !taken.some(([x, y]) => a < y && b > x);
  const add = (m, date, kind, extra = {}) => {
    const a = m.index;
    let b = a + m[0].length;
    if (!free(a, b)) return;
    let time = extra.time || null;
    if (!time && date && !extra.part) {
      const t = timeAfter(s, b);
      if (t) {
        time = t.time;
        b += t.len;
      }
    }
    taken.push([a, b]);
    out.push({ index: a, end: b, raw: s.slice(a, b).trim(), date, time, kind, ...extra });
  };
  const each = (re, fn) => {
    for (const m of s.matchAll(re)) fn(m);
  };
  each(/\b(au plus vite|tout de suite|immediatement|des maintenant)\b/g, (m) => add(m, today, 'asap', { asap: true }));
  each(/\bapres-demain\b/g, (m) => add(m, addDays(today, 2), 'relative'));
  each(/\bdemain(?: (matin|midi|soir|apres-midi))?\b/g, (m) => add(m, addDays(today, 1), 'relative', { part: m[1] ? m[1].replace('apres-midi', 'après-midi') : null }));
  each(/\b(aujourd'hui|ce soir|ce matin|ce midi|cet apres-midi|cette apres-midi|dans la journee|fin de journee|avant ce soir|tantot|ce jour)\b/g, (m) =>
    add(m, today, 'today', { part: /soir/.test(m[1]) ? 'soir' : /fin de journee/.test(m[1]) ? 'fin de journée' : /matin/.test(m[1]) ? 'matin' : /midi/.test(m[1]) ? (/apres/.test(m[1]) ? 'après-midi' : 'midi') : null })
  );
  each(/\b(dans|sous|d'ici|en)\s+(\d{1,3})\s*(jours?|j|semaines?|heures?|h|minutes?)\b/g, (m) => {
    const n = Number(m[2]);
    const unit = m[3];
    // « sous 48h », « d'ici 2 jours » annoncent déjà une échéance.
    const cue = m[1] !== 'dans' && m[1] !== 'en';
    if (/^h|^heure|^minute/.test(unit)) add(m, /^h|^heure/.test(unit) && n >= 24 ? addDays(today, Math.round(n / 24)) : today, 'relative', { cue });
    else add(m, addDays(today, /^sem/.test(unit) ? n * 7 : n), 'relative', { cue });
  });
  // « avant midi », « pour 18h », « d'ici 17h30 » : aujourd'hui à cette heure.
  each(/\b(?:avant|pour|d'ici|max|au plus tard a)\s+(midi|(\d{1,2})\s*(?:h|heures)\s*(\d{2})?)(?!\s*(?:de |d'|minutes))/g, (m) => {
    const h = m[1] === 'midi' ? 12 : Number(m[2]);
    if (h > 23) return;
    add(m, today, 'today', { time: `${pad(h)}:${m[3] || '00'}`, cue: true });
  });
  each(/\b(?:(fin de )?(?:la )?semaine prochaine|debut de (?:la )?semaine prochaine)\b/g, (m) =>
    add(m, m[1] ? nextWeekday(today, 5, { nextWeek: true }) : nextWeekday(today, 1, { nextWeek: true }), 'period')
  );
  each(/\b(cette semaine|fin de semaine|avant le week-end|d'ici la fin de (?:la )?semaine|ce week-end|le week-end)\b/g, (m) =>
    add(m, /week-end/.test(m[1]) && !/avant/.test(m[1]) ? nextWeekday(today, 0) : today.getDay() === 6 || today.getDay() === 0 ? nextWeekday(today, 5) : nextWeekday(today, 5), 'period')
  );
  each(/\b(fin du mois|fin de mois|fin de ce mois)\b/g, (m) => add(m, new Date(today.getFullYear(), today.getMonth() + 1, 0), 'period'));
  each(/\b(debut du mois prochain|le mois prochain|mois prochain)\b/g, (m) => add(m, new Date(today.getFullYear(), today.getMonth() + 1, 1), 'period'));
  // « 14 novembre », « le 1er dec 2025 »
  each(new RegExp(`\\b(?:le )?(\\d{1,2})(?:er)?\\s+(${MONTH_RE})\\.?(?:\\s+(\\d{4}))?\\b`, 'g'), (m) => {
    const day = Number(m[1]);
    const month = monthIndex(m[2]);
    if (day < 1 || day > 31 || month < 0) return;
    add(m, explicitDate(today, day, month, m[3] && Number(m[3])), 'explicit');
  });
  // « vendredi », « lundi prochain », « jeudi 14 »
  each(/\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)( prochain)?(?:\s+(\d{1,2})(?!\s*(?:h|heures|:)))?\b/g, (m) => {
    const day = DAYS.indexOf(m[1]);
    if (m[3]) {
      const n = Number(m[3]);
      if (n >= 1 && n <= 31) return add(m, dayOfMonth(today, n), 'explicit');
    }
    add(m, nextWeekday(today, day, { nextWeek: !!m[2] }), 'weekday');
  });
  // « 14/11 », « 14.11.2025 », « 2025-11-14 »
  each(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => add(m, new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), 'explicit'));
  each(/\b(?:le )?(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b(?![.\d]*\s*(?:mo|go|ko|%|fps))/g, (m) => {
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    if (day < 1 || day > 31 || month < 0 || month > 11) return;
    let year = m[3] ? Number(m[3]) : null;
    if (year && year < 100) year += 2000;
    add(m, explicitDate(today, day, month, year), 'explicit');
  });
  // « le 14 » seul (avec un mot d'échéance devant, vérifié plus loin)
  each(/\ble (\d{1,2})(?:er)?\b(?!\s*(?:h|heures|:|minutes?|secondes?|s\b|%|euros?|eur|fps|k\b|go|mo|x\b|\/|\.|plans?|rushes|videos?|fichiers?|images?|photos?|personnes?|min\b))/g, (m) => {
    const n = Number(m[1]);
    if (n >= 1 && n <= 31) add(m, dayOfMonth(today, n), 'explicit', { weak: true });
  });
  each(/\b(urgent|urgente|urgence|presse|pressee|en priorite)\b/g, (m) => add(m, today, 'asap', { asap: true }));
  return out.sort((a, b) => a.index - b.index);
}

function explicitDate(today, day, month, year) {
  let d = new Date(year || today.getFullYear(), month, day);
  // Sans année : une date passée de plus d'une semaine est pour l'an prochain.
  if (!year && d < addDays(today, -7)) d = new Date(today.getFullYear() + 1, month, day);
  return d;
}

function dayOfMonth(today, n) {
  let d = new Date(today.getFullYear(), today.getMonth(), n);
  if (d < addDays(today, -3)) d = new Date(today.getFullYear(), today.getMonth() + 1, n);
  return d;
}

const sentencesOf = (text) =>
  String(text || '')
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

// Choisit la date limite d'un message. scoreSentence(phrase) peut donner la probabilité
// (réseau de neurones) que la phrase parle d'une échéance.
function findDeadline({ subject = '', text = '', ref = new Date(), scoreSentence = null } = {}) {
  const refDate = ref instanceof Date && !Number.isNaN(ref.getTime()) ? ref : new Date();
  let best = null;
  const all = [];
  const lines = [...(subject ? [{ s: subject, subject: true }] : []), ...sentencesOf(text).slice(0, 80).map((s) => ({ s }))];
  for (const { s: original, subject: isSubject } of lines) {
    const s = normalize(original);
    if (!s) continue;
    const found = findDates(s, refDate);
    if (!found.length) continue;
    const nn = scoreSentence ? scoreSentence(original) : null;
    const anyCue = CUE_ANY.test(s);
    const anti = ANTI.test(s);
    const calm = NOT_URGENT.test(s);
    for (const f of found) {
      if (f.asap && calm) continue;
      const near = f.cue || CUE_NEAR.test(s.slice(Math.max(0, f.index - 30), f.index)) || CUE_AFTER.test(s.slice(f.end, f.end + 20));
      let score = 0;
      if (f.asap) score += 2.2;
      if (near) score += 2.5;
      if (anyCue) score += 1;
      if (anti && !near) score -= 2.5;
      if (f.weak && !near) score -= 2;
      if (isSubject) score += 0.6;
      if (nn != null) score += (nn - 0.5) * 4;
      if (f.kind === 'explicit' && !near && !anyCue) score -= 1;
      const cand = { ...f, score, sentence: original.trim().slice(0, 200) };
      all.push(cand);
      if (!best || score > best.score) best = cand;
    }
  }
  // « C'est pressé, on poste demain matin » : la vraie date l'emporte sur « pressé » (qui reste urgent).
  if (best && best.asap) {
    const concrete = all.filter((c) => !c.asap && c.sentence === best.sentence && c.score >= best.score - 2.5).sort((x, y) => y.score - x.score)[0];
    if (concrete) best = { ...concrete, asap: true, score: Math.max(best.score, concrete.score) };
  }
  if (!best || best.score < 1.4) return null;
  const bestNorm = normalize(best.sentence);
  const urgent = !NOT_URGENT.test(bestNorm) && (!!best.asap || ASAP.test(bestNorm));
  const asapOnly = best.kind === 'asap';
  return {
    date: iso(best.date),
    time: best.time,
    part: best.part || null,
    urgent,
    phrase: best.raw,
    sentence: best.sentence,
    label: labelFor(best.date, best.time, refDate, asapOnly, best.part)
  };
}

const SHORT_DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const SHORT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

// Libellé relatif à une date de référence : « Aujourd'hui », « Demain 18:00 », « Vendredi 14 nov. »…
function labelFor(date, time, ref = new Date(), asap = false, part = null) {
  const d = typeof date === 'string' ? new Date(`${date}T00:00:00`) : date;
  const days = Math.round((startOfDay(d) - startOfDay(ref)) / 86400000);
  const at = time ? ` ${time.replace(':', 'h').replace(/h00$/, 'h')}` : part ? ` ${part}` : '';
  const full = `${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
  if (asap && days <= 0) return 'Au plus vite';
  if (days < 0) return `En retard · ${full}`;
  if (days === 0) return !time && part && /soir|matin|midi/.test(part) ? `Ce ${part === 'après-midi' ? 'après-midi' : part}` : `Aujourd'hui${at}`;
  if (days === 1) return `Demain${at}`;
  if (days === 2) return `Après-demain${at}`;
  if (days < 7) return `${DAYS[d.getDay()].charAt(0).toUpperCase()}${DAYS[d.getDay()].slice(1)} ${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}${at}`;
  return `${full}${at}`;
}

module.exports = { findDates, findDeadline, labelFor, iso };
