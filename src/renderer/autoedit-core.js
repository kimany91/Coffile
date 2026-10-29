// AUTOEDIT : coupe des blancs et bout à bout (utilisé par l'interface et par les tests).
// Le volume de chaque rush (20 valeurs par seconde, en dB) donne le niveau du fond (silence)
// et celui de la parole ; tout passage plus calme que le seuil pendant au moins « pause minimale »
// est un blanc, retiré du montage (avec une petite marge autour de la parole).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AutoEditCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const RATE = 20;

  function quantile(sorted, p) {
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
  }

  // Niveau du fond et de la parole d'un rush (null si pas de son exploitable).
  function levels(db) {
    if (!db || db.length < RATE) return null;
    const s = Array.from(db).sort((a, b) => a - b);
    return { floor: quantile(s, 0.1), speech: quantile(s, 0.9) };
  }

  // sensitivity 0..100 : plus c'est haut, plus les passages calmes sont coupés.
  function threshold(db, sensitivity = 50) {
    const l = levels(db);
    // Écart trop faible entre fond et parole : son continu (musique, ambiance), pas de blancs nets.
    if (!l || l.speech - l.floor < 10) return null;
    const k = 0.2 + 0.45 * (Math.max(0, Math.min(100, sensitivity)) / 100);
    return l.floor + k * (l.speech - l.floor);
  }

  const DEFAULTS = { sensitivity: 50, minPause: 0.5, pad: 0.12, minKeep: 0.3 };

  // Parties gardées d'un rush : { segments: [{ in, out }], mode: 'cut' | 'whole', reason, removed }.
  function cutClip(env, duration, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const whole = (reason) => ({ segments: duration > 0 ? [{ in: 0, out: duration }] : [], mode: 'whole', reason, removed: 0 });
    if (!(duration > 0)) return whole('durée inconnue');
    if (o.enabled === false) return whole('coupe désactivée');
    if (!env || env.noAudio || !env.db || !env.db.length) return whole('sans son');
    const db = env.db;
    const rate = env.rate || RATE;
    const T = threshold(db, o.sensitivity);
    if (T == null) return whole('pas de blancs nets');
    const n = Math.min(db.length, Math.ceil(duration * rate));
    // Passages calmes assez longs.
    const silences = [];
    for (let i = 0; i < n; ) {
      if (db[i] > T) {
        i++;
        continue;
      }
      let j = i;
      while (j < n && db[j] <= T) j++;
      const a = i / rate;
      const b = j >= n ? duration : j / rate;
      const edge = i === 0 || j >= n;
      // En début ou fin de rush, un blanc plus court suffit.
      if (b - a >= (edge ? Math.min(o.minPause, 0.25) : o.minPause)) silences.push([a, b]);
      i = j;
    }
    // Ce qui reste, avec une marge autour de la parole.
    let keep = [];
    let cur = 0;
    for (const [a, b] of silences) {
      if (a > cur) keep.push([cur, a]);
      cur = b;
    }
    if (cur < duration) keep.push([cur, duration]);
    keep = keep.map(([a, b]) => [Math.max(0, a - o.pad), Math.min(duration, b + o.pad)]);
    const merged = [];
    for (const k of keep) {
      const last = merged[merged.length - 1];
      if (last && k[0] - last[1] < 0.08) last[1] = Math.max(last[1], k[1]);
      else merged.push(k.slice());
    }
    const segments = merged.filter(([a, b]) => b - a >= o.minKeep).map(([a, b]) => ({ in: round(a), out: round(b) }));
    const kept = segments.reduce((s, x) => s + x.out - x.in, 0);
    // Presque rien de gardé : plan d'illustration (ambiance), on le garde en entier.
    if (kept < duration * 0.15) return whole('presque pas de parole');
    return { segments, mode: 'cut', reason: '', removed: round(duration - kept) };
  }

  const round = (x) => Math.round(x * 1000) / 1000;

  // Bout à bout : clips dans l'ordre du classement → segments placés sur la timeline.
  // clips : [{ path, duration, env, cut (bool) }] ; renvoie { segments: [{ clip, path, in, out, start, end }], total, perClip }
  function buildSequence(clips, opts = {}) {
    const segments = [];
    const perClip = [];
    let t = 0;
    clips.forEach((c, idx) => {
      const r = cutClip(c.env, c.duration, { ...opts, enabled: c.cut !== false });
      perClip.push({ ...r, count: r.segments.length });
      for (const s of r.segments) {
        const len = s.out - s.in;
        segments.push({ clip: idx, path: c.path, in: s.in, out: s.out, start: round(t), end: round(t + len) });
        t += len;
      }
    });
    return { segments, total: round(t), perClip };
  }

  // Fin ajoutée après le bout à bout : vidéo entière (sans coupe) ou image fixe.
  // ending : { kind: 'video' | 'image', path, duration, clip }
  function withEnding(seq, ending) {
    if (!ending || !(ending.duration > 0)) return seq;
    const start = seq.total;
    const seg = { path: ending.path, in: 0, out: round(ending.duration), start, end: round(start + ending.duration), ending: true };
    if (ending.kind === 'image' || ending.kind === 'mogrt') seg.kind = ending.kind;
    else seg.clip = ending.clip;
    return { ...seq, segments: [...seq.segments, seg], total: seg.end };
  }

  // Segment qui contient l'instant t de la timeline.
  function segmentAt(segments, t) {
    let lo = 0;
    let hi = segments.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (t < segments[mid].start) hi = mid - 1;
      else if (t >= segments[mid].end) lo = mid + 1;
      else return mid;
    }
    return segments.length && t >= segments[segments.length - 1].end ? segments.length - 1 : Math.max(0, Math.min(segments.length - 1, lo));
  }

  // Images actives à l'instant t (la dernière ajoutée passe devant).
  function overlayAt(overlays, t) {
    let best = null;
    for (const o of overlays) if (t >= o.start && t < o.start + o.duration && (!best || o.start >= best.start)) best = o;
    return best;
  }

  function fmtTime(t, precise) {
    const s = Math.max(0, t);
    const m = Math.floor(s / 60);
    const sec = s - m * 60;
    return `${String(m).padStart(2, '0')}:${precise ? sec.toFixed(1).padStart(4, '0') : String(Math.floor(sec)).padStart(2, '0')}`;
  }

  // ---------- Sous-titres ----------
  // Réglages d'un preset : style (police, couleurs, position) et découpage (lignes, caractères, durées).
  const SUB_DEFAULTS = {
    font: 'Montserrat', size: 58, bold: true, italic: false, upper: false,
    color: '#FFFFFF', strokeColor: '#000000', strokeWidth: 5, shadow: true,
    bg: false, bgColor: '#000000', bgOpacity: 60, bgRadius: 10,
    position: 'bottom', margin: 9, align: 'center',
    maxLines: 2, maxChars: 32, minDuration: 0.8, maxDuration: 4, pauseBreak: 0.7, noPunct: false
  };
  const DEFAULT_PRESETS = [
    { ...SUB_DEFAULTS, id: 'classique', name: 'Classique' },
    { ...SUB_DEFAULTS, id: 'reseaux', name: 'Réseaux sociaux', size: 80, upper: true, color: '#FFE14D', strokeWidth: 8, position: 'middle', margin: 0, maxLines: 1, maxChars: 16, maxDuration: 2, minDuration: 0.4, pauseBreak: 0.5, noPunct: true },
    { ...SUB_DEFAULTS, id: 'fond', name: 'Fond noir', font: 'Arial', size: 50, bold: false, strokeWidth: 0, shadow: false, bg: true, bgOpacity: 65, margin: 7, maxChars: 40 }
  ];

  // Mots des rushes (temps du rush) → temps du montage, en ne gardant que ceux des passages gardés.
  // wordsByPath : { [chemin]: [{ w, t0, t1 }] } ; segments : ceux du bout à bout.
  function mapWords(wordsByPath, segments) {
    const out = [];
    for (const seg of segments) {
      const words = seg.kind ? null : wordsByPath[seg.path];
      if (!words) continue;
      for (const w of words) {
        const mid = (w.t0 + w.t1) / 2;
        if (mid < seg.in || mid >= seg.out) continue;
        const t0 = seg.start + Math.max(0, w.t0 - seg.in);
        const t1 = seg.start + Math.min(seg.out, w.t1) - seg.in;
        out.push({ w: w.w, t0: round(t0), t1: round(Math.max(t0 + 0.05, t1)) });
      }
    }
    return out.sort((a, b) => a.t0 - b.t0);
  }

  // Coupe en lignes (au plus maxChars) ; sur 2 lignes, les lignes sont équilibrées.
  function wrap(words, maxChars) {
    const lines = [];
    let cur = '';
    for (const w of words) {
      if (!cur) cur = w;
      else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    if (lines.length === 2) {
      let best = null;
      for (let k = 1; k < words.length; k++) {
        const a = words.slice(0, k).join(' ');
        const b = words.slice(k).join(' ');
        if (a.length > maxChars || b.length > maxChars) continue;
        const score = Math.max(a.length, b.length);
        if (!best || score < best.score) best = { score, lines: [a, b] };
      }
      if (best) return best.lines;
    }
    return lines;
  }

  const WEAK = /^(le|la|les|l'|un|une|des|du|de|d'|à|au|aux|et|ou|en|on|je|j'|tu|il|elle|nous|vous|ils|elles|ce|c'|ces|cette|mon|ma|mes|ton|ta|tes|son|sa|ses|notre|nos|votre|vos|leur|leurs|que|qu'|qui|pour|par|sur|dans|avec|sans|ne|n'|se|s'|the|a|an|of|to|and|in|on|is|it)$/iu;
  const stripPunct = (w) => w.replace(/[,.;:…]+$/u, '');

  // Sous-titres à partir des mots (temps du montage) : [{ start, end, lines, text, key }].
  // Les mots sont groupés en phrases (ponctuation de fin, ou pause plus longue que pauseBreak),
  // puis chaque phrase est partagée en sous-titres de longueurs proches (pas de mot orphelin),
  // de préférence après une virgule, sans dépasser lignes / caractères / durée du preset.
  function buildCues(words, preset = {}) {
    const P = { ...SUB_DEFAULTS, ...preset };
    const shown = (w) => {
      const t = P.upper ? w.w.toLocaleUpperCase('fr') : w.w;
      return P.noPunct ? stripPunct(t) : t;
    };
    const phrases = [];
    let cur = [];
    words.forEach((w, i) => {
      const prev = words[i - 1];
      if (cur.length && prev && w.t0 - prev.t1 > P.pauseBreak) {
        phrases.push(cur);
        cur = [];
      }
      cur.push(w);
      if (/[.!?…]$/u.test(w.w)) {
        phrases.push(cur);
        cur = [];
      }
    });
    if (cur.length) phrases.push(cur);

    const fits = (chunk) => chunk.length === 1 || (wrap(chunk.map(shown), P.maxChars).length <= P.maxLines && chunk[chunk.length - 1].t1 - chunk[0].t0 <= P.maxDuration);
    const chunks = [];
    for (const ph of phrases) {
      const len = (a, b) => ph.slice(a, b).map(shown).join(' ').length;
      const total = len(0, ph.length);
      let done = false;
      for (let n = Math.max(1, Math.ceil(total / (P.maxChars * P.maxLines))); n <= ph.length && !done; n++) {
        // Partage en n morceaux : longueurs proches de total / n, bonus après une virgule.
        const target = total / n;
        const W = ph.length;
        const cost = Array.from({ length: n + 1 }, () => new Array(W + 1).fill(Infinity));
        const from = Array.from({ length: n + 1 }, () => new Array(W + 1).fill(-1));
        cost[0][0] = 0;
        for (let j = 1; j <= n; j++) {
          for (let k = j; k <= W; k++) {
            for (let a = j - 1; a < k; a++) {
              if (cost[j - 1][a] === Infinity) continue;
              const chunk = ph.slice(a, k);
              if (!fits(chunk)) continue;
              const comma = k < W && /[,;:]$/u.test(ph[k - 1].w) ? target * target * 0.15 : 0;
              // Un sous-titre ne finit pas sur un petit mot (« le », « de », « on »…).
              const weak = k < W && WEAK.test(ph[k - 1].w) ? target * target * 0.12 : 0;
              const c = cost[j - 1][a] + (len(a, k) - target) ** 2 - comma + weak;
              if (c < cost[j][k]) {
                cost[j][k] = c;
                from[j][k] = a;
              }
            }
          }
        }
        if (cost[n][W] === Infinity) continue;
        const parts = [];
        for (let j = n, k = W; j > 0; j--) {
          const a = from[j][k];
          parts.unshift(ph.slice(a, k));
          k = a;
        }
        chunks.push(...parts);
        done = true;
      }
      if (!done) for (const w of ph) chunks.push([w]);
    }

    const cues = chunks.map((ch) => ({ start: ch[0].t0, end: ch[ch.length - 1].t1, texts: ch.map(shown), key: ch.map((w) => w.w).join(' ') }));
    return cues.map((c, i) => {
      const next = cues[i + 1];
      const limit = next ? next.start - 0.04 : Infinity;
      const end = Math.min(Math.max(c.end + 0.15, c.start + P.minDuration), limit);
      const lines = wrap(c.texts, P.maxChars);
      return { start: round(c.start), end: round(Math.max(end, c.start + 0.1)), lines, text: lines.join('\n'), key: c.key };
    });
  }

  // Corrections faites à la main ({ [key]: texte }) : retrouvées tant que le sous-titre est le même.
  function applyFixes(cues, fixes = {}) {
    return cues.map((c) => {
      const t = fixes[c.key];
      if (t == null) return c;
      const lines = String(t).split('\n').map((x) => x.trim()).filter(Boolean);
      return { ...c, lines, text: lines.join('\n'), fixed: true };
    }).filter((c) => c.lines.length);
  }

  function srtTime(t) {
    const ms = Math.max(0, Math.round(t * 1000));
    const h = Math.floor(ms / 3600000);
    const m = Math.floor(ms / 60000) % 60;
    const s = Math.floor(ms / 1000) % 60;
    const pad = (n, k = 2) => String(n).padStart(k, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
  }

  function toSrt(cues) {
    return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.lines.join('\n')}\n`).join('\n');
  }

  const cueAt = (cues, t) => cues.find((c) => t >= c.start && t < c.end) || null;

  return { RATE, DEFAULTS, SUB_DEFAULTS, DEFAULT_PRESETS, mapWords, wrap, buildCues, applyFixes, toSrt, srtTime, cueAt, levels, threshold, cutClip, buildSequence, withEnding, segmentAt, overlayAt, fmtTime };
});
