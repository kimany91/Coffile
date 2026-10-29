'use strict';
// Onglet AUTOEDIT : un dossier de rushes du PC → projet créé et rangé → AUTOEDIT (bout à bout
// sans les blancs, fin, sous-titres) → il ne reste qu'à vérifier et valider pour Premiere.
(() => {
  const st = { info: null, loading: false, name: '', mode: 'copy', autoRank: true, autoEnding: true, subs: false, presetId: null, dragging: false };
  const root = () => $('#aeh');
  const presets = () => (state.settings && state.settings.subtitlePresets && state.settings.subtitlePresets.length ? state.settings.subtitlePresets : AutoEditCore.DEFAULT_PRESETS);

  async function load(dir) {
    if (!dir) return;
    st.loading = true;
    st.info = null;
    render();
    const info = await api.localInspect(dir);
    st.loading = false;
    if (!info.ok) {
      toast(info.error || 'Dossier illisible', 'err');
      render();
      return;
    }
    st.info = info;
    st.name = sanitizeName(info.name) || 'Montage';
    render();
  }

  const chip = (ic, n, one, many) => (n ? `<span class="chip">${icon(ic)}${plural(n, one, many)}</span>` : '');

  function dropZone() {
    return `<div class="aeh-drop ${st.dragging ? 'over' : ''}" data-aeh-drop>
      <div class="aeh-drop-ico">${st.loading ? '<span class="spinner"></span>' : icon('folderOpen')}</div>
      <b>${st.loading ? 'Lecture du dossier…' : 'Glisse un dossier de rushes ici'}</b>
      <span>ou</span>
      <button class="btn primary lg" data-aeh="pick">${icon('folder')}Choisir un dossier sur mon PC</button>
    </div>
    <div class="aeh-steps">
      <div><i>1</i><b>Projet créé et rangé</b><span>Vidéos et sons dans RUSHES, images dans IMAGES, ton modèle Premiere et tes bibliothèques copiés.</span></div>
      <div><i>2</i><b>Tu classes les rushes</b><span>Ordre de tournage déjà proposé. Clic gauche : le rush sans les blancs, clic droit : le rush entier.</span></div>
      <div><i>3</i><b>Bout à bout, puis Premiere</b><span>Blancs coupés, fin trouvée toute seule, sous-titres si tu veux. Tu valides : le montage se construit dans Premiere.</span></div>
    </div>`;
  }

  function form() {
    const i = st.info;
    const projRoot = state.settings.projectsRoot;
    const ps = presets();
    if (!st.presetId || !ps.some((p) => p.id === st.presetId)) st.presetId = ps[0].id;
    return `<div class="aeh-grid">
      <div class="card aeh-src">
        <div class="card-title">${icon('folder')}Dossier choisi</div>
        <div class="aeh-path" title="${esc(i.dir)}">${esc(i.dir)}</div>
        <div class="done-chips">${chip('film', i.videos, 'vidéo', 'vidéos')}${chip('image', i.images, 'image', 'images')}${chip('audio', i.audio, 'son', 'sons')}${chip('file', i.others, 'autre fichier', 'autres fichiers')}<span class="chip">${fmtBytes(i.bytes)}</span></div>
        ${i.sample.length ? `<div class="aeh-sample">${i.sample.map((x) => `<div>${icon('film')}<span>${esc(x)}</span></div>`).join('')}${i.videos > i.sample.length ? `<div class="aeh-more">et ${i.videos - i.sample.length} autres…</div>` : ''}</div>` : ''}
        ${i.videos ? '' : `<div class="ae-note err">${icon('alert')}<span>Aucune vidéo dans ce dossier : AUTOEDIT a besoin de rushes vidéo.</span></div>`}
        <button class="btn ghost sm" data-aeh="pick">${icon('refresh')}Changer de dossier</button>
      </div>
      <div class="card aeh-opts">
        <div class="card-title">${icon('wand')}Projet et montage</div>
        <div class="field"><label for="aeh-name">Nom du projet</label><div class="input-wrap"><input id="aeh-name" value="${esc(st.name)}" spellcheck="false" maxlength="120" /></div><div class="hint">${projRoot ? `Créé dans ${esc(projRoot)}` : '<span class="warn">Choisis d’abord le dossier des projets dans Réglages.</span>'}</div></div>
        <div class="field"><label>Fichiers</label>
          <label class="ae-radio"><input type="radio" name="aeh-mode" value="copy" ${st.mode === 'copy' ? 'checked' : ''} /><span><b>Copier</b><em>Le dossier d'origine reste intact.</em></span></label>
          <label class="ae-radio"><input type="radio" name="aeh-mode" value="move" ${st.mode === 'move' ? 'checked' : ''} /><span><b>Déplacer</b><em>Les fichiers vont dans le projet : pas de doublon sur le disque.</em></span></label>
        </div>
        <div class="field"><label>Tout seul</label>
          <label class="ae-check"><input type="checkbox" data-aeh-opt="autoRank" ${st.autoRank ? 'checked' : ''} /><span>${icon('list')}Proposer l'ordre de tournage (tu le vérifies et le changes à l'étape Classer)</span></label>
          <label class="ae-check"><input type="checkbox" data-aeh-opt="autoEnding" ${st.autoEnding ? 'checked' : ''} /><span>${icon('flag')}Mettre la fin trouvée (OUTRO, FIN, END CARD…)</span></label>
          <label class="ae-check"><input type="checkbox" data-aeh-opt="subs" ${st.subs ? 'checked' : ''} /><span>${icon('type')}Sous-titres automatiques</span></label>
          ${st.subs ? `<div class="ae-inline aeh-preset">Preset <select data-aeh-preset>${ps.map((p) => `<option value="${esc(p.id)}" ${p.id === st.presetId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>` : ''}
        </div>
        <button class="btn primary xl" data-aeh="go" ${i.videos && projRoot && !state.jobRunning ? '' : 'disabled'}>${icon('wand')}Lancer AUTOEDIT</button>
        ${state.jobRunning ? '<div class="hint">Un projet est déjà en cours de création.</div>' : ''}
      </div>
    </div>`;
  }

  function render() {
    const el = root();
    if (!el) return;
    el.innerHTML = st.info && !st.loading ? form() : dropZone();
  }

  async function go() {
    const i = st.info;
    if (!i || state.jobRunning) return;
    const base = sanitizeName(st.name) || 'Montage';
    let name = base;
    for (let n = 2; await api.projectExists(name); n++) name = `${base}_${n}`;
    const local = { name, dir: i.dir, mode: st.mode, autoOpts: { autoRank: st.autoRank, autoEnding: st.autoEnding, subs: st.subs, presetId: st.presetId } };
    st.info = null;
    render();
    createProject(false, local);
  }

  function bind() {
    const el = root();
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-aeh]');
      if (!b) return;
      if (b.dataset.aeh === 'pick') load(await api.pickFolder({ title: 'Dossier de rushes' }));
      else if (b.dataset.aeh === 'go') go();
    });
    el.addEventListener('input', (e) => {
      if (e.target.id === 'aeh-name') st.name = e.target.value;
    });
    el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.name === 'aeh-mode') st.mode = t.value;
      else if (t.dataset.aehOpt) {
        st[t.dataset.aehOpt] = t.checked;
        if (t.dataset.aehOpt === 'subs') render();
      } else if (t.dataset.aehPreset != null) st.presetId = t.value;
    });
    // Glisser-déposer d'un dossier.
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!st.dragging && !st.info) {
        st.dragging = true;
        render();
      }
    });
    el.addEventListener('dragleave', (e) => {
      if (e.target.closest('[data-aeh-drop]') && !e.relatedTarget) {
        st.dragging = false;
        render();
      }
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      st.dragging = false;
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      const p = f ? api.pathForFile(f) : '';
      if (p) load(p);
      else render();
    });
  }

  window.AutoEditHome = {
    render() {
      bind();
      render();
    },
    load
  };
})();
