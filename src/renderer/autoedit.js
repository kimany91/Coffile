'use strict';
// AUTOEDIT : 1) tu regardes et classes les rushes (1, 2, 3…) ; 2) Coffile fait le bout à bout
// dans cet ordre sans les blancs, avec un aperçu et une timeline où un double-clic ajoute une image
// (et un sound effect si tu veux) ; 3) Valider écrit la séquence et l'ouvre dans Premiere Pro.
(() => {
  const C = window.AutoEditCore;
  const COLORS = ['#ff7a32', '#5b8cff', '#34d399', '#a594ff', '#f472b6', '#fbbf24', '#22d3ee', '#f87171'];
  const TL = { pad: 12, ruler: 20, imgTop: 24, imgH: 40, clipTop: 70, clipH: 74, height: 152 };

  const ae = {
    open: false,
    dir: '',
    name: '',
    step: 'rank',
    media: { rushes: [], images: [], sfx: [] },
    info: {},
    ranks: [],
    cut: {},
    opts: { sensitivity: C.DEFAULTS.sensitivity, minPause: C.DEFAULTS.minPause },
    overlays: [],
    selected: null,
    pick: null,
    seq: { segments: [], total: 0, perClip: [] },
    zoom: 1,
    result: null,
    imgDuration: 3,
    ending: null, // { kind: 'video' | 'image', path, name, duration?, width?, height? }
    subs: { enabled: false, presetId: 'classique', mode: 'premiere', language: 'fr', fixes: {} },
    words: {}, // mots transcrits par rush : { [chemin]: [{ w, t0, t1 }] }
    cues: [],
    sideTab: 'cut',
    subsInfo: null, // moteur et modèles de transcription
    dl: null, // téléchargement du modèle (0..1)
    sfxLibrary: ''
  };
  const root = () => $('#autoedit');
  // Overlay enregistré par la 1re version d'AUTOEDIT ({ image: {…} }) → { kind: 'image', path, … }.
  function normOv(o) {
    if (o.kind || !o.image) return o;
    const { image, ...rest } = o;
    return { ...rest, kind: 'image', path: image.path, name: image.name, width: image.width, height: image.height };
  }
  const info = (p) => ae.info[p] || (ae.info[p] = {});
  const rush = (p) => ae.media.rushes.find((r) => r.path === p);
  const srcOf = (p) => mediaUrl(info(p).proxy || p);
  const colorOf = (p) => COLORS[Math.max(0, ae.ranks.indexOf(p)) % COLORS.length];
  const analysed = (p) => !!(info(p).probe && (info(p).env || info(p).error));
  // Codecs que l'aperçu lit directement ; les autres (ProRes, DNxHD, MPEG-2…) passent par un proxy.
  const unplayable = (p) => {
    const c = info(p).probe && info(p).probe.vcodec;
    return !!c && !/^(h264|hevc|vp8|vp9|av1|theora)$/i.test(c);
  };
  // Vidéo chargée mais sans image (codec non lu : seul le son passe) → proxy.
  const noPicture = (v) => v.readyState >= 1 && v.videoWidth === 0;
  let offProgress = null;
  let saveTimer = null;

  // ---------- Ouverture / fermeture ----------
  // autoOpts (onglet AUTOEDIT, projet neuf) : { autoRank, autoEnding, subs, presetId }.
  async function open(dir, name, autoOpts = null) {
    const res = await api.autoeditOpen(dir);
    if (!res.ok) {
      toast(res.error || 'AUTOEDIT : projet introuvable', 'err');
      return;
    }
    Object.assign(ae, { open: true, dir, name: name || dir.split(/[\\/]/).pop(), media: res.media, info: {}, selected: null, pick: null, result: null, zoom: 1, sfxLibrary: res.sfxLibrary || '' });
    const saved = res.saved || {};
    const exists = new Set(res.media.rushes.map((r) => r.path));
    const imgs = new Set(res.media.images.map((r) => r.path));
    ae.ranks = (saved.ranks || []).filter((p) => exists.has(p));
    ae.cut = saved.cut || {};
    ae.opts = { ...ae.opts, ...(saved.opts || {}) };
    const known = new Set([...res.media.rushes, ...res.media.images, ...(res.media.templates || [])].map((f) => f.path));
    ae.overlays = (saved.overlays || []).map(normOv).filter((o) => known.has(o.path));
    ae.imgDuration = saved.imgDuration || 3;
    ae.subs = { enabled: false, presetId: 'classique', mode: 'premiere', language: 'fr', fixes: {}, ...(saved.subs || {}) };
    ae.words = {};
    ae.cues = [];
    ae.dl = null;
    api.subsStatus().then((st) => {
      ae.subsInfo = st;
      startTranscribe();
      if (ae.step === 'edit') renderSide();
    });
    const e = saved.ending;
    const anyFile = new Set([...res.media.rushes, ...res.media.images, ...(res.media.templates || [])].map((f) => f.path));
    ae.ending = e && anyFile.has(e.path) ? e : null;
    ae.step = saved.step === 'edit' && ae.ranks.length ? 'edit' : 'rank';
    if (autoOpts && !(saved.ranks && saved.ranks.length)) await applyAutoOpts(autoOpts);
    if (!offProgress) offProgress = api.onAutoEdit(onProgress);
    root().classList.remove('hidden');
    document.body.classList.add('ae-open');
    render();
    if (res.media.rushes.length) api.autoeditAnalyze(res.media.rushes.map((r) => r.path));
  }

  // Proposé tout seul : rushes déjà numérotés dans l'ordre de tournage (date des fichiers, puis
  // nom), fin la plus probable, sous-titres. AUTOEDIT s'ouvre quand même sur « Classer » :
  // tu regardes les rushes et tu changes l'ordre si besoin.
  async function applyAutoOpts(o) {
    if (o.autoRank) {
      ae.ranks = ae.media.rushes
        .filter((r) => !isEndingCandidate(r.path))
        .sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name, 'fr', { numeric: true }))
        .map((r) => r.path);
    }
    const best = o.autoEnding && (ae.media.endings || [])[0];
    if (best) {
      ae.ending = { kind: best.kind, path: best.path, name: best.name };
      if (best.kind === 'image') Object.assign(ae.ending, { duration: 4 }, await imageSize(best.path));
      if (best.kind === 'mogrt') ae.ending.duration = 5;
      ae.ranks = ae.ranks.filter((p) => p !== best.path);
    }
    if (o.subs) {
      ae.subs.enabled = true;
      if (o.presetId) ae.subs.presetId = o.presetId;
    }
    save(true);
  }

  function close() {
    save(true);
    api.autoeditCancel();
    api.subsCancel();
    player.pause();
    const v = $('#ae-rank-video');
    if (v) v.pause();
    sfxPreview.pause();
    root().classList.add('hidden');
    document.body.classList.remove('ae-open');
    ae.open = false;
  }

  function save(now) {
    clearTimeout(saveTimer);
    const run = () =>
      ae.dir &&
      api.autoeditSave(ae.dir, {
        version: 1,
        step: ae.step === 'done' ? 'edit' : ae.step,
        ranks: ae.ranks,
        cut: ae.cut,
        opts: ae.opts,
        overlays: ae.overlays,
        imgDuration: ae.imgDuration,
        ending: ae.ending,
        subs: ae.subs
      });
    if (now) run();
    else saveTimer = setTimeout(run, 600);
  }

  // Résultats de l'analyse (infos, volume) et des aperçus, au fil de l'eau.
  function onProgress(m) {
    if (ae.open && m.subs === 'download') {
      ae.dl = m.progress;
      if (ae.step === 'edit' && ae.sideTab === 'subs') throttledSide();
      return;
    }
    if (!ae.open || !m.path) return;
    if (m.words || m.subsProgress != null || m.subsError) {
      const it = info(m.path);
      if (m.words) ae.words[m.path] = m.words;
      if (m.subsProgress != null) it.subsProgress = m.subsProgress;
      if (m.subsError) it.subsError = m.subsError;
      if (m.words) {
        recomputeCues();
        drawSubs(true);
      }
      if (ae.step === 'edit' && ae.sideTab === 'subs') throttledSide();
      return;
    }
    const it = info(m.path);
    if (m.probe) it.probe = m.probe;
    if (m.env) it.env = m.env;
    if (m.error) it.error = m.error;
    if (m.progress != null) it.progress = m.progress;
    if (m.proxyProgress != null) it.proxyProgress = m.proxyProgress;
    if (ae.step === 'rank') updateCard(m.path);
    else if (ae.step === 'edit' && (ae.ranks.includes(m.path) || (ae.ending && ae.ending.path === m.path))) {
      if (m.proxyProgress != null) stageMsg();
      else if (m.env || m.error || m.probe) rebuild();
    }
  }

  let sideTimer = null;
  function throttledSide() {
    if (sideTimer) return;
    sideTimer = setTimeout(() => {
      sideTimer = null;
      renderSide();
    }, 250);
  }

  // ---------- Sous-titres ----------
  const presets = () => (state.settings && state.settings.subtitlePresets && state.settings.subtitlePresets.length ? state.settings.subtitlePresets : C.DEFAULT_PRESETS);
  const preset = () => presets().find((p) => p.id === ae.subs.presetId) || presets()[0];
  const subsModel = () => (state.settings && state.settings.subtitleModel) || 'small';
  const modelReady = () => !!(ae.subsInfo && ae.subsInfo.engine && ae.subsInfo.models[subsModel()] && ae.subsInfo.models[subsModel()].installed);

  function recomputeCues() {
    ae.cues = ae.subs.enabled ? C.applyFixes(C.buildCues(C.mapWords(ae.words, ae.seq.segments), preset()), ae.subs.fixes) : [];
  }

  // Transcrit les rushes classés qui ne le sont pas encore (en cache ensuite).
  function startTranscribe() {
    if (!ae.subs.enabled || !modelReady()) return;
    const todo = ae.ranks.filter((p) => !ae.words[p]);
    for (const p of todo) delete info(p).subsError;
    if (todo.length) api.subsTranscribe(todo, { model: subsModel(), language: ae.subs.language });
  }

  // Dessine un sous-titre comme dans le rendu final (aperçu, éditeur de preset, images incrustées).
  // La taille du preset est donnée pour une image de 1080 de côté (le plus petit côté).
  function drawSubtitle(ctx, W, H, lines, P) {
    if (!lines || !lines.length) return;
    const k = Math.min(W, H) / 1080;
    const size = P.size * k;
    ctx.save();
    ctx.font = `${P.italic ? 'italic ' : ''}${P.bold ? 700 : 400} ${size}px "${P.font}", "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = P.align === 'left' ? 'left' : P.align === 'right' ? 'right' : 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    const lh = size * 1.2;
    const block = lh * lines.length;
    const top = P.position === 'top' ? (H * P.margin) / 100 : P.position === 'middle' ? H / 2 - block / 2 + (H * (P.margin || 0)) / 200 : H * (1 - P.margin / 100) - block;
    const x = P.align === 'left' ? W * 0.07 : P.align === 'right' ? W * 0.93 : W / 2;
    lines.forEach((line, i) => {
      const y = top + lh * i + size * 0.95;
      if (P.bg) {
        const w = ctx.measureText(line).width;
        const px = size * 0.32;
        const left = ctx.textAlign === 'center' ? x - w / 2 : ctx.textAlign === 'right' ? x - w : x;
        const rgb = P.bgColor.replace('#', '');
        const [r, g, b] = [0, 2, 4].map((n) => parseInt(rgb.slice(n, n + 2), 16) || 0);
        ctx.fillStyle = `rgba(${r},${g},${b},${(P.bgOpacity || 0) / 100})`;
        const rr = Math.min((P.bgRadius || 0) * k, lh / 2);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(left - px, y - size * 0.98, w + px * 2, lh + size * 0.06, rr);
        else ctx.rect(left - px, y - size * 0.98, w + px * 2, lh + size * 0.06);
        ctx.fill();
      }
      if (P.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = size * 0.14;
        ctx.shadowOffsetY = size * 0.05;
      }
      if (P.strokeWidth > 0) {
        ctx.lineWidth = P.strokeWidth * 2 * k;
        ctx.strokeStyle = P.strokeColor;
        ctx.strokeText(line, x, y);
        ctx.shadowColor = 'transparent';
      }
      ctx.fillStyle = P.color;
      ctx.fillText(line, x, y);
      ctx.shadowColor = 'transparent';
    });
    ctx.restore();
  }

  // Sous-titre de l'instant affiché, par-dessus l'aperçu.
  let subsKey = '';
  function drawSubs(force) {
    const cv = $('#ae-subs');
    const st = $('#ae-stage');
    if (!cv || !st) return;
    const w = st.clientWidth;
    const h = st.clientHeight;
    const cue = ae.subs.enabled ? C.cueAt(ae.cues, player.t) : null;
    const key = `${w}x${h}|${cue ? cue.start + cue.text : ''}`;
    if (!force && key === subsKey) return;
    subsKey = key;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (cue) drawSubtitle(g, w, h, cue.lines, preset());
  }

  function subsPanel() {
    const st = ae.subsInfo || { engine: false, models: {} };
    const model = subsModel();
    const head = `<div class="ae-subs-on"><div><b>${icon('type')}Sous-titres automatiques</b><span>Coffile écoute les rushes et écrit les sous-titres, sur ton PC.</span></div><label class="ae-switch"><input type="checkbox" data-ae-subs-on ${ae.subs.enabled ? 'checked' : ''} /><span></span></label></div>`;
    if (!ae.subs.enabled) return head;
    let engine;
    const m = st.models[model];
    if (!st.engine) engine = `<div class="ae-note err">${icon('alert')}<span>Le moteur de transcription (Whisper) est fourni avec la version Windows de Coffile.</span></div>`;
    else if (!m || !m.installed)
      engine = `<div class="ae-dl"><b>${icon('download')}Modèle de transcription à télécharger, une seule fois</b>
        <div class="ae-seg wide">${Object.entries(st.models).map(([id, x]) => `<button class="${id === model ? 'on' : ''}" data-ae-model="${id}">${esc(x.label)}<i>${x.mo} Mo</i></button>`).join('')}</div>
        ${ae.dl != null ? `<div class="bar small"><div class="bar-fill" style="width:${Math.round(ae.dl * 100)}%"></div></div><span class="ae-muted small">Téléchargement… ${Math.round(ae.dl * 100)} %</span>` : `<button class="btn sm primary" data-ae-act="subs-download">${icon('download')}Télécharger (${m ? m.mo : '?'} Mo)</button>`}
        <span class="ae-muted small">Ensuite tout se fait hors ligne, sans compte ni crédit.</span></div>`;
    else {
      const left = ae.ranks.filter((p) => !ae.words[p]);
      const errs = ae.ranks.filter((p) => info(p).subsError);
      engine = left.length && !errs.length
        ? `<div class="ae-note wait"><span class="spinner"></span><span>Transcription : ${ae.ranks.length - left.length}/${ae.ranks.length} rushes · ${Math.round(Math.max(0, ...left.map((p) => info(p).subsProgress || 0)) * 100)} %</span></div>`
        : `<div class="ae-note ok">${icon('check')}<span>${plural(ae.ranks.length - left.length, 'rush transcrit', 'rushes transcrits')} · ${plural(ae.cues.length, 'sous-titre', 'sous-titres')}</span></div>`;
      if (errs.length) engine += `<div class="ae-note err">${icon('alert')}<span>${esc(info(errs[0]).subsError)}</span><button class="btn sm ghost" data-ae-act="subs-retry">Réessayer</button></div>`;
    }
    const langs = [['fr', 'Français'], ['en', 'Anglais'], ['es', 'Espagnol'], ['de', 'Allemand'], ['it', 'Italien'], ['pt', 'Portugais'], ['auto', 'Détection auto']];
    const P = preset();
    const cur = C.cueAt(ae.cues, player.t);
    return `${head}${engine}
      <div class="ae-field"><label>Langue parlée</label><select data-ae-subs-lang>${langs.map(([v, l]) => `<option value="${v}" ${ae.subs.language === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="ae-field"><label>Preset</label><div class="ae-inline"><select data-ae-preset>${presets().map((p) => `<option value="${esc(p.id)}" ${p.id === P.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select><button class="btn sm" data-ae-act="preset-edit">${icon('pencil')}Régler</button><button class="btn sm ghost" data-ae-act="preset-new" title="Nouveau preset">${icon('plus')}</button></div></div>
      <div class="ae-field"><label>Dans Premiere</label>
        <label class="ae-radio"><input type="radio" name="ae-subs-mode" value="premiere" data-ae-subs-mode ${ae.subs.mode !== 'burn' ? 'checked' : ''} /><span><b>Piste de sous-titres Premiere</b><em>Texte modifiable dans Premiere. Le découpage (lignes, caractères, durées) vient du preset ; police et couleurs se règlent dans Premiere (Style de piste) : Premiere ne laisse pas un autre logiciel les régler.</em></span></label>
        <label class="ae-radio"><input type="radio" name="ae-subs-mode" value="burn" data-ae-subs-mode ${ae.subs.mode === 'burn' ? 'checked' : ''} /><span><b>Incrustés, style exact du preset</b><em>Police, couleurs, contour et position exactement comme dans l'aperçu (sur la piste V4).</em></span></label>
      </div>
      ${ae.cues.length ? `<div class="ae-cues">${ae.cues.map((c, i) => `<div class="ae-cue ${cur === c ? 'on' : ''} ${c.fixed ? 'fixed' : ''}" data-ae-cue="${i}" title="Double-clic : corriger le texte"><i>${C.fmtTime(c.start, true)}</i><span>${esc(c.lines.join(' / '))}</span></div>`).join('')}</div><p class="ae-muted small">${icon('pencil')}Double-clique sur un sous-titre pour corriger le texte.</p>` : ''}`;
  }

  function editCue(i) {
    const c = ae.cues[i];
    const row = $(`[data-ae-cue="${i}"]`);
    if (!c || !row) return;
    row.innerHTML = `<i>${C.fmtTime(c.start, true)}</i><textarea rows="${Math.max(2, c.lines.length)}" data-ae-cue-edit="${i}">${esc(c.lines.join('\n'))}</textarea>`;
    const ta = row.querySelector('textarea');
    ta.focus();
    ta.select();
    const done = (keep) => {
      if (keep) {
        ae.subs.fixes[c.key] = ta.value;
        save();
        recomputeCues();
        drawSubs(true);
      }
      renderSide();
    };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        done(true);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        done(false);
      }
    });
    ta.addEventListener('blur', () => done(true), { once: true });
  }

  // ---------- Éditeur de preset de sous-titres ----------
  const FONTS = ['Montserrat', 'Arial', 'Helvetica', 'Inter', 'Roboto', 'Poppins', 'Open Sans', 'Lato', 'Bebas Neue', 'Oswald', 'Anton', 'Impact', 'Futura', 'Avenir', 'Gotham', 'Proxima Nova', 'Segoe UI', 'Verdana', 'Georgia', 'Times New Roman', 'Comic Sans MS'];

  function openPresetEditor(fresh) {
    player.pause();
    const base = preset();
    const p = fresh ? { ...base, id: `p${Date.now().toString(36)}`, name: 'Mon preset' } : { ...base };
    // Fond de l'aperçu : l'image affichée du montage.
    const bg = document.createElement('canvas');
    const v = $$('#ae-stage video.ae-v').find((x) => x.classList.contains('on'));
    if (v && v.videoWidth) {
      bg.width = v.videoWidth;
      bg.height = v.videoHeight;
      try {
        bg.getContext('2d').drawImage(v, 0, 0);
      } catch {
        bg.width = 0;
      }
    }
    const cue = C.cueAt(ae.cues, player.t) || ae.cues[0];
    ae.pick = { mode: 'preset', preset: p, fresh, bg, sample: cue ? cue.key : "Voici un exemple de sous-titre qui tient sur deux lignes" };
    renderPresetEditor();
    $('#ae-picker').classList.remove('hidden');
  }

  function renderPresetEditor() {
    const P = ae.pick.preset;
    const num = (key, label, min, max, step, unit = '') => `<div class="ae-pr-row"><label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${P[key]}" data-ae-pr="${key}" /><b data-ae-prv="${key}">${P[key]}${unit}</b></div>`;
    const chk = (key, label) => `<label class="ae-check sm"><input type="checkbox" data-ae-pr="${key}" ${P[key] ? 'checked' : ''} /><span>${label}</span></label>`;
    const col = (key, label) => `<label class="ae-color"><input type="color" value="${esc(P[key])}" data-ae-pr="${key}" /><span>${label}</span></label>`;
    const seg = (key, opts) => `<div class="ae-seg">${opts.map(([v, l]) => `<button class="${P[key] === v ? 'on' : ''}" data-ae-pr-set="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;
    $('#ae-picker').innerHTML = `<div class="ae-pick ae-pr">
      <header><b>${icon('type')}Preset de sous-titres</b><input class="ae-pr-name" value="${esc(P.name)}" data-ae-pr="name" spellcheck="false" /><button class="ae-x" data-ae-act="pick-close">${icon('x')}</button></header>
      <div class="ae-pick-body">
        <div class="ae-pr-preview"><canvas id="ae-pr-canvas"></canvas><span class="ae-muted small">Aperçu sur l'image du montage, au format de la séquence.</span></div>
        <div class="ae-pr-form">
          <div class="ae-pr-group"><h4>Texte</h4>
            <div class="ae-pr-row"><label>Police</label><input list="ae-fonts" value="${esc(P.font)}" data-ae-pr="font" spellcheck="false" /><datalist id="ae-fonts">${FONTS.map((f) => `<option value="${f}">`).join('')}</datalist></div>
            ${num('size', 'Taille', 20, 160, 1, ' px')}
            <div class="ae-pr-checks">${chk('bold', 'Gras')}${chk('italic', 'Italique')}${chk('upper', 'MAJUSCULES')}${chk('noPunct', 'Sans ponctuation')}</div>
          </div>
          <div class="ae-pr-group"><h4>Couleurs</h4>
            <div class="ae-pr-checks">${col('color', 'Texte')}${col('strokeColor', 'Contour')}${chk('shadow', 'Ombre')}</div>
            ${num('strokeWidth', 'Contour', 0, 20, 1, ' px')}
            <div class="ae-pr-checks">${chk('bg', 'Fond derrière le texte')}${col('bgColor', 'Fond')}</div>
            ${num('bgOpacity', 'Opacité du fond', 0, 100, 5, ' %')}
            ${num('bgRadius', 'Arrondi du fond', 0, 40, 1, ' px')}
          </div>
          <div class="ae-pr-group"><h4>Position</h4>
            <div class="ae-pr-row"><label>Place</label>${seg('position', [['top', 'Haut'], ['middle', 'Milieu'], ['bottom', 'Bas']])}</div>
            <div class="ae-pr-row"><label>Alignement</label>${seg('align', [['left', 'Gauche'], ['center', 'Centre'], ['right', 'Droite']])}</div>
            ${num('margin', 'Marge', 0, 40, 1, ' %')}
          </div>
          <div class="ae-pr-group"><h4>Découpage et temps</h4>
            ${num('maxLines', 'Lignes max', 1, 3, 1)}
            ${num('maxChars', 'Caractères par ligne', 8, 60, 1)}
            ${num('minDuration', 'Durée min', 0.2, 3, 0.1, ' s')}
            ${num('maxDuration', 'Durée max', 1, 8, 0.5, ' s')}
            ${num('pauseBreak', 'Pause qui coupe', 0.2, 2, 0.1, ' s')}
          </div>
        </div>
      </div>
      <footer>${!ae.pick.fresh && presets().length > 1 ? `<button class="btn ghost danger-text" data-ae-act="preset-del">${icon('trash')}Supprimer ce preset</button>` : ''}<span class="ae-grow"></span><button class="btn ghost" data-ae-act="pick-close">Annuler</button><button class="btn primary" data-ae-act="preset-save">${icon('check')}Enregistrer le preset</button></footer>
    </div>`;
    drawPresetPreview();
  }

  function drawPresetPreview() {
    const cv = $('#ae-pr-canvas');
    if (!cv || !ae.pick) return;
    const P = ae.pick.preset;
    const { width, height } = seqFormat();
    const box = cv.parentElement;
    const maxW = box.clientWidth - 2;
    const maxH = box.clientHeight - 40;
    const s = Math.min(maxW / width, maxH / height);
    const w = Math.max(10, Math.floor(width * s));
    const h = Math.max(10, Math.floor(height * s));
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ae.pick.bg;
    if (bg && bg.width) {
      const k = Math.max(w / bg.width, h / bg.height);
      g.drawImage(bg, (w - bg.width * k) / 2, (h - bg.height * k) / 2, bg.width * k, bg.height * k);
    } else {
      const gr = g.createLinearGradient(0, 0, w, h);
      gr.addColorStop(0, '#3a2a1e');
      gr.addColorStop(1, '#14100c');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }
    const words = ae.pick.sample.split(/\s+/).map((x) => (P.upper ? x.toLocaleUpperCase('fr') : x)).map((x) => (P.noPunct ? x.replace(/[,.;:…]+$/u, '') : x));
    const lines = C.wrap(words, P.maxChars).slice(0, P.maxLines);
    drawSubtitle(g, w, h, lines, P);
  }

  async function savePreset(remove) {
    const P = ae.pick.preset;
    let list = presets().map((x) => ({ ...x }));
    if (remove) list = list.filter((x) => x.id !== P.id);
    else {
      const i = list.findIndex((x) => x.id === P.id);
      if (i >= 0) list[i] = { ...P };
      else list.push({ ...P });
      ae.subs.presetId = P.id;
    }
    if (!list.length) list = C.DEFAULT_PRESETS.map((x) => ({ ...x }));
    if (remove) ae.subs.presetId = list[0].id;
    state.settings = await api.setSettings({ subtitlePresets: list });
    closePicker();
    save();
    recomputeCues();
    drawSubs(true);
    renderSide();
  }

  // Images des sous-titres incrustés (PNG transparents au format de la séquence).
  async function renderSubImages(W, H) {
    const P = preset();
    const out = [];
    for (let i = 0; i < ae.cues.length; i++) {
      const c = ae.cues[i];
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      drawSubtitle(cv.getContext('2d'), W, H, c.lines, P);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      out.push({ name: `sous-titre_${String(i + 1).padStart(4, '0')}.png`, bytes: new Uint8Array(await blob.arrayBuffer()), start: c.start, duration: Math.max(0.1, c.end - c.start) });
    }
    return out;
  }

  // ---------- Rendu général ----------
  function render() {
    $('#ae-project').textContent = ae.name;
    const steps = [
      ['rank', '1', 'Classer les rushes'],
      ['edit', '2', 'Bout à bout, images, sound effects'],
      ['done', '3', 'Premiere Pro']
    ];
    const idx = steps.findIndex((s) => s[0] === ae.step);
    $('#ae-steps').innerHTML = steps.map(([k, n, label], i) => `<span class="ae-step ${k === ae.step ? 'on' : i < idx ? 'past' : ''}"><i>${i < idx ? icon('check') : n}</i>${label}</span>`).join('<span class="ae-step-sep"></span>');
    player.detach();
    if (ae.step === 'rank') renderRank();
    else if (ae.step === 'edit') renderEdit();
    else renderDone();
  }

  // ---------- Étape 1 : classer ----------
  let rankSel = null;
  let thumbObserver = null;

  function rushStatus(p) {
    const it = info(p);
    if (it.error) return { cls: 'err', text: 'Lecture impossible' };
    if (!it.probe) return { cls: 'wait', text: 'Analyse…' };
    if (!it.env) return { cls: 'wait', text: `Son : ${Math.round((it.progress || 0) * 100)} %` };
    if (it.env.noAudio) return { cls: '', text: 'Sans son' };
    const r = C.cutClip(it.env, it.probe.duration, ae.opts);
    return r.mode === 'cut' ? { cls: 'ok', text: `Parole · −${fmtSec(r.removed)} de blancs` } : { cls: '', text: r.reason === 'presque pas de parole' || r.reason === 'pas de blancs nets' ? 'Ambiance / sans parole' : 'Gardé en entier' };
  }

  const KIND_ICON = { video: 'film', image: 'image', mogrt: 'layers' };
  // Tous les fichiers utilisables : RUSHES, IMAGES et TEMPLATE.
  const allFiles = () => [...ae.media.rushes, ...ae.media.images, ...(ae.media.templates || [])];
  // Vignette d'un fichier (vidéo : 1re image ; modèle animé : pastille, il ne se lit que dans Premiere).
  function mediaThumb(f) {
    if (f.kind === 'video') return `<video muted preload="metadata" src="${esc(srcOf(f.path))}#t=0.6"></video>`;
    if (f.kind === 'image') return `<img src="${esc(mediaUrl(f.path))}" loading="lazy" alt="" />`;
    return `<div class="ae-mogrt-thumb">${icon('layers')}<span>.mogrt</span></div>`;
  }
  const endingOf = (p) => (ae.media.endings || []).find((e) => e.path === p);
  const isEndingCandidate = (p) => {
    const e = endingOf(p);
    return !!(e && e.score >= 2.5);
  };
  const fmtSec = (s) => (s >= 60 ? C.fmtTime(s) : `${(Math.round(s * 10) / 10).toString().replace('.', ',')} s`);

  function cardHtml(r) {
    const n = ae.ranks.indexOf(r.path) + 1;
    const st = rushStatus(r.path);
    const d = info(r.path).probe && info(r.path).probe.duration;
    return `<div class="ae-card ${rankSel === r.path ? 'sel' : ''} ${n ? 'ranked' : ''}" data-ae-pick="${esc(r.path)}">
      <div class="ae-thumb"><video muted preload="none" data-thumb="${esc(srcOf(r.path))}"></video><span class="ae-thumb-ico">${icon('film')}</span>${d ? `<span class="ae-dur">${C.fmtTime(d)}</span>` : ''}</div>
      <div class="ae-card-text"><b title="${esc(r.name)}">${esc(r.name)}</b><span>${esc(r.rel.join(' › ') || 'RUSHES')}</span><em class="${st.cls}">${ae.ending && ae.ending.path === r.path ? '<i class="ae-tag">Fin du montage</i>' : isEndingCandidate(r.path) ? '<i class="ae-tag">Fin possible</i>' : ''}${esc(st.text)}</em></div>
      <div class="ae-rank-col">
        ${n ? `<button class="ae-move" data-ae-move="-1" data-path="${esc(r.path)}" title="Plus tôt dans le montage" ${n === 1 ? 'disabled' : ''}>▲</button>` : ''}
        <button class="ae-rank-btn ${n ? 'on' : ''}" data-ae-rank="${esc(r.path)}" title="${n ? 'Retirer du classement' : 'Ajouter à la suite du montage'}">${n || icon('plus')}</button>
        ${n ? `<button class="ae-move" data-ae-move="1" data-path="${esc(r.path)}" title="Plus tard dans le montage" ${n === ae.ranks.length ? 'disabled' : ''}>▼</button>` : ''}
      </div>
    </div>`;
  }

  function renderRank() {
    const list = ae.media.rushes;
    if (!rankSel || !rush(rankSel)) rankSel = (list.find((r) => !ae.ranks.includes(r.path)) || list[0] || {}).path || null;
    $('#ae-body').innerHTML = list.length
      ? `<div class="ae-rank">
        <div class="ae-viewer">
          <div class="ae-screen"><video id="ae-rank-video" controls playsinline></video><div class="ae-screen-msg hidden" id="ae-rank-msg"></div></div>
          <div class="ae-viewer-bar" id="ae-viewer-bar"></div>
          <p class="ae-help">${icon('sparkles')}<span>Regarde tes rushes et classe-les dans l'ordre du montage : <b>1, 2, 3…</b> Clique sur le <b>+</b> d'une carte, ou sur <b>Classer et suivant</b> (touche <kbd>Entrée</kbd>). Les rushes non classés ne sont pas utilisés. <b>Clic gauche</b> sur un rush : lecture sans les blancs · <b>clic droit</b> : le rush entier.</span></p>
        </div>
        <div class="ae-list">
          <div class="ae-list-head"><b>Rushes</b><span id="ae-count"></span><button class="btn sm ghost" data-ae-act="rank-all">${icon('list')}Tout classer dans l'ordre</button><button class="btn sm ghost" data-ae-act="rank-clear">${icon('x')}Tout retirer</button></div>
          <div class="ae-cards" id="ae-cards">${list.map(cardHtml).join('')}</div>
        </div>
      </div>`
      : `<div class="ae-empty">${icon('film')}<b>Aucune vidéo dans RUSHES</b><span>AUTOEDIT monte les vidéos du dossier RUSHES du projet.</span><button class="btn" data-ae-act="open-dir">${icon('folderOpen')}Ouvrir le dossier du projet</button></div>`;
    renderRankFoot();
    watchThumbs();
    if (rankSel) selectRush(rankSel, false);
  }

  function renderRankFoot() {
    const n = ae.ranks.length;
    const c = $('#ae-count');
    if (c) c.textContent = `${n} classé${n > 1 ? 's' : ''} sur ${ae.media.rushes.length}`;
    $('#ae-foot').innerHTML = `<span class="ae-foot-info">${icon('scissors')}Après le classement, Coffile met les rushes bout à bout dans cet ordre et coupe les blancs.</span>
      <button class="btn primary lg" data-ae-act="to-edit" ${n ? '' : 'disabled'}>${icon('wand')}Faire le bout à bout${n ? ` (${n} rush${n > 1 ? 'es' : ''})` : ''}</button>`;
  }

  function updateCard(p) {
    const el = $(`.ae-card[data-ae-pick="${CSS.escape(p)}"]`);
    if (!el) return;
    const r = rush(p);
    const tmp = document.createElement('div');
    tmp.innerHTML = cardHtml(r);
    const fresh = tmp.firstElementChild;
    // Garde la vignette déjà chargée.
    const oldVid = el.querySelector('.ae-thumb');
    fresh.replaceChild(oldVid, fresh.querySelector('.ae-thumb'));
    const dur = fresh.querySelector('.ae-dur');
    const d = info(p).probe && info(p).probe.duration;
    if (d && !oldVid.querySelector('.ae-dur')) oldVid.insertAdjacentHTML('beforeend', `<span class="ae-dur">${C.fmtTime(d)}</span>`);
    if (dur) dur.remove();
    el.replaceWith(fresh);
    if (p === rankSel) viewerBar();
  }

  function refreshCards() {
    for (const r of ae.media.rushes) updateCard(r.path);
    renderRankFoot();
  }

  function watchThumbs() {
    if (thumbObserver) thumbObserver.disconnect();
    thumbObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const v = e.target;
          thumbObserver.unobserve(v);
          v.onloadeddata = () => v.closest('.ae-thumb').classList.add('ready');
          v.onerror = () => v.closest('.ae-thumb').classList.add('broken');
          v.preload = 'metadata';
          v.src = `${v.dataset.thumb}#t=0.6`;
        }
      },
      { root: $('#ae-cards'), rootMargin: '200px' }
    );
    $$('#ae-cards video[data-thumb]').forEach((v) => thumbObserver.observe(v));
  }

  function viewerBar() {
    const bar = $('#ae-viewer-bar');
    if (!bar || !rankSel) return;
    const r = rush(rankSel);
    const n = ae.ranks.indexOf(rankSel) + 1;
    const p = info(rankSel).probe;
    const meta = p ? [p.duration && C.fmtTime(p.duration), p.width && `${p.width}×${p.height}`, p.fps && `${Math.round(p.fps * 100) / 100} i/s`].filter(Boolean).join(' · ') : '';
    const segs = rankCut(rankSel);
    const modeTip = segs ? `−${fmtSec(segs.removed)} de blancs` : info(rankSel).env ? 'pas de blancs à couper' : 'analyse du son…';
    bar.innerHTML = `<div class="ae-vb-text"><b>${esc(r.name)}</b><span>${esc(meta)}</span></div>
      <div class="ae-seg" title="Clic gauche sur un rush : sans les blancs · clic droit : rush entier"><button class="${rankMode === 'cut' ? 'on' : ''}" data-ae-mode="cut">${icon('scissors')}Sans les blancs</button><button class="${rankMode === 'full' ? 'on' : ''}" data-ae-mode="full">${icon('film')}Rush entier</button><em>${esc(rankMode === 'cut' ? modeTip : 'clic gauche : sans les blancs')}</em></div>
      ${n ? `<span class="ae-vb-rank">${icon('check')}N° ${n}</span><button class="btn sm ghost" data-ae-rank="${esc(rankSel)}">Retirer</button>` : ''}
      <button class="btn ${n ? '' : 'primary'}" data-ae-act="rank-next">${n ? `${icon('arrow')}Suivant` : `${icon('plus')}Classer n° ${ae.ranks.length + 1} et suivant`}</button>`;
  }

  // Lecture au classement : clic gauche = sans les blancs (les passages coupés sont sautés),
  // clic droit = rush entier.
  let rankMode = 'cut';
  let rankRaf = 0;
  function rankCut(p) {
    const it = info(p);
    if (!it.env || !it.probe) return null;
    const r = C.cutClip(it.env, it.probe.duration, { ...ae.opts, enabled: ae.cut[p] !== false });
    return r.mode === 'cut' ? r : null;
  }
  function rankLoop() {
    cancelAnimationFrame(rankRaf);
    const tick = () => {
      const v = $('#ae-rank-video');
      if (!ae.open || ae.step !== 'rank' || !v) return;
      if (rankMode === 'cut' && !v.paused && v.dataset.path) {
        const r = rankCut(v.dataset.path);
        if (r) {
          const t = v.currentTime;
          if (!r.segments.some((x) => t >= x.in - 0.02 && t < x.out)) {
            const next = r.segments.find((x) => x.in > t);
            if (next) v.currentTime = next.in;
            else v.pause();
          }
        }
      }
      rankRaf = requestAnimationFrame(tick);
    };
    rankRaf = requestAnimationFrame(tick);
  }

  function selectRush(p, play = true, mode) {
    if (mode) rankMode = mode;
    rankLoop();
    rankSel = p;
    $$('.ae-card').forEach((c) => c.classList.toggle('sel', c.dataset.aePick === p));
    const v = $('#ae-rank-video');
    if (!v) return;
    const msg = $('#ae-rank-msg');
    msg.classList.add('hidden');
    const retry = () => v.dataset.path === p && selectRush(p, true);
    // Sans les blancs : la lecture commence au premier passage gardé.
    v.onplay = () => {
      const r = rankMode === 'cut' && rankCut(p);
      if (r && v.currentTime < r.segments[0].in) v.currentTime = r.segments[0].in;
    };
    v.onerror = () => needProxy(p, retry, msg);
    v.onloadedmetadata = () => noPicture(v) && !info(p).proxy && needProxy(p, retry, msg);
    v.dataset.path = p;
    if (unplayable(p) && !info(p).proxy) {
      v.removeAttribute('src');
      v.load();
      needProxy(p, retry, msg);
    } else {
      v.src = srcOf(p);
      if (play) v.play().catch(() => {});
    }
    viewerBar();
    const card = $(`.ae-card[data-ae-pick="${CSS.escape(p)}"]`);
    if (card) card.scrollIntoView({ block: 'nearest' });
  }

  // Format que Coffile ne sait pas lire : un aperçu léger est préparé (une seule fois).
  const proxyJobs = {};
  function needProxy(p, then, msgEl) {
    const it = info(p);
    if (it.proxy) return;
    const show = () => {
      if (!msgEl) return;
      msgEl.classList.remove('hidden');
      msgEl.innerHTML = `<span class="spinner"></span>Préparation de l'aperçu… ${Math.round((info(p).proxyProgress || 0) * 100)} %<small>Ce format ne se lit pas directement : Coffile en fait une copie légère, juste pour l'aperçu.</small>`;
    };
    show();
    const timer = setInterval(show, 500);
    if (!proxyJobs[p]) proxyJobs[p] = api.autoeditProxy(p, it.probe && it.probe.duration);
    proxyJobs[p].then((res) => {
      clearInterval(timer);
      if (res.ok) {
        it.proxy = res.path;
        if (msgEl) msgEl.classList.add('hidden');
        // La vignette du rush aussi.
        const thumb = $(`.ae-card[data-ae-pick="${CSS.escape(p)}"] .ae-thumb video`);
        if (thumb) {
          thumb.onloadeddata = () => thumb.closest('.ae-thumb').classList.add('ready');
          thumb.src = `${mediaUrl(res.path)}#t=0.6`;
        }
        then();
      } else if (msgEl) msgEl.innerHTML = `${icon('alert')}Aperçu impossible : ${esc(res.error || '')}`;
    });
  }

  function toggleRank(p) {
    const i = ae.ranks.indexOf(p);
    if (i >= 0) ae.ranks.splice(i, 1);
    else ae.ranks.push(p);
    save();
    refreshCards();
    viewerBar();
  }

  function rankNext() {
    if (rankSel && !ae.ranks.includes(rankSel)) {
      ae.ranks.push(rankSel);
      save();
      updateCard(rankSel);
      renderRankFoot();
    }
    const list = ae.media.rushes;
    const start = list.findIndex((r) => r.path === rankSel);
    const next = [...list.slice(start + 1), ...list.slice(0, start + 1)].find((r) => !ae.ranks.includes(r.path));
    if (next) selectRush(next.path);
    else {
      viewerBar();
      toast('Tous les rushes sont classés. Tu peux faire le bout à bout.');
    }
  }

  // ---------- Étape 2 : bout à bout ----------
  // Lecteur de la séquence : deux vidéos qui se relaient, la suivante déjà calée sur sa coupe.
  const player = {
    v: [],
    cur: 0,
    k: -1,
    t: 0,
    playing: false,
    raf: 0,
    lastT: 0,
    attach(stage) {
      this.v = [...stage.querySelectorAll('video.ae-v')];
      this.cur = 0;
      this.k = -1;
      this.v.forEach((v) => {
        v.preload = 'auto';
        const fix = () => {
          const p = v.dataset.path;
          if (p && !info(p).proxy) needProxy(p, () => this.seek(this.t), $('#ae-stage-msg'));
        };
        v.addEventListener('error', fix);
        v.addEventListener('loadedmetadata', () => noPicture(v) && fix());
      });
    },
    detach() {
      this.pause();
      this.v.forEach((v) => {
        v.removeAttribute('src');
        v.load();
      });
      this.v = [];
    },
    segs() {
      return ae.seq.segments;
    },
    prep(v, seg, time) {
      if (!seg || seg.kind === 'image' || seg.kind === 'mogrt') return;
      const src = srcOf(seg.path);
      if (v.dataset.src !== src) {
        v.dataset.src = src;
        v.dataset.path = seg.path;
        v.src = src;
      }
      const go = () => {
        try {
          v.currentTime = time;
        } catch {}
      };
      if (v.readyState >= 1) go();
      else v.addEventListener('loadedmetadata', go, { once: true });
    },
    show(i, still) {
      this.v.forEach((v, j) => v.classList.toggle('on', j === i && !still));
      const img = $('#ae-still');
      const card = $('#ae-mogrt');
      if (card) {
        card.classList.toggle('hidden', !still || still.kind !== 'mogrt');
        if (still && still.kind === 'mogrt') card.innerHTML = `${icon('layers')}<b>${esc(still.path.split(/[\\/]/).pop())}</b><span>Modèle animé : il s'affichera dans Premiere</span>`;
      }
      if (!img) return;
      img.classList.toggle('hidden', !still || still.kind === 'mogrt');
      if (still && still.kind !== 'mogrt') {
        const src = mediaUrl(still.path);
        if (img.dataset.src !== src) {
          img.dataset.src = src;
          img.src = src;
        }
      }
    },
    // Image fixe (fin) : le temps avance avec l'horloge.
    startStill(seg) {
      this.v.forEach((v) => v.pause());
      this.show(-1, seg);
      this.stillT0 = performance.now() - (this.t - seg.start) * 1000;
    },
    seek(t) {
      const segs = this.segs();
      if (!this.v.length) return;
      this.t = Math.max(0, Math.min(t, ae.seq.total || 0));
      if (!segs.length) {
        this.show(-1);
        drawPlayhead();
        return;
      }
      this.k = C.segmentAt(segs, this.t);
      const seg = segs[this.k];
      const a = this.v[this.cur];
      if (seg.kind === 'image' || seg.kind === 'mogrt') this.startStill(seg);
      else {
        this.prep(a, seg, seg.in + (this.t - seg.start));
        this.show(this.cur);
        this.prep(this.v[1 - this.cur], segs[this.k + 1], segs[this.k + 1] && segs[this.k + 1].in);
        if (this.playing) a.play().catch(() => {});
        else a.pause();
      }
      this.lastT = this.t;
      showOverlay(this.t);
      drawPlayhead();
      timeLabel();
    },
    play() {
      if (!this.v.length || !this.segs().length) return;
      if (this.t >= ae.seq.total - 0.05) this.seek(0);
      this.playing = true;
      if (this.k < 0) this.seek(this.t);
      const cur = this.segs()[this.k];
      if (cur && (cur.kind === 'image' || cur.kind === 'mogrt')) this.startStill(cur);
      else this.v[this.cur].play().catch(() => {});
      cancelAnimationFrame(this.raf);
      const tick = () => {
        if (!this.playing) return;
        this.step();
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
      playBtn();
    },
    pause() {
      this.playing = false;
      cancelAnimationFrame(this.raf);
      this.v.forEach((v) => v.pause());
      showOverlay(this.t);
      playBtn();
    },
    toggle() {
      if (this.playing) this.pause();
      else this.play();
    },
    step() {
      const segs = this.segs();
      const seg = segs[this.k];
      if (!seg) return this.pause();
      const v = this.v[this.cur];
      if (seg.kind === 'image' || seg.kind === 'mogrt') {
        this.t = Math.min(seg.end, seg.start + (performance.now() - this.stillT0) / 1000);
        if (this.t >= seg.end - 0.001) {
          if (this.k + 1 >= segs.length) {
            this.t = ae.seq.total;
            this.pause();
          } else this.seek(seg.end);
        }
        showOverlay(this.t);
        drawPlayhead(true);
        timeLabel();
        return;
      }
      if (v.readyState < 2) return;
      const t = seg.start + (v.currentTime - seg.in);
      if (v.currentTime >= seg.out - 0.03 || v.ended) {
        // Coupe : la vidéo déjà prête prend le relais.
        if (this.k + 1 >= segs.length) {
          this.t = ae.seq.total;
          this.pause();
          drawPlayhead();
          timeLabel();
          return;
        }
        this.k++;
        if (segs[this.k].kind === 'image' || segs[this.k].kind === 'mogrt') {
          this.t = segs[this.k].start;
          this.startStill(segs[this.k]);
          return;
        }
        const next = this.v[1 - this.cur];
        this.prep(next, segs[this.k], segs[this.k].in);
        next.play().catch(() => {});
        this.show(1 - this.cur);
        v.pause();
        this.cur = 1 - this.cur;
        this.prep(this.v[1 - this.cur], segs[this.k + 1], segs[this.k + 1] && segs[this.k + 1].in);
        this.t = segs[this.k].start;
      } else this.t = Math.max(seg.start, Math.min(seg.end, t));
      // Sound effects des images qui apparaissent.
      for (const o of ae.overlays) if (o.sfx && o.start > this.lastT && o.start <= this.t) playSfx(o.sfx.path);
      this.lastT = this.t;
      showOverlay(this.t);
      drawPlayhead(true);
      timeLabel();
    }
  };

  const sfxPool = new Map();
  function playSfx(p) {
    let a = sfxPool.get(p);
    if (!a) {
      a = new Audio(mediaUrl(p));
      sfxPool.set(p, a);
    }
    a.currentTime = 0;
    a.play().catch(() => {});
  }

  // Overlay visible à l'instant t : image, vidéo (calée sur la timeline) ou modèle animé (repère).
  function showOverlay(t) {
    drawSubs();
    const img = $('#ae-ov');
    const vid = $('#ae-ovv');
    const mg = $('#ae-ovm');
    if (!img) return;
    const o = C.overlayAt(ae.overlays, t);
    img.classList.toggle('hidden', !o || o.kind !== 'image');
    vid.classList.toggle('hidden', !o || o.kind !== 'video');
    mg.classList.toggle('hidden', !o || o.kind !== 'mogrt');
    if (!o || o.kind !== 'video') vid.pause();
    if (!o) return;
    if (o.kind === 'image') {
      const src = mediaUrl(o.path);
      if (img.dataset.src !== src) {
        img.dataset.src = src;
        img.src = src;
      }
    } else if (o.kind === 'video') {
      const src = srcOf(o.path);
      if (vid.dataset.src !== src) {
        vid.dataset.src = src;
        vid.dataset.path = o.path;
        vid.src = src;
        vid.onerror = () => needProxy(o.path, () => showOverlay(player.t), $('#ae-stage-msg'));
      }
      vid.muted = !o.audio;
      const want = (o.from || 0) + (t - o.start);
      if (vid.readyState >= 1 && Math.abs(vid.currentTime - want) > (player.playing ? 0.3 : 0.04)) vid.currentTime = want;
      if (player.playing && vid.paused) vid.play().catch(() => {});
      if (!player.playing && !vid.paused) vid.pause();
    } else {
      mg.innerHTML = `${icon('layers')}<b>${esc(o.name)}</b><span>Modèle animé : visible dans Premiere</span>`;
    }
  }

  function timeLabel() {
    const el = $('#ae-time');
    if (el) el.innerHTML = `<b>${C.fmtTime(player.t, true)}</b> / ${C.fmtTime(ae.seq.total, true)}`;
  }

  function playBtn() {
    const b = $('#ae-play');
    if (b) b.innerHTML = player.playing ? icon('pause') : icon('play');
  }

  function stageMsg() {
    const el = $('#ae-stage-msg');
    if (!el) return;
    const pending = ae.ranks.filter((p) => !analysed(p));
    if (pending.length) {
      el.classList.remove('hidden');
      el.innerHTML = `<span class="spinner"></span>Analyse du son des rushes… ${ae.ranks.length - pending.length}/${ae.ranks.length}<small>Coffile repère les blancs pour les couper.</small>`;
    } else if (!$('#ae-stage-msg').innerHTML.includes('aperçu')) el.classList.add('hidden');
  }

  function rebuild() {
    const clips = ae.ranks.map((p) => ({ path: p, duration: (info(p).probe && info(p).probe.duration) || 0, env: info(p).env, cut: ae.cut[p] !== false }));
    ae.seq = C.withEnding(C.buildSequence(clips, ae.opts), endingSpec());
    recomputeCues();
    for (const o of ae.overlays) o.start = Math.max(0, Math.min(o.start, Math.max(0, ae.seq.total - 0.1)));
    stageMsg();
    fitStage();
    renderSide();
    drawTimeline();
    player.seek(Math.min(player.t, ae.seq.total));
  }

  // La fin choisie, prête pour la séquence (vidéo entière, ou image avec sa durée).
  function endingSpec() {
    const e = ae.ending;
    if (!e) return null;
    if (e.kind === 'image' || e.kind === 'mogrt') return { kind: e.kind, path: e.path, duration: e.duration || (e.kind === 'mogrt' ? 5 : 4) };
    const d = info(e.path).probe && info(e.path).probe.duration;
    return d ? { kind: 'video', path: e.path, duration: d, clip: ae.ranks.length } : null;
  }

  function renderEdit() {
    player.t = 0;
    $('#ae-body').innerHTML = `<div class="ae-edit">
        <div class="ae-stage-col">
          <div class="ae-stage-box" id="ae-stage-box"><div class="ae-stage" id="ae-stage"><video class="ae-v" playsinline></video><video class="ae-v" playsinline></video><img class="ae-still hidden" id="ae-still" alt="" /><div class="ae-mogrt hidden" id="ae-mogrt"></div><img class="ae-ov hidden" id="ae-ov" alt="" /><video class="ae-ov hidden" id="ae-ovv" playsinline></video><div class="ae-ovm hidden" id="ae-ovm"></div><canvas class="ae-subs" id="ae-subs"></canvas><div class="ae-screen-msg hidden" id="ae-stage-msg"></div></div></div>
          <div class="ae-transport">
            <button class="ae-tbtn" data-ae-act="back5" title="Reculer de 5 s (Maj + ←)">${icon('undo')}</button>
            <button class="ae-tbtn big" id="ae-play" data-ae-act="play" title="Lecture / pause (Espace)">${icon('play')}</button>
            <span class="ae-time" id="ae-time"></span>
            <button class="btn sm ae-end-btn" data-ae-act="ending" id="ae-end-btn"></button>
            <span class="ae-hint">${icon('image')}Double-clique sur la vidéo ou la timeline pour ajouter un overlay à ce moment · <kbd>Espace</kbd> lecture</span>
          </div>
        </div>
        <aside class="ae-side" id="ae-side"></aside>
      </div>
      <div class="ae-tl-wrap">
        <div class="ae-tl-tools"><b>${icon('film')}Timeline</b><span id="ae-tl-info"></span><label class="ae-zoom">${icon('search')}<input type="range" min="1" max="12" step="0.5" value="${ae.zoom}" data-ae-zoom /></label></div>
        <div class="ae-tl-scroll" id="ae-tl-scroll"><canvas id="ae-tl"></canvas></div>
      </div>`;
    $('#ae-foot').innerHTML = `<button class="btn ghost" data-ae-act="to-rank">${icon('arrow', 'flip')}Retour au classement</button>
      <span class="ae-foot-info" id="ae-foot-info"></span>
      <button class="btn primary lg" data-ae-act="validate">${icon('check')}Valider et ouvrir dans Premiere Pro</button>`;
    player.attach($('#ae-stage'));
    if (stageObserver) stageObserver.disconnect();
    stageObserver = new ResizeObserver(() => {
      fitStage();
      drawTimeline();
    });
    stageObserver.observe($('#ae-stage-box'));
    // Double-clic sur l'aperçu : image à l'instant affiché.
    $('#ae-stage').addEventListener('dblclick', () => openPicker({ at: player.t }));
    $('#ae-stage').addEventListener('click', () => player.toggle());
    bindTimeline();
    rebuild();
    playBtn();
    prepareProxies();
    startTranscribe();
  }

  // Aperçus légers préparés d'avance pour les rushes classés dans un format non lisible.
  async function prepareProxies() {
    for (const p of ae.ranks) {
      if (ae.step !== 'edit') return;
      if (!unplayable(p) || info(p).proxy) continue;
      await new Promise((done) => {
        needProxy(p, () => {
          player.seek(player.t);
          done();
        }, $('#ae-stage-msg'));
        if (proxyJobs[p]) proxyJobs[p].then(done);
      });
    }
  }

  // Cadre de l'aperçu au format de la séquence (celui du 1er rush classé).
  function seqFormat() {
    const first = ae.ranks.map((p) => info(p).probe).find((p) => p && p.width);
    return first ? { width: first.width, height: first.height, fps: first.fps || 25 } : { width: 1920, height: 1080, fps: 25 };
  }

  function fitStage() {
    const box = $('#ae-stage-box');
    const st = $('#ae-stage');
    if (!box || !st) return;
    const { width, height } = seqFormat();
    const bw = box.clientWidth;
    const bh = box.clientHeight;
    const s = Math.min(bw / width, bh / height);
    st.style.width = `${Math.floor(width * s)}px`;
    st.style.height = `${Math.floor(height * s)}px`;
    drawSubs(true);
  }

  function editInfo() {
    const foot = $('#ae-foot-info');
    if (foot) foot.textContent = `Durée du montage : ${fmtSec(ae.seq.total)} · ${plural(ae.ranks.length, 'rush', 'rushes')} · ${plural(ae.overlays.length, 'overlay', 'overlays')}`;
    const tl = $('#ae-tl-info');
    if (tl) tl.textContent = `${fmtSec(ae.seq.total)} · ${plural(ae.seq.segments.length, 'morceau', 'morceaux')}`;
  }

  function renderSide() {
    const side = $('#ae-side');
    if (!side) return;
    editInfo();
    endBtn();
    const o = ae.overlays.find((x) => x.id === ae.selected);
    if (o) {
      const kindLabel = { image: 'Image', video: 'Vidéo', mogrt: 'Modèle animé' }[o.kind] || 'Overlay';
      side.innerHTML = `<div class="ae-side-head"><b>${icon(KIND_ICON[o.kind] || 'layers')}Overlay · ${kindLabel}</b><button class="ae-x" data-ae-act="unselect" title="Fermer">${icon('x')}</button></div>
        <div class="ae-ov-card"><div class="ae-ov-media">${mediaThumb(o)}</div><span>${esc([o.folder || '', o.name].filter(Boolean).join(' › '))}</span></div>
        <div class="ae-field"><label>Apparaît à</label><div class="ae-inline"><input type="number" min="0" step="0.1" value="${o.start.toFixed(1)}" data-ae-ov="start" /> s<button class="btn sm ghost" data-ae-act="ov-here" title="Placer à la tête de lecture">${icon('pin')}Ici</button></div></div>
        <div class="ae-field"><label>Durée</label><div class="ae-inline"><input type="number" min="0.5" step="0.5" value="${o.duration}" data-ae-ov="duration" /> s</div></div>
        ${o.kind === 'video' ? `<div class="ae-field"><label>Début dans la vidéo</label><div class="ae-inline"><input type="number" min="0" step="0.1" value="${(o.from || 0).toFixed(1)}" data-ae-ov="from" /> s</div></div><label class="ae-check"><input type="checkbox" data-ae-ov-audio ${o.audio ? 'checked' : ''} /><span>${icon('audio')}Garder le son de la vidéo</span></label>` : ''}
        ${o.kind === 'mogrt' ? `<p class="ae-muted small">${icon('layers')}Texte, couleurs et animation du modèle se règlent dans Premiere (panneau Objets graphiques essentiels).</p>` : ''}
        <div class="ae-field"><label>Sound effect</label>${o.sfx ? `<div class="ae-sfx-cur">${icon('music')}<span>${esc(o.sfx.name)}</span><button class="ae-x" data-ae-act="sfx-play" title="Écouter">${icon('play')}</button></div>` : '<span class="ae-muted">Aucun</span>'}</div>
        <div class="ae-side-actions"><button class="btn sm" data-ae-act="ov-edit">${icon('pencil')}Changer</button><button class="btn sm danger" data-ae-act="ov-del">${icon('trash')}Supprimer</button></div>`;
      return;
    }
    const tabs = `<div class="ae-side-tabs"><button class="${ae.sideTab !== 'subs' ? 'on' : ''}" data-ae-tab="cut">${icon('scissors')}Coupe</button><button class="${ae.sideTab === 'subs' ? 'on' : ''}" data-ae-tab="subs">${icon('type')}Sous-titres${ae.subs.enabled ? '<i class="ae-dot"></i>' : ''}</button></div>`;
    if (ae.sideTab === 'subs') {
      const scroll = side.scrollTop;
      side.innerHTML = tabs + subsPanel();
      side.scrollTop = scroll;
      return;
    }
    const removed = ae.seq.perClip.reduce((s, c) => s + (c.removed || 0), 0);
    const pending = ae.ranks.filter((p) => !analysed(p)).length;
    side.innerHTML = `${tabs}<div class="ae-side-head"><b>${icon('scissors')}Coupe des blancs</b><span class="ae-pill">−${fmtSec(removed)}</span></div>
      <div class="ae-field"><label>Coupe <span class="ae-muted" id="ae-sens-label">${sensLabel()}</span></label><div class="ae-range"><span>Douce</span><input type="range" min="0" max="100" step="5" value="${ae.opts.sensitivity}" data-ae-opt="sensitivity" /><span>Forte</span></div></div>
      <div class="ae-field"><label>Pause minimale coupée <span class="ae-muted" id="ae-pause-label">${fmtSec(ae.opts.minPause)}</span></label><div class="ae-range"><span>0,2 s</span><input type="range" min="0.2" max="1.5" step="0.05" value="${ae.opts.minPause}" data-ae-opt="minPause" /><span>1,5 s</span></div></div>
      <div class="ae-clips">${ae.ranks
        .map((p, i) => {
          const r = rush(p);
          const c = ae.seq.perClip[i] || {};
          const it = info(p);
          const st = !analysed(p) ? 'Analyse…' : it.error ? 'Lecture impossible' : c.mode === 'cut' ? `${c.count} morceaux · −${fmtSec(c.removed)}` : c.reason === 'coupe désactivée' ? 'Gardé en entier' : c.reason === 'sans son' ? 'Sans son · en entier' : 'Sans parole · en entier';
          return `<div class="ae-clip"><i style="background:${COLORS[i % COLORS.length]}">${i + 1}</i><div><b title="${esc(r ? r.name : p)}">${esc(r ? r.name : p)}</b><span>${esc(st)}</span></div><label class="ae-switch" title="Couper les blancs de ce rush"><input type="checkbox" data-ae-cut="${esc(p)}" ${ae.cut[p] !== false ? 'checked' : ''} /><span></span></label></div>`;
        })
        .join('')}</div>
      ${endingBlock()}
      ${pending ? '' : `<p class="ae-muted small">${icon('layers')}${ae.overlays.length ? `${plural(ae.overlays.length, 'overlay ajouté', 'overlays ajoutés')} · clique dessus dans la timeline pour le modifier.` : 'Double-clique sur la vidéo ou la timeline pour ajouter un overlay (image, vidéo, modèle).'}</p>`}`;
  }

  function endingBlock() {
    const e = ae.ending;
    if (!e) return `<div class="ae-ending none"><span>${icon('flag')}Pas de fin</span><button class="btn sm" data-ae-act="ending">${icon('plus')}Ajouter une fin</button></div>`;
    const d = e.kind === 'image' || e.kind === 'mogrt' ? e.duration || (e.kind === 'mogrt' ? 5 : 4) : info(e.path).probe && info(e.path).probe.duration;
    return `<div class="ae-ending"><i>${icon('flag')}</i><div><b title="${esc(e.name)}">${esc(e.name)}</b><span>Fin · ${e.kind === 'image' ? 'image' : e.kind === 'mogrt' ? 'modèle animé' : 'vidéo'}${d ? ` · ${fmtSec(d)}` : ''}</span></div><button class="btn sm ghost" data-ae-act="ending">Changer</button><button class="ae-x" data-ae-act="ending-del" title="Retirer la fin">${icon('x')}</button></div>`;
  }

  function endBtn() {
    const b = $('#ae-end-btn');
    if (b) b.innerHTML = `${icon('flag')}${ae.ending ? 'Changer la fin' : 'Ajouter une fin'}`;
  }

  const sensLabel = () => (ae.opts.sensitivity <= 30 ? 'douce' : ae.opts.sensitivity >= 70 ? 'forte' : 'normale');

  // ---------- Timeline ----------
  let stageObserver = null;
  let drag = null;
  let staticCanvas = null;
  let pps = 1;

  function tlWidth() {
    const scroll = $('#ae-tl-scroll');
    const w = scroll ? scroll.clientWidth : 800;
    const total = Math.max(ae.seq.total, 1);
    pps = ((w - TL.pad * 2) / total) * ae.zoom;
    return Math.max(w, Math.ceil(total * pps + TL.pad * 2));
  }
  const xOf = (t) => TL.pad + t * pps;
  const tOf = (x) => Math.max(0, Math.min(ae.seq.total, (x - TL.pad) / pps));

  function drawTimeline() {
    const cv = $('#ae-tl');
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = tlWidth();
    const H = TL.height;
    if (!ae.open || W < 2) return;
    cv.style.width = `${W}px`;
    cv.style.height = `${H}px`;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    staticCanvas = document.createElement('canvas');
    staticCanvas.width = cv.width;
    staticCanvas.height = cv.height;
    const g = staticCanvas.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = '#0d0d10';
    g.fillRect(0, 0, W, H);
    // Règle.
    g.font = '10px InterVar, Segoe UI, sans-serif';
    g.fillStyle = '#6b6b75';
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const stepS = steps.find((s) => s * pps >= 70) || 600;
    for (let s = 0; s <= ae.seq.total + 0.001; s += stepS) {
      const x = Math.round(xOf(s)) + 0.5;
      g.beginPath();
      g.moveTo(x, TL.ruler - 6);
      g.lineTo(x, H);
      g.stroke();
      g.fillText(C.fmtTime(s, stepS < 1), x + 3, 12);
    }
    // Pistes.
    g.fillStyle = 'rgba(255,255,255,0.025)';
    g.fillRect(0, TL.imgTop, W, TL.imgH);
    g.fillRect(0, TL.clipTop, W, TL.clipH);
    // Rushes coupés, avec la forme du son.
    for (const seg of ae.seq.segments) {
      const x0 = xOf(seg.start);
      const x1 = xOf(seg.end);
      const col = seg.ending ? '#e9c46a' : COLORS[seg.clip % COLORS.length];
      g.fillStyle = col + '33';
      g.fillRect(x0, TL.clipTop, Math.max(1, x1 - x0 - 1), TL.clipH);
      g.fillStyle = col;
      g.fillRect(x0, TL.clipTop, Math.max(1, x1 - x0 - 1), 3);
      // Fin en image : sa vignette.
      if (seg.kind === 'image') {
        const im = thumbFor(seg.path);
        if (im && im.complete && im.naturalWidth) {
          const h = TL.clipH - 26;
          const iw = Math.min(x1 - x0 - 8, (im.naturalWidth / im.naturalHeight) * h);
          if (iw > 4) g.drawImage(im, x0 + 4, TL.clipTop + 21, iw, h);
        }
      }
      const env = seg.kind === 'image' || seg.kind === 'mogrt' ? null : info(seg.path).env;
      if (env && env.db && env.db.length) {
        g.fillStyle = col + 'aa';
        const mid = TL.clipTop + 8 + (TL.clipH - 12) / 2;
        for (let x = Math.floor(x0); x < x1 - 1; x++) {
          const a = seg.in + ((x - x0) / pps);
          const b = seg.in + ((x + 1 - x0) / pps);
          let m = -90;
          for (let i = Math.floor(a * env.rate); i <= Math.floor(b * env.rate) && i < env.db.length; i++) m = Math.max(m, env.db[i]);
          const h = Math.max(1, ((Math.max(-60, m) + 60) / 60) * ((TL.clipH - 14) / 2));
          g.fillRect(x, mid - h, 1, h * 2);
        }
      }
      // Coupe entre deux morceaux du même rush.
      g.fillStyle = '#09090b';
      g.fillRect(x1 - 1, TL.clipTop, 1, TL.clipH);
      const r = seg.ending ? { name: ae.ending ? ae.ending.name : '' } : rush(seg.path);
      if (x1 - x0 > 40 && r) {
        g.fillStyle = '#f4f4f5';
        g.font = '600 10.5px InterVar, Segoe UI, sans-serif';
        g.save();
        g.beginPath();
        g.rect(x0 + 4, TL.clipTop, x1 - x0 - 8, TL.clipH);
        g.clip();
        g.fillText(seg.ending ? `FIN · ${r.name}` : `${seg.clip + 1}. ${r.name}`, x0 + 5, TL.clipTop + 15);
        g.restore();
      }
    }
    // Overlays (et leur sound effect) : vignette, nom, pastille « SFX ».
    const OV_COL = { image: '52,211,153', video: '91,140,255', mogrt: '233,196,106' };
    for (const o of ae.overlays) {
      const x0 = xOf(o.start);
      const w = Math.max(6, o.duration * pps);
      const sel = o.id === ae.selected;
      const c = OV_COL[o.kind] || OV_COL.image;
      g.fillStyle = `rgba(${c},${sel ? 0.35 : 0.18})`;
      g.strokeStyle = `rgba(${c},${sel ? 1 : 0.6})`;
      g.lineWidth = sel ? 2 : 1;
      roundRect(g, x0, TL.imgTop + 3, w, TL.imgH - 6, 5);
      g.fill();
      g.stroke();
      const im = o.kind === 'image' ? thumbFor(o.path) : o.kind === 'video' ? videoThumbFor(o.path, o.from || 0) : null;
      let tx = x0 + 5;
      const nw = im ? im.naturalWidth || im.width : 0;
      const nh = im ? im.naturalHeight || im.height : 0;
      if (nw && nh) {
        const h = TL.imgH - 12;
        const iw = Math.min(w - 6, (nw / nh) * h);
        if (iw > 4) {
          g.drawImage(im, x0 + 3, TL.imgTop + 6, iw, h);
          tx = x0 + 6 + iw + 4;
        }
      }
      if (x0 + w - tx > 30) {
        g.save();
        g.beginPath();
        g.rect(tx, TL.imgTop, x0 + w - tx - 3, TL.imgH);
        g.clip();
        g.fillStyle = '#f4f4f5';
        g.font = '600 10px InterVar, Segoe UI, sans-serif';
        g.fillText(o.kind === 'mogrt' ? `MOGRT · ${o.name}` : o.name, tx, TL.imgTop + 16);
        g.restore();
      }
      // Pastille « SFX » : un sound effect démarre avec l'overlay.
      if (o.sfx) {
        const px = Math.max(x0 + 3, Math.min(x0 + w - 30, tx));
        g.fillStyle = '#fbbf24';
        roundRect(g, px, TL.imgTop + TL.imgH - 19, 27, 13, 4);
        g.fill();
        g.fillStyle = '#1a1206';
        g.font = '800 9px InterVar, Segoe UI, sans-serif';
        g.fillText('SFX', px + 4.5, TL.imgTop + TL.imgH - 9.5);
      }
    }
    g.lineWidth = 1;
    drawPlayhead();
  }

  // Image d'une vidéo (overlay) pour la timeline, faite une fois.
  const vthumbs = new Map();
  function videoThumbFor(p, at) {
    const key = `${p}|${at}`;
    if (vthumbs.has(key)) return vthumbs.get(key);
    const cv = document.createElement('canvas');
    cv.width = 0;
    vthumbs.set(key, cv);
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.onloadeddata = () => {
      v.currentTime = Math.min(at + 0.05, (v.duration || 1) - 0.05);
    };
    v.onseeked = () => {
      if (!v.videoWidth) return;
      cv.width = 160;
      cv.height = Math.round((160 * v.videoHeight) / v.videoWidth);
      cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
      v.removeAttribute('src');
      v.load();
      drawTimeline();
    };
    v.src = srcOf(p);
    return cv;
  }

  const thumbs = new Map();
  function thumbFor(p) {
    let im = thumbs.get(p);
    if (!im) {
      im = new Image();
      im.onload = () => drawTimeline();
      im.src = mediaUrl(p);
      thumbs.set(p, im);
    }
    return im;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawPlayhead(follow) {
    const cv = $('#ae-tl');
    // AUTOEDIT fermé ou pas encore affiché : rien à dessiner.
    if (!cv || !staticCanvas || !staticCanvas.width || !staticCanvas.height || !cv.width) return;
    const g = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(staticCanvas, 0, 0);
    g.scale(dpr, dpr);
    const x = Math.round(xOf(player.t)) + 0.5;
    g.strokeStyle = '#ff7a32';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x, 4);
    g.lineTo(x, TL.height);
    g.stroke();
    g.fillStyle = '#ff7a32';
    g.beginPath();
    g.moveTo(x - 5, 2);
    g.lineTo(x + 5, 2);
    g.lineTo(x, 9);
    g.closePath();
    g.fill();
    if (follow) {
      const sc = $('#ae-tl-scroll');
      if (sc && (x < sc.scrollLeft + 40 || x > sc.scrollLeft + sc.clientWidth - 40)) sc.scrollLeft = x - 60;
    }
  }

  function overlayAtX(x, y) {
    if (y < TL.imgTop || y > TL.imgTop + TL.imgH) return null;
    let hit = null;
    for (const o of ae.overlays) {
      const x0 = xOf(o.start);
      if (x >= x0 && x <= x0 + Math.max(6, o.duration * pps)) hit = o;
    }
    return hit;
  }

  const tlPos = (e) => {
    const r = $('#ae-tl').getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Glisser une image ou la tête de lecture (écouteurs posés une seule fois).
  window.addEventListener('mousemove', (e) => {
    if (!drag || !ae.open || !$('#ae-tl')) return;
    const { x } = tlPos(e);
    if (drag.o) {
      drag.moved = true;
      drag.o.start = Math.round(Math.max(0, Math.min(ae.seq.total - 0.1, tOf(x) - drag.off)) * 10) / 10;
      drawTimeline();
    } else if (drag.scrub) player.seek(tOf(x));
  });
  window.addEventListener('mouseup', () => {
    if (drag && drag.o && drag.moved) {
      save();
      renderSide();
    }
    drag = null;
  });

  function bindTimeline() {
    const cv = $('#ae-tl');
    const pos = tlPos;
    cv.addEventListener('mousedown', (e) => {
      const { x, y } = pos(e);
      const o = overlayAtX(x, y);
      if (o) {
        ae.selected = o.id;
        drag = { o, off: tOf(x) - o.start, moved: false };
        renderSide();
        drawTimeline();
      } else drag = { seek: true };
      if (drag.seek) {
        player.seek(tOf(x));
        drag.scrub = true;
      }
    });
    cv.addEventListener('dblclick', (e) => {
      const { x, y } = pos(e);
      const o = overlayAtX(x, y);
      if (o) openPicker({ edit: o });
      else openPicker({ at: tOf(x) });
    });
  }

  // ---------- Choix d'une image (et d'un sound effect) ----------
  const sfxPreview = new Audio();

  // ---------- Ajouter un overlay : IMAGES, RUSHES ou TEMPLATE, puis réglages ----------
  const SOURCES = [
    ['IMAGES', 'images', 'image'],
    ['RUSHES', 'rushes', 'film'],
    ['TEMPLATE', 'templates', 'layers']
  ];
  const filesOf = (src) => ae.media[(SOURCES.find((x) => x[0] === src) || SOURCES[0])[1]] || [];

  function openPicker({ at, edit }) {
    player.pause();
    const o = edit || null;
    const firstFull = (SOURCES.find((x) => filesOf(x[0]).length) || SOURCES[0])[0];
    ae.pick = {
      mode: 'overlay',
      at: o ? o.start : at,
      edit: o ? o.id : null,
      src: o ? o.folder || 'IMAGES' : ae.lastSrc && filesOf(ae.lastSrc).length ? ae.lastSrc : firstFull,
      sel: o ? { ...o } : null,
      duration: o ? o.duration : ae.imgDuration,
      durTouched: !!o,
      from: o ? o.from || 0 : 0,
      audio: o ? !!o.audio : false,
      sfxOn: o ? !!o.sfx : false,
      sfx: o ? o.sfx : null,
      q: '',
      sq: ''
    };
    renderPicker();
    $('#ae-picker').classList.remove('hidden');
  }

  // ---------- Fin : toutes les fins trouvées (OUTRO, FIN, END…), la meilleure présélectionnée ----------
  function openEnding() {
    player.pause();
    const list = ae.media.endings || [];
    const cur = ae.ending;
    const pre = cur ? cur.path : list[0] ? list[0].path : null;
    ae.pick = { mode: 'ending', sel: pre, duration: (cur && cur.duration) || 4, all: !list.length };
    renderEnding();
    $('#ae-picker').classList.remove('hidden');
  }

  function renderEnding() {
    const p = ae.pick;
    const found = ae.media.endings || [];
    const found2 = new Set(found.map((f) => f.path));
    const others = p.all ? allFiles().filter((f) => !found2.has(f.path)) : [];
    const card = (f) => {
      const d = f.kind === 'video' && info(f.path).probe && info(f.path).probe.duration;
      const media = mediaThumb(f);
      return `<button class="ae-end ${p.sel === f.path ? 'on' : ''}" data-ae-end="${esc(f.path)}" data-kind="${f.kind}" title="${esc([...f.rel, f.name].join(' › '))}">
        <div class="ae-end-media">${media}<span class="ae-end-kind">${icon(KIND_ICON[f.kind] || 'file')}</span>${d ? `<span class="ae-dur">${C.fmtTime(d)}</span>` : ''}</div>
        <b>${esc(f.name)}</b><span>${esc([f.folder || (f.kind === 'video' ? 'RUSHES' : 'IMAGES'), ...f.rel].join(' › '))}</span>${f.word ? `<i class="ae-tag">${esc(f.word)}</i>` : ''}
      </button>`;
    };
    const sel = [...found, ...others].find((f) => f.path === p.sel);
    $('#ae-picker').innerHTML = `<div class="ae-pick">
      <header><b>${icon('flag')}${ae.ending ? 'Changer la fin' : 'Ajouter une fin'}</b><button class="ae-x" data-ae-act="pick-close">${icon('x')}</button></header>
      <div class="ae-pick-body one">
        <div class="ae-pick-imgs">
          <p class="ae-help">${icon('sparkles')}<span>${found.length ? `Coffile a trouvé <b>${plural(found.length, 'fin', 'fins')}</b> dans RUSHES, IMAGES et TEMPLATE (fichiers nommés OUTRO, FIN, END, ENDING, END CARD, GÉNÉRIQUE, PACKSHOT…). La plus probable est sélectionnée : elle sera mise après le montage.` : 'Aucun fichier de fin trouvé dans RUSHES, IMAGES et TEMPLATE (OUTRO, FIN, END, END CARD, GÉNÉRIQUE…). Choisis un fichier ci-dessous.'}</span></p>
          ${found.length ? `<div class="ae-end-grid">${found.map(card).join('')}</div>` : ''}
          ${p.all ? `${found.length ? '<div class="ae-sub">Tous les fichiers</div>' : ''}<div class="ae-end-grid">${others.map(card).join('') || '<div class="ae-muted small">Aucun fichier.</div>'}</div>` : `<button class="btn sm ghost" data-ae-act="end-all">${icon('list')}Voir aussi tous les fichiers (RUSHES, IMAGES, TEMPLATE)</button>`}
        </div>
      </div>
      <footer>
        ${sel && (sel.kind === 'image' || sel.kind === 'mogrt') ? `<div class="ae-inline">Durée ${sel.kind === 'mogrt' ? 'du modèle' : "de l'image"} <input type="number" min="1" step="0.5" value="${p.duration}" data-ae-end-dur /> s</div>` : ''}
        ${ae.ending ? `<button class="btn ghost danger-text" data-ae-act="ending-del">${icon('trash')}Pas de fin</button>` : ''}
        <span class="ae-grow"></span>
        <button class="btn ghost" data-ae-act="pick-close">Annuler</button>
        <button class="btn primary" data-ae-act="end-ok" ${sel ? '' : 'disabled'}>${icon('check')}Mettre cette fin</button>
      </footer>
    </div>`;
  }

  async function endingOk() {
    const p = ae.pick;
    const f = [...(ae.media.endings || []), ...allFiles()].find((x) => x.path === p.sel);
    if (!f) return;
    const e = { kind: f.kind, path: f.path, name: f.name };
    if (f.kind === 'image') Object.assign(e, { duration: Math.max(1, Number(p.duration) || 4) }, await imageSize(f.path));
    if (f.kind === 'mogrt') e.duration = Math.max(1, Number(p.duration) || 5);
    // La fin ne reste pas aussi au milieu du montage.
    const i = ae.ranks.indexOf(f.path);
    if (i >= 0) {
      ae.ranks.splice(i, 1);
      toast(`« ${f.name} » est maintenant la fin (retiré du classement).`);
    }
    if (f.kind === 'video' && !analysed(f.path)) api.autoeditAnalyze([f.path]);
    ae.ending = e;
    closePicker();
    save();
    rebuild();
    player.seek(Math.max(0, ae.seq.total - (f.kind === 'image' ? e.duration : (info(f.path).probe && info(f.path).probe.duration) || 0)));
  }

  function closePicker() {
    sfxPreview.pause();
    $('#ae-picker').classList.add('hidden');
    ae.pick = null;
  }

  function renderPicker() {
    const p = ae.pick;
    const q = p.q.toLowerCase();
    const files = filesOf(p.src).filter((f) => !q || `${f.rel.join(' ')} ${f.name}`.toLowerCase().includes(q));
    const sq = p.sq.toLowerCase();
    const sfx = ae.media.sfx.filter((x) => !sq || `${x.rel.join(' ')} ${x.name}`.toLowerCase().includes(sq));
    const sel = p.sel;
    const tabs = SOURCES.map(([label, , ic]) => `<button class="${p.src === label ? 'on' : ''}" data-ae-src="${label}">${icon(ic)}${label}<i>${filesOf(label).length}</i></button>`).join('');
    const card = (f) => {
      const d = f.kind === 'video' && info(f.path).probe && info(f.path).probe.duration;
      return `<button class="ae-img ${sel && sel.path === f.path ? 'on' : ''}" data-ae-file="${esc(f.path)}" title="${esc([f.folder, ...f.rel, f.name].join(' › '))}"><div class="ae-img-media">${mediaThumb(f)}<span class="ae-end-kind">${icon(KIND_ICON[f.kind] || 'file')}</span>${d ? `<span class="ae-dur">${C.fmtTime(d)}</span>` : ''}</div><span>${esc(f.name)}</span>${f.rel.length ? `<em>${esc(f.rel.join(' › '))}</em>` : ''}</button>`;
    };
    const settings = !sel
      ? `<div class="ae-empty sm">${icon('layers')}<span>Choisis un fichier à gauche.</span></div>`
      : `<div class="ae-sel-name">${icon(KIND_ICON[sel.kind] || 'file')}<b>${esc(sel.name)}</b></div>
        ${sel.kind === 'video' ? `<div class="ae-pick-prev"><video id="ae-pick-video" src="${esc(srcOf(sel.path))}#t=${p.from}" controls playsinline muted></video></div>
        <div class="ae-field"><label>Début dans la vidéo</label><div class="ae-inline"><input type="number" min="0" step="0.1" value="${Number(p.from).toFixed(1)}" data-ae-pick-from /> s<button class="btn sm ghost" data-ae-act="pick-from-here" title="Prendre l'instant affiché dans l'aperçu">${icon('pin')}Instant affiché</button></div></div>` : ''}
        ${sel.kind === 'mogrt' ? `<p class="ae-muted small">${icon('layers')}Modèle animé (.mogrt) : Premiere le place lui-même à cet instant. Son texte et ses couleurs se règlent ensuite dans Premiere.</p>` : ''}
        <div class="ae-field"><label>Durée à l'écran</label><div class="ae-inline"><input type="number" min="0.5" step="0.5" value="${p.duration}" data-ae-pick-dur /> s</div></div>
        ${sel.kind === 'video' ? `<label class="ae-check"><input type="checkbox" data-ae-pick-audio ${p.audio ? 'checked' : ''} /><span>${icon('audio')}Garder le son de la vidéo</span></label>` : ''}
        <label class="ae-check"><input type="checkbox" data-ae-sfx-on ${p.sfxOn ? 'checked' : ''} /><span>${icon('music')}Sound effect quand l'overlay apparaît</span></label>
        <div class="ae-sfx ${p.sfxOn ? '' : 'off'}">
          ${
            ae.media.sfx.length
              ? `<div class="ae-search">${icon('search')}<input type="text" placeholder="Chercher un son…" value="${esc(p.sq)}" data-ae-sfx-q /></div>
            <div class="ae-sfx-list">${sfx
              .map((x) => `<div class="ae-sfx-row ${p.sfx && p.sfx.path === x.path ? 'on' : ''}" data-ae-sfx="${esc(x.path)}"><button class="ae-x" data-ae-sfx-play="${esc(x.path)}" title="Écouter">${icon('play')}</button><span title="${esc([...x.rel, x.name].join(' › '))}">${esc(x.name)}</span>${x.source === 'bibliotheque' ? '<em>bibliothèque</em>' : ''}</div>`)
              .join('') || '<div class="ae-muted small">Aucun son ne correspond.</div>'}</div>`
              : `<div class="ae-empty sm">${icon('music')}<span>Aucun sound effect dans le dossier SOUND EFFECT du projet.</span></div>`
          }
          <button class="btn sm ghost" data-ae-act="sfx-dir">${icon('folderOpen')}${ae.sfxLibrary ? 'Changer de dossier de sound effects' : 'Choisir mon dossier de sound effects'}</button>
        </div>`;
    $('#ae-picker').innerHTML = `<div class="ae-pick">
      <header><b>${icon('layers')}${p.edit ? "Modifier l'overlay" : 'Ajouter un overlay'} à ${C.fmtTime(p.at, true)}</b><button class="ae-x" data-ae-act="pick-close">${icon('x')}</button></header>
      <div class="ae-pick-body">
        <div class="ae-pick-imgs">
          <div class="ae-src-tabs">${tabs}</div>
          <div class="ae-search">${icon('search')}<input type="text" placeholder="Chercher dans ${esc(p.src)}…" value="${esc(p.q)}" data-ae-pick-q /></div>
          <div class="ae-img-grid">${files.length ? files.map(card).join('') : `<div class="ae-empty sm">${icon('folder')}<span>${filesOf(p.src).length ? 'Aucun fichier ne correspond.' : `Le dossier ${esc(p.src)} du projet est vide.`}</span></div>`}</div>
        </div>
        <div class="ae-pick-side">${settings}</div>
      </div>
      <footer><button class="btn ghost" data-ae-act="pick-close">Annuler</button><button class="btn primary" data-ae-act="pick-ok" ${sel && (!p.sfxOn || p.sfx) ? '' : 'disabled'}>${icon('check')}${p.edit ? 'Enregistrer' : "Ajouter l'overlay"}</button></footer>
    </div>`;
    const pv = $('#ae-pick-video');
    if (pv) {
      pv.onloadedmetadata = () => {
        p.fileDuration = pv.duration;
        p.vw = pv.videoWidth;
        p.vh = pv.videoHeight;
        if (!pv.videoWidth && sel) needProxy(sel.path, () => ae.pick && renderPicker(), null);
        // Durée proposée : ce qui reste de la vidéo, 5 s au plus.
        if (!p.durTouched) {
          p.duration = Math.max(0.5, Math.round(Math.min(5, pv.duration - p.from) * 10) / 10);
          const d = $('[data-ae-pick-dur]');
          if (d) d.value = p.duration;
        }
      };
      pv.onerror = () => sel && needProxy(sel.path, () => ae.pick && renderPicker(), null);
    }
  }

  function pickFile(path) {
    const p = ae.pick;
    const f = filesOf(p.src).find((x) => x.path === path);
    if (!f) return;
    p.sel = { kind: f.kind, path: f.path, name: f.name, folder: f.folder };
    p.from = 0;
    p.durTouched = false;
    p.duration = f.kind === 'image' ? ae.imgDuration : f.kind === 'mogrt' ? 5 : Math.min(5, (info(f.path).probe && info(f.path).probe.duration) || 5);
    renderPicker();
  }

  function imageSize(p) {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve({ width: im.naturalWidth, height: im.naturalHeight });
      im.onerror = () => resolve({});
      im.src = mediaUrl(p);
    });
  }

  async function pickOk() {
    const p = ae.pick;
    if (!p || !p.sel) return;
    const sel = p.sel;
    const ov = { kind: sel.kind, path: sel.path, name: sel.name, folder: sel.folder, duration: Math.max(0.5, Number(p.duration) || 3), sfx: p.sfxOn && p.sfx ? { path: p.sfx.path, name: p.sfx.name } : null };
    if (sel.kind === 'image') {
      Object.assign(ov, sel.width ? { width: sel.width, height: sel.height } : await imageSize(sel.path));
      ae.imgDuration = ov.duration;
    } else if (sel.kind === 'video') {
      const pr = info(sel.path).probe || {};
      Object.assign(ov, { from: Math.max(0, Number(p.from) || 0), audio: !!p.audio, width: p.vw || sel.width || pr.width, height: p.vh || sel.height || pr.height, fileDuration: p.fileDuration || sel.fileDuration || pr.duration });
    }
    if (p.edit) {
      const o = ae.overlays.find((x) => x.id === p.edit);
      if (o) {
        for (const k of ['from', 'audio', 'width', 'height', 'fileDuration']) delete o[k];
        Object.assign(o, ov);
      }
    } else {
      const o = { id: `ov${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, start: Math.round(p.at * 10) / 10, ...ov };
      ae.overlays.push(o);
      ae.selected = o.id;
    }
    ae.lastSrc = p.src;
    closePicker();
    save();
    renderSide();
    drawTimeline();
    player.seek(player.t);
  }

  // ---------- Étape 3 : validation ----------
  async function validate() {
    if (ae.ranks.some((p) => !analysed(p)) || (ae.ending && ae.ending.kind === 'video' && !analysed(ae.ending.path))) {
      toast("L'analyse des rushes n'est pas finie, encore un instant.", 'err');
      return;
    }
    player.pause();
    const btn = $('[data-ae-act="validate"]');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span>Création du montage…`;
    }
    const fmt = seqFormat();
    const clipOf = (p) => {
      const pr = info(p).probe || {};
      return { path: p, name: rush(p).name, duration: pr.duration, width: pr.width, height: pr.height, hasAudio: pr.hasAudio, channels: pr.channels, sampleRate: pr.sampleRate };
    };
    const clips = ae.ranks.map(clipOf);
    if (ae.ending && ae.ending.kind === 'video') clips.push(clipOf(ae.ending.path));
    // Sous-titres : .srt (piste Premiere), ou images au style exact (incrustés).
    let captions = null;
    if (ae.subs.enabled) {
      if (ae.ranks.some((p) => !ae.words[p] && !info(p).subsError) && modelReady()) {
        toast('La transcription des sous-titres n’est pas finie, encore un instant.', 'err');
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = `${icon('check')}Valider et ouvrir dans Premiere Pro`;
        }
        return;
      }
      if (ae.cues.length) {
        const srt = C.toSrt(ae.cues);
        if (ae.subs.mode === 'burn') {
          if (btn) btn.innerHTML = `<span class="spinner"></span>Sous-titres incrustés…`;
          const saved = await api.autoeditSaveSubs(ae.dir, await renderSubImages(fmt.width, fmt.height));
          captions = { mode: 'burn', srt, images: saved.ok ? saved.images : [] };
        } else captions = { mode: 'premiere', srt };
      }
    }
    const res = await api.autoeditExport({
      captions,
      projectDir: ae.dir,
      name: ae.name,
      fps: fmt.fps,
      width: fmt.width,
      height: fmt.height,
      clips,
      segments: ae.seq.segments.map((s) =>
        s.kind === 'image'
          ? { still: { path: ae.ending.path, name: ae.ending.name, width: ae.ending.width, height: ae.ending.height }, duration: s.out - s.in }
          : s.kind === 'mogrt'
            ? { mogrt: { path: ae.ending.path, name: ae.ending.name }, duration: s.out - s.in }
            : { clip: s.clip, in: s.in, out: s.out }
      ),
      overlays: ae.overlays.map((o) => ({ kind: o.kind, path: o.path, name: o.name, width: o.width, height: o.height, start: o.start, duration: o.duration, from: o.from || 0, audio: !!o.audio, fileDuration: o.fileDuration, sfx: o.sfx }))
    });
    if (!res.ok) {
      toast(res.error || 'Montage impossible', 'err');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `${icon('check')}Valider et ouvrir dans Premiere Pro`;
      }
      return;
    }
    ae.result = res;
    ae.step = 'done';
    save(true);
    render();
    watchJob();
  }

  // ---------- Suivi du montage dans Premiere ----------
  // Coffile dépose le montage pour l'extension Coffile de Premiere, puis suit son état ici.
  let jobTimer = null;
  function watchJob() {
    clearInterval(jobTimer);
    const r = ae.result;
    if (!r || !r.jobId) return;
    ae.job = { state: 'waiting', since: Date.now(), alive: r.alive, running: r.running, n: 0 };
    jobTimer = setInterval(async () => {
      if (!ae.open || ae.step !== 'done' || !ae.result || ae.result.jobId !== r.jobId) return clearInterval(jobTimer);
      const st = await api.autoeditJobState(r.jobId, ae.job.n++ % 4 === 0);
      Object.assign(ae.job, st);
      if (st.running != null) ae.job.running = st.running;
      if (st.state === 'done') clearInterval(jobTimer);
      renderDone();
    }, 1000);
  }

  function jobStatus() {
    const r = ae.result || {};
    const j = ae.job || { state: 'waiting', since: Date.now() };
    const waited = (Date.now() - j.since) / 1000;
    if (j.state === 'done' && j.result && j.result.ok) {
      const x = j.result;
      const bits = [plural(x.clips || 0, 'clip', 'clips'), x.captions ? 'piste de sous-titres' : '', x.mogrts ? plural(x.mogrts, 'modèle animé', 'modèles animés') : ''].filter(Boolean).join(' · ');
      return { cls: 'ok', icon: 'check', title: 'Le montage est dans Premiere', text: `Séquence <b>${esc(x.sequence)}</b> créée et ouverte dans <b>${esc((x.project || r.project || '').split(/[\\/]/).pop())}</b> (${esc(bits)}). Le projet est enregistré.${x.plan === 'api' ? ' Construite clip par clip par Coffile.' : ''}`, warn: x.warnings || [] };
    }
    if (j.state === 'done') return { cls: 'err', icon: 'alert', title: "Premiere n'a pas pu construire le montage", text: `${esc((j.result && j.result.error) || 'Erreur inconnue')}. Tu peux importer le fichier ci-dessous à la main : <b>Fichier › Importer</b> dans Premiere.` };
    if (j.state === 'working') return { cls: 'wait', icon: 'spin', title: 'Premiere construit le montage…', text: 'Import de la séquence, des images, des sound effects et des sous-titres dans ton projet.' };
    if (j.alive) return { cls: 'wait', icon: 'spin', title: 'Premiere a reçu le montage…', text: 'Il va le construire dans quelques secondes.' };
    if (r.noPremiere) return { cls: 'err', icon: 'alert', title: "Premiere n'a pas été trouvé sur ce PC", text: 'Indique où il est installé : le montage se fera tout seul dès qu’il sera ouvert.', pick: true };
    if (j.running && waited > 12)
      return {
        cls: 'warn',
        icon: 'alert',
        title: 'Ferme Premiere et rouvre-le',
        text: `Premiere est ouvert, mais l'extension Coffile n'y est pas encore chargée${r.fresh ? ' (elle vient d’être installée)' : ''}. Ferme Premiere, puis clique sur <b>Rouvrir Premiere</b> : le montage se fera tout seul. C'est à faire une seule fois.${waited > 60 ? ' Sinon, dans Premiere : <b>Fenêtre › Extensions › Coffile</b>.' : ''}`,
        relaunch: true
      };
    return {
      cls: 'wait',
      icon: 'spin',
      title: j.running ? 'En attente de Premiere…' : 'Ouverture de Premiere…',
      text: `Le montage se fera tout seul dès que Premiere sera prêt.${waited > 90 ? ' Si rien ne se passe : dans Premiere, <b>Fenêtre › Extensions › Coffile</b>.' : ''}`,
      relaunch: waited > 45 && !j.running
    };
  }

  function renderDone() {
    const r = ae.result || {};
    const file = r.file || '';
    const st = jobStatus();
    const done = ae.job && ae.job.state === 'done';
    $('#ae-body').innerHTML = `<div class="ae-done">
      <div class="ae-job ${st.cls}"><div class="ae-job-ico">${st.icon === 'spin' ? '<span class="spinner"></span>' : icon(st.icon)}</div><div><h2>${st.title}</h2><p>${st.text}</p>${(st.warn || []).length ? `<ul>${st.warn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</div></div>
      <div class="ae-done-stats"><span>${icon('film')}${plural(ae.ranks.length, 'rush', 'rushes')}</span><span>${icon('scissors')}${plural(ae.seq.segments.length, 'morceau', 'morceaux')}</span><span>${icon('layers')}${plural(ae.overlays.length, 'overlay', 'overlays')}</span>${ae.subs && ae.subs.enabled ? `<span>${icon('type')}sous-titres</span>` : ''}<span>${icon('clock')}${fmtSec(ae.seq.total)}</span></div>
      <div class="ae-file" title="${esc(file)}">${icon('file')}<span>${esc(file.length > 80 ? `…${file.slice(-78)}` : file)}</span></div>
      <div class="ae-done-actions">
        ${st.relaunch ? `<button class="btn primary" data-ae-act="relaunch">${icon('play')}Rouvrir Premiere</button>` : ''}
        ${st.pick ? `<button class="btn primary" data-ae-act="pick-premiere">${icon('search')}Où est Premiere ?</button>` : ''}
        ${done ? `<button class="btn" data-ae-act="validate">${icon('refresh')}Refaire dans Premiere</button>` : ''}
        <button class="btn" data-ae-act="reveal">${icon('folderOpen')}Afficher le fichier</button>
        <button class="btn ghost" data-ae-act="to-edit">${icon('pencil')}Modifier le montage</button>
      </div>
    </div>`;
    $('#ae-foot').innerHTML = `<span class="ae-foot-info">${icon('sparkles')}Ton classement, tes overlays et tes sous-titres sont gardés : tu peux revenir sur ce montage depuis Projets.</span><button class="btn" data-ae-act="close">Terminer</button>`;
  }

  // ---------- Événements ----------
  function bind() {
    const el = root();
    el.addEventListener('click', async (e) => {
      const t = e.target;
      const act = t.closest('[data-ae-act]');
      const moveBtn = t.closest('[data-ae-move]');
      if (moveBtn) {
        e.stopPropagation();
        // Change la place d'un rush classé (échange avec son voisin).
        const i = ae.ranks.indexOf(moveBtn.dataset.path);
        const j = i + Number(moveBtn.dataset.aeMove);
        if (i >= 0 && j >= 0 && j < ae.ranks.length) {
          [ae.ranks[i], ae.ranks[j]] = [ae.ranks[j], ae.ranks[i]];
          save();
          refreshCards();
          viewerBar();
        }
        return;
      }
      const rankBtn = t.closest('[data-ae-rank]');
      if (rankBtn) {
        e.stopPropagation();
        toggleRank(rankBtn.dataset.aeRank);
        return;
      }
      const sfxPlay = t.closest('[data-ae-sfx-play]');
      if (sfxPlay) {
        sfxPreview.src = mediaUrl(sfxPlay.dataset.aeSfxPlay);
        sfxPreview.play().catch(() => {});
        return;
      }
      const sfxRow = t.closest('[data-ae-sfx]');
      if (sfxRow && ae.pick) {
        const s = ae.media.sfx.find((x) => x.path === sfxRow.dataset.aeSfx);
        ae.pick.sfx = s ? { path: s.path, name: s.name } : null;
        sfxPreview.src = mediaUrl(sfxRow.dataset.aeSfx);
        sfxPreview.play().catch(() => {});
        renderPicker();
        return;
      }
      const endCard = t.closest('[data-ae-end]');
      if (endCard && ae.pick && ae.pick.mode === 'ending') {
        ae.pick.sel = endCard.dataset.aeEnd;
        renderEnding();
        return;
      }
      const tabBtn = t.closest('[data-ae-tab]');
      if (tabBtn) {
        ae.sideTab = tabBtn.dataset.aeTab;
        renderSide();
        return;
      }
      const modelBtn = t.closest('[data-ae-model]');
      if (modelBtn) {
        state.settings = await api.setSettings({ subtitleModel: modelBtn.dataset.aeModel });
        ae.words = {};
        renderSide();
        return;
      }
      const cueRow = t.closest('[data-ae-cue]');
      if (cueRow && !t.closest('textarea')) {
        const c = ae.cues[Number(cueRow.dataset.aeCue)];
        if (c) player.seek(c.start + 0.01);
        $$('.ae-cue').forEach((x) => x.classList.toggle('on', x === cueRow));
        return;
      }
      const prSet = t.closest('[data-ae-pr-set]');
      if (prSet && ae.pick && ae.pick.mode === 'preset') {
        ae.pick.preset[prSet.dataset.aePrSet] = prSet.dataset.v;
        prSet.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === prSet));
        drawPresetPreview();
        return;
      }
      const srcTab = t.closest('[data-ae-src]');
      if (srcTab && ae.pick) {
        ae.pick.src = srcTab.dataset.aeSrc;
        ae.pick.q = '';
        renderPicker();
        return;
      }
      const fileBtn = t.closest('[data-ae-file]');
      if (fileBtn && ae.pick) {
        pickFile(fileBtn.dataset.aeFile);
        return;
      }
      const modeBtn = t.closest('[data-ae-mode]');
      if (modeBtn) {
        rankMode = modeBtn.dataset.aeMode;
        const v = $('#ae-rank-video');
        viewerBar();
        if (v && v.paused) v.play().catch(() => {});
        return;
      }
      const card = t.closest('[data-ae-pick]');
      if (card && !act) {
        selectRush(card.dataset.aePick, true, 'cut');
        return;
      }
      if (!act) return;
      const a = act.dataset.aeAct;
      if (a === 'close') close();
      else if (a === 'open-dir') api.open(ae.dir);
      else if (a === 'rank-all') {
        // Les fins (OUTRO, FIN…) restent pour « Ajouter une fin ».
        for (const r of ae.media.rushes) if (!ae.ranks.includes(r.path) && !isEndingCandidate(r.path) && !(ae.ending && ae.ending.path === r.path)) ae.ranks.push(r.path);
        save();
        refreshCards();
        viewerBar();
      } else if (a === 'rank-clear') {
        ae.ranks = [];
        save();
        refreshCards();
        viewerBar();
      } else if (a === 'rank-next') rankNext();
      else if (a === 'to-edit') {
        const v = $('#ae-rank-video');
        if (v) v.pause();
        ae.step = 'edit';
        save();
        render();
      } else if (a === 'to-rank') {
        ae.step = 'rank';
        ae.selected = null;
        save();
        render();
      } else if (a === 'play') player.toggle();
      else if (a === 'back5') player.seek(player.t - 5);
      else if (a === 'unselect') {
        ae.selected = null;
        renderSide();
        drawTimeline();
      } else if (a === 'ov-del') deleteSelected();
      else if (a === 'ov-here') {
        const o = ae.overlays.find((x) => x.id === ae.selected);
        if (o) o.start = Math.round(player.t * 10) / 10;
        save();
        renderSide();
        drawTimeline();
      } else if (a === 'ov-edit') {
        const o = ae.overlays.find((x) => x.id === ae.selected);
        if (o) openPicker({ edit: o });
      } else if (a === 'sfx-play') {
        const o = ae.overlays.find((x) => x.id === ae.selected);
        if (o && o.sfx) playSfx(o.sfx.path);
      } else if (a === 'pick-close') closePicker();
      else if (a === 'pick-ok') pickOk();
      else if (a === 'pick-from-here') {
        const pv = $('#ae-pick-video');
        if (pv && ae.pick) {
          ae.pick.from = Math.round(pv.currentTime * 10) / 10;
          ae.pick.durTouched = false;
          renderPicker();
        }
      }
      else if (a === 'ending') openEnding();
      else if (a === 'subs-download') {
        ae.dl = 0;
        renderSide();
        const r = await api.subsDownload(subsModel());
        ae.dl = null;
        if (r.ok) {
          ae.subsInfo = r.status;
          startTranscribe();
        } else toast(r.error || 'Téléchargement impossible', 'err');
        renderSide();
      } else if (a === 'subs-retry') startTranscribe();
      else if (a === 'preset-edit') openPresetEditor(false);
      else if (a === 'preset-new') openPresetEditor(true);
      else if (a === 'preset-save') savePreset(false);
      else if (a === 'preset-del') savePreset(true);
      else if (a === 'end-all') {
        ae.pick.all = true;
        renderEnding();
      } else if (a === 'end-ok') endingOk();
      else if (a === 'ending-del') {
        ae.ending = null;
        if (ae.pick) closePicker();
        save();
        rebuild();
      }
      else if (a === 'sfx-dir') {
        const r = await api.autoeditSfxDir();
        if (r.ok) {
          const res = await api.autoeditOpen(ae.dir);
          if (res.ok) {
            ae.media.sfx = res.media.sfx;
            ae.sfxLibrary = res.sfxLibrary;
          }
          if (ae.pick) renderPicker();
        }
      } else if (a === 'validate') validate();
      else if (a === 'reveal') api.reveal(ae.result.file);
      else if (a === 'relaunch') {
        await api.autoeditLaunchPremiere(ae.result.project);
        ae.job.since = Date.now();
        ae.job.running = true;
        renderDone();
      } else if (a === 'pick-premiere') {
        const r = await api.autoeditPickPremiere();
        if (r.ok && (await api.autoeditLaunchPremiere(ae.result.project))) {
          ae.result.noPremiere = false;
          ae.job.since = Date.now();
          renderDone();
        }
      }
    });
    el.addEventListener('dblclick', (e) => {
      const row = e.target.closest('[data-ae-cue]');
      if (row && !e.target.closest('textarea')) editCue(Number(row.dataset.aeCue));
    });
    // Clic droit sur un rush : lecture du rush entier.
    el.addEventListener('contextmenu', (e) => {
      const card = e.target.closest('[data-ae-pick]');
      if (!card || ae.step !== 'rank') return;
      e.preventDefault();
      selectRush(card.dataset.aePick, true, 'full');
    });
    el.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.aePr && ae.pick && ae.pick.mode === 'preset') {
        const key = t.dataset.aePr;
        const P = ae.pick.preset;
        if (t.type === 'checkbox') P[key] = t.checked;
        else if (t.type === 'range' || t.type === 'number') P[key] = Number(t.value);
        else P[key] = t.value;
        const v = $(`[data-ae-prv="${key}"]`);
        if (v) v.textContent = v.textContent.replace(/^[\d.]+/, String(P[key]));
        drawPresetPreview();
        return;
      }
      if (t.dataset.aeOpt) {
        ae.opts[t.dataset.aeOpt] = Number(t.value);
        if (t.dataset.aeOpt === 'sensitivity') $('#ae-sens-label').textContent = sensLabel();
        else $('#ae-pause-label').textContent = fmtSec(ae.opts.minPause);
        clearTimeout(bind.cutTimer);
        bind.cutTimer = setTimeout(() => {
          rebuild();
          save();
        }, 120);
      } else if (t.dataset.aeZoom != null) {
        const sc = $('#ae-tl-scroll');
        const center = tOf(sc.scrollLeft + sc.clientWidth / 2);
        ae.zoom = Number(t.value);
        drawTimeline();
        sc.scrollLeft = xOf(center) - sc.clientWidth / 2;
      } else if (t.dataset.aeOv && ae.selected) {
        const o = ae.overlays.find((x) => x.id === ae.selected);
        const v = Number(t.value);
        if (o && Number.isFinite(v)) {
          if (t.dataset.aeOv === 'start') o.start = Math.max(0, Math.min(ae.seq.total - 0.1, v));
          else if (t.dataset.aeOv === 'from') o.from = Math.max(0, v);
          else o.duration = Math.max(0.5, v);
          showOverlay(player.t);
          save();
          drawTimeline();
        }
      } else if (t.dataset.aePickQ != null && ae.pick) {
        ae.pick.q = t.value;
        rerenderKeepingFocus(t);
      } else if (t.dataset.aeSfxQ != null && ae.pick) {
        ae.pick.sq = t.value;
        rerenderKeepingFocus(t);
      } else if (t.dataset.aePickDur != null && ae.pick) {
        ae.pick.duration = Number(t.value);
        ae.pick.durTouched = true;
      } else if (t.dataset.aePickFrom != null && ae.pick) {
        const p = ae.pick;
        p.from = Math.max(0, Number(t.value) || 0);
        const pv = $('#ae-pick-video');
        if (pv && pv.readyState >= 1) pv.currentTime = p.from;
        // Durée proposée : ce qui reste après le début choisi (5 s au plus).
        if (!p.durTouched && p.fileDuration) {
          p.duration = Math.max(0.5, Math.round(Math.min(5, p.fileDuration - p.from) * 10) / 10);
          const d = $('[data-ae-pick-dur]');
          if (d) d.value = p.duration;
        }
      }
      else if (t.dataset.aeEndDur != null && ae.pick) ae.pick.duration = Number(t.value);
    });
    el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.aePr && ae.pick && ae.pick.mode === 'preset' && t.type === 'checkbox') {
        ae.pick.preset[t.dataset.aePr] = t.checked;
        drawPresetPreview();
        return;
      }
      if (t.dataset.aeSubsOn != null) {
        ae.subs.enabled = t.checked;
        save();
        recomputeCues();
        drawSubs(true);
        startTranscribe();
        renderSide();
        return;
      }
      if (t.dataset.aeSubsLang != null) {
        ae.subs.language = t.value;
        ae.words = {};
        recomputeCues();
        drawSubs(true);
        save();
        startTranscribe();
        renderSide();
        return;
      }
      if (t.dataset.aePreset != null) {
        ae.subs.presetId = t.value;
        save();
        recomputeCues();
        drawSubs(true);
        renderSide();
        return;
      }
      if (t.dataset.aeSubsMode != null) {
        ae.subs.mode = t.value;
        save();
        return;
      }
      if (t.dataset.aeCut) {
        ae.cut[t.dataset.aeCut] = t.checked;
        save();
        rebuild();
      } else if (t.dataset.aePickAudio != null && ae.pick) {
        ae.pick.audio = t.checked;
      } else if (t.dataset.aeOvAudio != null && ae.selected) {
        const o = ae.overlays.find((x) => x.id === ae.selected);
        if (o) o.audio = t.checked;
        save();
        showOverlay(player.t);
      } else if (t.dataset.aeSfxOn != null && ae.pick) {
        ae.pick.sfxOn = t.checked;
        renderPicker();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (!ae.open) return;
      if (e.key === 'Escape') {
        if (ae.pick) closePicker();
        else if (ae.selected) {
          ae.selected = null;
          renderSide();
          drawTimeline();
        }
        e.preventDefault();
        return;
      }
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || ae.pick) return;
      if (ae.step === 'rank' && e.key === 'Enter') {
        e.preventDefault();
        rankNext();
      }
      if (ae.step !== 'edit') return;
      if (e.key === ' ') {
        e.preventDefault();
        player.toggle();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        player.seek(player.t + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (ae.selected) {
          e.preventDefault();
          deleteSelected();
        }
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        openPicker({ at: player.t });
      }
    });
  }

  function rerenderKeepingFocus(input) {
    const key = input.dataset.aePickQ != null ? 'data-ae-pick-q' : 'data-ae-sfx-q';
    const pos = input.selectionStart;
    renderPicker();
    const fresh = $(`[${key}]`);
    if (fresh) {
      fresh.focus();
      fresh.setSelectionRange(pos, pos);
    }
  }

  function deleteSelected() {
    ae.overlays = ae.overlays.filter((o) => o.id !== ae.selected);
    ae.selected = null;
    save();
    renderSide();
    drawTimeline();
    showOverlay(player.t);
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind();
    $('#ae-close').addEventListener('click', close);
  });
  if (document.readyState !== 'loading') {
    bind();
    $('#ae-close').addEventListener('click', close);
  }

  window.AutoEdit = { open, close, isOpen: () => ae.open, _state: ae };
})();
