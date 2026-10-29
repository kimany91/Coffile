'use strict';
const api = window.filedit;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const SLOTS = [
  { key: 'musique', label: 'MUSIQUE', icon: 'music', cls: 'c-musique' },
  { key: 'sfx', label: 'SOUND EFFECT', icon: 'audio', cls: 'c-sfx' },
  { key: 'template', label: 'TEMPLATE', icon: 'layers', cls: 'c-template' }
];
const CAT = {
  video: { icon: 'film', cls: 'c-rushes', label: 'Vidéo' },
  audio: { icon: 'audio', cls: 'c-musique', label: 'Audio' },
  image: { icon: 'image', cls: 'c-images', label: 'Image' },
  other: { icon: 'file', cls: 'c-other', label: 'Fichier' },
  unknown: { icon: 'file', cls: 'c-other', label: 'Fichier' }
};
const STEPS = [
  { key: 'structure', label: 'Structure', icon: 'folder' },
  { key: 'scan', label: 'Analyse Drive', icon: 'drive' },
  { key: 'download', label: 'Téléchargement', icon: 'arrow' },
  { key: 'links', label: 'Bibliothèques', icon: 'link' },
  { key: 'premiere', label: 'Premiere Pro', icon: 'clapper' }
];

// Projet fait depuis un dossier du PC (onglet AUTOEDIT) : les étapes Drive deviennent lecture et copie.
const stepLabel = (def, s) =>
  s && s.source === 'local' ? { scan: 'Lecture du dossier', download: s.localMode === 'move' ? 'Déplacement des fichiers' : 'Copie des fichiers' }[def.key] || def.label : def.label;

const state = {
  settings: null,
  aeFor: new Set(), // fiches de montage où la case AUTOEDIT est cochée
  inspect: null, // { loading } | résultat de drive:inspect
  nameExists: false,
  job: null,
  jobRunning: false,
  fileFilter: 'all',
  view: 'new',
  library: null,
  libLoading: false,
  libSort: 'modified',
  update: null,
  account: '', // compte Google choisi pour le projet ('' = automatique)
  connecting: false,
  chromeProfiles: null,
  exports: null,
  expLoading: false,
  expGroup: 'version',
  expAspect: 'all',
  expExt: 'all',
  expSelected: null,
  expView: 'grid',
  newMeta: {}, // icône / couleur choisies pour le prochain projet
  pendingSource: null // mail / message Chat à l'origine du projet en cours
};

// ---------- Utilitaires ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function sanitizeName(name) {
  let s = String(name || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s)) s = `_${s}`;
  return s.slice(0, 180);
}
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
function fmtBytes(n) {
  if (n == null || isNaN(n)) return '—';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i === 0 ? Math.round(n) : nf1.format(n)} ${u[i]}`;
}
function fmtEta(sec) {
  if (!isFinite(sec) || sec <= 0) return '—';
  if (sec < 60) return `${Math.ceil(sec)} s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min ${String(Math.round(sec % 60)).padStart(2, '0')}`;
  return `${Math.floor(sec / 3600)} h ${String(Math.round((sec % 3600) / 60)).padStart(2, '0')}`;
}
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function relTime(ms) {
  const diff = (Date.now() - ms) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 172800) return 'hier';
  if (diff < 30 * 86400) return `il y a ${Math.floor(diff / 86400)} j`;
  return new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
function plural(n, one, many) {
  return `${n} ${n > 1 ? many : one}`;
}
function sep() {
  return state.settings && state.settings.platform === 'win32' ? '\\' : '/';
}
function joinPath(a, b) {
  if (!a) return b;
  return a.replace(/[\\/]+$/, '') + sep() + b;
}
function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
function hydrateIcons(root = document) {
  $$('[data-icon]', root).forEach((el) => {
    if (!el.firstElementChild) el.innerHTML = icon(el.dataset.icon);
  });
}
// Ne touche au DOM que si le contenu change (évite de relancer les animations).
function setHTML(el, html) {
  if (el._html !== html) {
    el._html = html;
    el.innerHTML = html;
  }
}
function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'err' ? 'alert' : 'check')}<div>${esc(msg)}</div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, 3800);
}

// ---------- Navigation ----------
function showView(view) {
  state.view = view;
  let section = view;
  if (view === 'new' && state.job) section = 'progress';
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${section}`));
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'projects') loadLibrary();
  if (view === 'exports') loadExports();
  if (view === 'inbox') loadInbox();
  if (view === 'settings') renderSettings();
  if (view === 'notes' && window.Notes) Notes.open();
  if (view === 'autoedit' && window.AutoEditHome) AutoEditHome.render();
  if (view !== 'notes') document.body.classList.remove('notes-focus');
  $('.content').scrollTop = 0;
}

// ---------- Réglages partagés ----------
async function updateSettings(patch) {
  state.settings = await api.setSettings(patch);
  renderAllSettingsDependent();
}

function renderAllSettingsDependent() {
  const s = state.settings;
  $('#root-path').textContent = s.projectsRoot || 'Non défini';
  renderUpdate();
  $('#about-version').textContent = `v${s.version}`;
  $('#recent-count').textContent = state.library ? state.library.length : '';
  renderAccountPick();
  renderNewBadge();
  renderSidePins();
  updateInboxBadge();
  if (state.view === 'inbox') renderInboxBar();
  renderSlots($('#slots-new'));
  renderSlots($('#slots-settings'));
  renderTree();
  renderNameHint();
  if (state.view === 'settings') renderSettings();
}

function renderSlots(container) {
  const links = state.settings.links || {};
  container.innerHTML = SLOTS.map((slot) => {
    const p = links[slot.key];
    return `
      <div class="slot ${slot.cls} ${p ? 'linked' : ''}" data-key="${slot.key}">
        <div class="slot-top">
          <div class="slot-ico">${icon(slot.icon)}</div>
          <div>
            <div class="slot-name">${slot.label}</div>
            <div class="slot-state">${p ? 'Lié à un dossier' : 'Vide par défaut'}</div>
          </div>
        </div>
        <div class="slot-path" title="${esc(p || '')}">${p ? esc(p) : '&nbsp;'}</div>
        <div class="slot-actions">
          <button class="btn sm" data-act="link">${icon(p ? 'refresh' : 'link')}${p ? 'Changer' : 'Lier un dossier'}</button>
          ${p ? `<button class="btn sm ghost icon-only danger" data-act="unlink" title="Délier">${icon('x')}</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

async function onSlotClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const key = btn.closest('.slot').dataset.key;
  const slot = SLOTS.find((s) => s.key === key);
  if (btn.dataset.act === 'unlink') {
    await updateSettings({ links: { [key]: '' } });
    toast(`${slot.label} : dossier délié`);
    return;
  }
  const dir = await api.pickFolder({ title: `Dossier à copier dans ${slot.label}`, defaultPath: state.settings.links[key] || undefined });
  if (dir) {
    await updateSettings({ links: { [key]: dir } });
    toast(`${slot.label} lié à ${dir}`);
  }
}

// ---------- Nouveau projet ----------
const driveInput = $('#drive-url');
const nameInput = $('#project-name');

function renderDriveStatus() {
  const el = $('#drive-status');
  const r = state.inspect;
  el.classList.remove('err');
  if (!driveInput.value.trim()) {
    el.innerHTML = `<span class="muted">Optionnel : sans lien, Coffile crée seulement la structure du projet.</span>`;
    return;
  }
  if (!r || r.loading) {
    el.innerHTML = `<span class="spinner"></span>Analyse du lien Drive…`;
    return;
  }
  if (!r.ok) {
    el.classList.add('err');
    el.innerHTML = `${icon('alert')}<span>${esc(r.error)}</span>`;
    return;
  }
  if (r.mode === 'browser') {
    if (r.reason === 'setting') {
      el.innerHTML = `<span class="chip lock">${icon('globe')}Import via Chrome</span><span>Réglage « Toujours via Chrome » actif.</span>`;
    } else if (!r.hasAccounts) {
      el.innerHTML = `<span class="chip lock">${icon('key')}Drive privé</span><span>Connecte-toi à Google pour le télécharger automatiquement.</span><button class="btn sm" ${viaChromeMode() ? 'data-chrome-login=""' : 'id="ds-connect"'}>${icon('user')}Connecter</button>`;
    } else {
      el.innerHTML = `<span class="chip lock">${icon('key')}Drive privé</span><span>Aucun compte connecté n'y a accès : Coffile l'ouvrira dans Chrome.</span>`;
    }
    return;
  }
  const chips = [
    r.mode === 'account'
      ? `<span class="chip ok">${icon('check')}Accès via ${esc(accLabel(r.account))}${/^chrome:/.test(r.account) ? ' (Chrome)' : ''}</span>`
      : `<span class="chip ok">${icon('check')}${r.kind === 'folder' ? 'Dossier' : 'Fichier'} public accessible</span>`
  ];
  if (r.videos) chips.push(`<span class="chip c-rushes">${icon('film')}${plural(r.videos, 'vidéo', 'vidéos')}</span>`);
  if (r.images) chips.push(`<span class="chip">${icon('image')}${plural(r.images, 'image', 'images')}</span>`);
  if (r.audio) chips.push(`<span class="chip">${icon('audio')}${r.audio} audio</span>`);
  if (r.others) chips.push(`<span class="chip">${icon('file')}${plural(r.others, 'autre', 'autres')}</span>`);
  if (r.bytes) chips.push(`<span class="chip">${fmtBytes(r.bytes)}</span>`);
  if (!r.total) chips.push(`<span class="chip">Dossier vide</span>`);
  el.innerHTML = chips.join('');
}

const runInspect = debounce(async () => {
  const url = driveInput.value.trim();
  if (!url) {
    state.inspect = null;
    renderDriveStatus();
    renderTree();
    return;
  }
  state.inspect = { loading: true };
  renderDriveStatus();
  const res = await api.inspect(url, state.account);
  if (driveInput.value.trim() !== url || res.aborted) return;
  state.inspect = res;
  // Propose le nom du dossier Drive si le champ est vide.
  if (res.ok && res.title && !nameInput.value.trim()) {
    nameInput.value = sanitizeName(res.title);
    onNameChange();
  }
  renderDriveStatus();
  renderTree();
  updateCreateBtn();
}, 550);

const checkNameExists = debounce(async () => {
  const name = sanitizeName(nameInput.value);
  state.nameExists = name ? await api.projectExists(name) : false;
  renderNameHint();
  updateCreateBtn();
}, 250);

function onNameChange() {
  renderNewBadge();
  renderNameHint();
  renderTree();
  updateCreateBtn();
  checkNameExists();
}

function renderNameHint() {
  const hint = $('#name-hint');
  const name = sanitizeName(nameInput.value);
  hint.classList.remove('warn');
  if (!name) {
    hint.innerHTML = '';
    return;
  }
  if (state.nameExists) {
    hint.classList.add('warn');
    hint.innerHTML = `${icon('alert')}Un projet « ${esc(name)} » existe déjà dans ce dossier.`;
    return;
  }
  hint.innerHTML = `${icon('folder')}<span class="mono">${esc(joinPath(state.settings.projectsRoot, name))}</span>`;
}

function updateCreateBtn() {
  const name = sanitizeName(nameInput.value);
  const r = state.inspect;
  const driveOk = !driveInput.value.trim() || (r && r.ok);
  if (state.newMode === 'add') {
    // Ajout : il faut un projet choisi et un lien Drive.
    $('#create-btn').disabled = !state.addTo || !driveInput.value.trim() || !driveOk || state.jobRunning;
    return;
  }
  $('#create-btn').disabled = !name || state.nameExists || !driveOk || state.jobRunning || !state.settings.projectsRoot;
}

// ----- Nouveau projet ou ajout à un projet existant -----
function setNewMode(mode) {
  state.newMode = mode;
  const add = mode === 'add';
  $$('#new-mode button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('#addto-field').classList.toggle('hidden', !add);
  $$('.name-field, .slots-field').forEach((el) => el.classList.toggle('hidden', add));
  $('#create-label').textContent = add ? 'Ajouter au projet' : 'Créer le projet';
  renderAddTo();
  renderTree();
  updateCreateBtn();
}

function renderAddTo() {
  const p = state.addTo;
  $('#addto-pick').innerHTML = p
    ? `${badge(metaFor(p.dir, p.name))}<span class="ap-text"><b>${esc(p.name)}</b><span class="mono">${esc(p.dir)}</span></span><span class="ap-change">Changer</span>`
    : `<span class="ap-empty">${icon('folderOpen')}Choisir un projet parmi tes projets…</span>`;
}

// Fenêtre de choix d'un projet (avec recherche).
const pp = { all: [], shown: [], index: 0, cb: null };

async function openProjectPicker(title, cb) {
  Object.assign(pp, { all: [], shown: [], index: 0, cb });
  $('#pp-title').textContent = title || 'Choisir un projet';
  $('#pp-search').value = '';
  $('#pp-list').innerHTML = '<div class="list-loading"><span class="spinner"></span>Chargement de tes projets…</div>';
  $('#proj-pick').classList.remove('hidden');
  setTimeout(() => $('#pp-search').focus(), 30);
  if (!state.library) state.library = await api.scanLibrary();
  pp.all = (state.library || []).slice().sort((a, b) => (b.modified || 0) - (a.modified || 0));
  renderProjectPicker();
}

function renderProjectPicker() {
  const words = $('#pp-search').value.toLowerCase().split(/\s+/).filter(Boolean);
  pp.shown = pp.all.filter((p) => words.every((w) => p.name.toLowerCase().includes(w)));
  pp.index = Math.min(pp.index, Math.max(0, pp.shown.length - 1));
  $('#pp-list').innerHTML = pp.shown.length
    ? pp.shown
        .map((p, i) => {
          const t = p.totals || {};
          const bits = [t.video && t.video.count ? plural(t.video.count, 'vidéo', 'vidéos') : '', t.image && t.image.count ? plural(t.image.count, 'image', 'images') : '', p.bytes ? fmtBytes(p.bytes) : ''].filter(Boolean);
          return `<button class="np-item ${i === pp.index ? 'active' : ''}" data-pp="${i}">
            ${badge(metaFor(p.dir, p.name))}
            <span class="np-text"><b>${esc(p.name)}</b><span>${esc(bits.join(' · ') || 'Projet vide')}</span></span>
            <span class="np-date">${p.modified ? shortDate(p.modified) : ''}</span>
          </button>`;
        })
        .join('')
    : `<div class="empty">${pp.all.length ? 'Aucun projet trouvé.' : 'Aucun projet dans ton dossier des projets.'}</div>`;
}

function closeProjectPicker() {
  $('#proj-pick').classList.add('hidden');
  pp.cb = null;
}

function chooseProject(i) {
  const p = pp.shown[i];
  const cb = pp.cb;
  if (!p || !cb) return;
  closeProjectPicker();
  cb({ dir: p.dir, name: p.name });
}

function renderTree() {
  if (state.newMode === 'add') return renderAddTree();
  const s = state.settings;
  const name = sanitizeName(nameInput.value) || 'NOM_DU_PROJET';
  const r = state.inspect && state.inspect.ok && state.inspect.mode !== 'browser' ? state.inspect : null;
  const linkMeta = (key) => (s.links[key] ? { text: `Copié depuis ${s.links[key].split(/[\\/]/).filter(Boolean).pop()}`, on: true } : { text: 'Vide' });
  const rows = [
    { label: 'RUSHES', icon: 'film', cls: 'c-rushes', meta: r ? { text: r.videos + r.audio ? plural(r.videos + r.audio, 'fichier', 'fichiers') + ' du Drive' : 'Aucune vidéo', on: !!(r.videos + r.audio) } : { text: 'Vidéos du Drive' } },
    { label: 'IMAGES', icon: 'image', cls: 'c-images', meta: r ? { text: r.images ? plural(r.images, 'image', 'images') : 'Aucune image', on: !!r.images } : { text: 'Images du Drive' } },
    { label: 'MONTAGE', icon: 'clapper', cls: 'c-montage', meta: s.premiereTemplate ? { text: '1 projet Premiere', on: true } : { text: 'Modèle Premiere manquant', warn: true }, sub: s.premiereTemplate ? `${name}.prproj` : null },
    { label: 'MUSIQUE', icon: 'music', cls: 'c-musique', meta: linkMeta('musique') },
    { label: 'SOUND EFFECT', icon: 'audio', cls: 'c-sfx', meta: linkMeta('sfx') },
    { label: 'TEMPLATE', icon: 'layers', cls: 'c-template', meta: linkMeta('template') }
  ];
  if (r && r.others) rows.push({ label: 'AUTRES', icon: 'file', cls: 'c-other', meta: { text: plural(r.others, 'fichier', 'fichiers'), on: true } });
  $('#tree').innerHTML = `
    <div class="tree-root">${badge({ ...metaFor('', name), ...state.newMeta }, 'sm')}<span class="tree-name">${esc(name)}</span></div>
    <div class="tree-children">
      ${rows
        .map(
          (row) => `
        <div class="tree-row ${row.cls}">
          <div class="tree-ico">${icon(row.icon)}</div>
          <span class="tree-label">${row.label}</span>
          <span class="tree-meta ${row.meta.on ? 'on' : ''} ${row.meta.warn ? 'warn' : ''}" title="${esc(row.meta.text)}">${esc(row.meta.text)}</span>
        </div>
        ${row.sub ? `<div class="tree-sub">${icon('file')}${esc(row.sub)}</div>` : ''}`
        )
        .join('')}
    </div>`;

  const ps = $('#premiere-status');
  if (s.premiereTemplate) {
    ps.className = 'premiere-status';
    ps.innerHTML = `<div class="pr-logo">Pr</div><div class="ps-text"><b>Projet Premiere Pro prêt</b>Modèle : ${esc(s.premiereTemplate.split(/[\\/]/).pop())}</div>`;
  } else {
    ps.className = 'premiere-status missing';
    ps.innerHTML = `<div class="pr-logo">Pr</div><div class="ps-text"><b>Ajoute ton modèle Premiere</b>Pour générer automatiquement le fichier .prproj.</div><button class="btn sm" id="ps-config">Configurer</button>`;
    $('#ps-config').onclick = () => showView('settings');
  }
}

// local : { name, dir, mode, autoOpts } pour un dossier du PC (onglet AUTOEDIT).
async function createProject(fromMessage, local = null) {
  if (local ? state.jobRunning : $('#create-btn').disabled) return;
  // AUTOEDIT coché : s'ouvre quand tout est téléchargé (la case se décoche pour le projet suivant).
  const autoEdit = local ? true : $('#ae-check').checked;
  if (!local) $('#ae-check').checked = false;
  const addTo = !local && state.newMode === 'add' && state.addTo ? state.addTo : null;
  const name = local ? local.name : addTo ? addTo.name : sanitizeName(nameInput.value);
  state.jobRunning = true;
  state.fileFilter = 'all';
  $$('#file-filter button').forEach((b) => b.classList.toggle('active', b.dataset.f === 'all'));
  state.job = {
    name,
    dir: addTo ? addTo.dir : joinPath(state.settings.projectsRoot, name),
    addTo: !!addTo,
    source: local ? 'local' : 'drive',
    localMode: local ? local.mode : null,
    status: 'running',
    steps: Object.fromEntries(STEPS.map((s) => [s.key, { status: 'pending' }])),
    files: [],
    bytesDone: 0,
    bytesTotal: 0,
    speed: 0,
    warnings: []
  };
  fileRows.clear();
  $('#file-list').innerHTML = '';
  updateCreateBtn();
  renderProgress();
  showView('new');
  // Le jeu en plein écran pendant que le projet se crée (fermé tout seul à la fin).
  if (state.settings.dinoDuringJob !== false) openDino(true);
  const source = local ? null : state.pendingSource;
  const sources = fromMessage ? state.pendingSources : null;
  state.pendingSource = null;
  state.pendingSources = null;
  const res = await api.createProject(
    local
      ? { name, driveUrl: '', localDir: local.dir, localMode: local.mode }
      : { name, driveUrl: driveInput.value.trim(), sources, account: state.account, source, addTo: addTo ? addTo.dir : null }
  );
  state.jobRunning = false;
  if (!res.ok && !res.state) {
    toast(res.error || 'Erreur inattendue', 'err');
    state.job = null;
    showView('new');
    updateCreateBtn();
    return;
  }
  state.job = res.state;
  renderProgress();
  if (res.state.status === 'done' && (state.newMeta.color || state.newMeta.icon)) await api.setProjectMeta(res.state.dir, state.newMeta);
  state.newMeta = {};
  state.settings = await api.getSettings();
  renderAllSettingsDependent();
  if (res.state.status === 'done') toast(res.state.addTo ? `Fichiers ajoutés à « ${res.state.name} » !` : `Projet « ${res.state.name} » prêt !`);
  if (res.state.status === 'done' && res.state.addTo) state.library = null;
  // Projet créé depuis un message : Coffile apprend que ce genre de message est un montage.
  if (res.state.status === 'done' && source && source.id) {
    const msg = findMessage(source.kind, source.id);
    if (msg) api.inboxLearn(learnPayload(source.kind, msg), true);
  }
  else if (res.state.status === 'error') toast(res.state.error, 'err');
  if (res.state.status === 'done' && autoEdit) AutoEdit.open(res.state.dir, res.state.name, local ? local.autoOpts : null);
}

// Aperçu pour un ajout : seuls RUSHES et IMAGES reçoivent les fichiers.
function renderAddTree() {
  const p = state.addTo;
  const r = state.inspect && state.inspect.ok && state.inspect.mode !== 'browser' ? state.inspect : null;
  const name = p ? p.name : 'PROJET_EXISTANT';
  const rows = [
    { label: 'RUSHES', icon: 'film', cls: 'c-rushes', meta: r ? { text: `+ ${plural(r.videos + r.audio, 'fichier', 'fichiers')} du Drive`, on: !!(r.videos + r.audio) } : { text: '+ vidéos du Drive', on: true } },
    { label: 'IMAGES', icon: 'image', cls: 'c-images', meta: r ? { text: `+ ${plural(r.images, 'image', 'images')}`, on: !!r.images } : { text: '+ images du Drive', on: true } },
    { label: 'MONTAGE', icon: 'clapper', cls: 'c-montage', meta: { text: 'Inchangé' } },
    { label: 'MUSIQUE, SOUND EFFECT, TEMPLATE', icon: 'music', cls: 'c-musique', meta: { text: 'Inchangés' } }
  ];
  $('#tree').innerHTML = `
    <div class="tree-root">${badge(metaFor(p ? p.dir : '', name), 'sm')}<span class="tree-name">${esc(name)}</span></div>
    <div class="tree-children">${rows
      .map((row) => `<div class="tree-row ${row.cls}"><div class="tree-ico">${icon(row.icon)}</div><span class="tree-label">${row.label}</span><span class="tree-meta ${row.meta.on ? 'on' : ''}">${esc(row.meta.text)}</span></div>`)
      .join('')}</div>`;
  const ps = $('#premiere-status');
  ps.className = 'premiere-status';
  ps.innerHTML = `${icon('check')}<span>Les fichiers déjà présents dans le projet (même nom, même taille) ne sont pas retéléchargés.</span>`;
}

function resetNewProject() {
  state.job = null;
  state.inspect = null;
  state.nameExists = false;
  driveInput.value = '';
  nameInput.value = '';
  renderDriveStatus();
  renderNameHint();
  renderTree();
  updateCreateBtn();
  showView('new');
  driveInput.focus();
}

// ---------- Progression ----------
const fileRows = new Map();

function stepWeights(s) {
  const w = { structure: 3, scan: 7, download: 80, links: 7, premiere: 3 };
  let total = 0;
  for (const k of Object.keys(w)) {
    if (s.steps[k] && s.steps[k].status === 'skipped') w[k] = 0;
    total += w[k];
  }
  return { w, total: total || 1 };
}

function downloadFraction(s) {
  const files = s.files;
  if (!files.length) return 0;
  if (files.every((f) => f.size) && s.bytesTotal > 0) return Math.min(1, s.bytesDone / s.bytesTotal);
  let acc = 0;
  for (const f of files) {
    if (f.status === 'done' || f.status === 'error') acc += 1;
    else if (f.status === 'active') acc += f.size ? Math.min(1, f.received / f.size) : 0.3;
  }
  return acc / files.length;
}

function computePercent(s) {
  if (s.status === 'done') return 100;
  const { w, total } = stepWeights(s);
  let acc = 0;
  for (const k of Object.keys(w)) {
    const st = s.steps[k] || {};
    if (st.status === 'done' || st.status === 'error') acc += w[k];
    else if (st.status === 'active') {
      if (k === 'download') acc += w[k] * downloadFraction(s);
      else if (k === 'links' && st.total) acc += w[k] * (st.done / st.total);
      else acc += w[k] * 0.3;
    }
  }
  return Math.min(99, Math.floor((acc / total) * 100));
}

function stepSub(key, st, s) {
  switch (st.status) {
    case 'skipped':
      if (key === 'scan' && st.reason) return st.reason === 'private' ? 'Drive privé' : 'Via navigateur';
      if (st.reason === 'add') return 'Projet existant : inchangé';
      return key === 'premiere' ? 'Modèle manquant' : key === 'links' ? 'Aucun dossier lié' : 'Ignoré';
    case 'error':
      return 'Erreur';
    case 'pending':
      return 'En attente';
    case 'done':
      if (key === 'scan') return plural(st.found || 0, 'fichier trouvé', 'fichiers trouvés') + (s.account ? ` · ${s.account.split('@')[0]}` : '');
      if (key === 'download') return plural(s.files.filter((f) => f.status === 'done').length, 'fichier', 'fichiers');
      if (key === 'links') return plural(st.total || 0, 'fichier copié', 'fichiers copiés');
      if (key === 'premiere') return 'Projet créé';
      if (key === 'structure' && st.existing) return 'Projet existant';
      return 'Terminé';
    default:
      if (key === 'scan') return st.found ? `${st.found} fichiers…` : st.account ? `Via ${st.account}` : 'Lecture du dossier…';
      if (key === 'download' && s.mode === 'browser') return `Via navigateur · ${s.browser ? s.browser.imported : 0} importés`;
      if (key === 'download') return `${s.files.filter((f) => f.status === 'done').length}/${s.files.length}`;
      if (key === 'links') return `${st.done || 0}/${st.total || 0}`;
      return 'En cours…';
  }
}

let dinoIconUrl = '';
const dinoIcon = () => dinoIconUrl || (dinoIconUrl = window.Dino ? Dino.icon() : '');

function renderProgress() {
  const s = state.job;
  if (!s) return;
  const running = s.status === 'running';
  const pct = computePercent(s);

  $('#pg-eyebrow').textContent = running ? (s.addTo ? 'Ajout au projet en cours' : 'Création en cours') : s.status === 'done' ? (s.addTo ? 'Fichiers ajoutés' : 'Projet prêt') : s.status === 'cancelled' ? 'Annulé' : 'Erreur';
  $('#pg-name').textContent = s.name;
  setHTML($('#pg-path'), `${icon('folder')}${esc(s.dir)}`);
  setHTML($('#pg-actions'), running
    ? `<button class="btn" id="dino-job-btn"><img class="dino-ico" src="${dinoIcon()}" alt="" />Jouer en plein écran</button><button class="btn danger" id="cancel-btn">${icon('stop')}Annuler</button>`
    : `<button class="btn" id="again-btn">${icon('plus')}Nouveau projet</button>`);
  if (state.dinoJob) {
    // Projet fini (ou import manuel dans le navigateur) : on rend la main.
    const manual = running && s.mode === 'browser' && s.steps.download && s.steps.download.status === 'active';
    if (!running || manual) {
      closeDino();
      showView('new');
    } else renderDinoJob();
  }

  $('#pg-percent').textContent = pct;
  const bar = $('#pg-bar');
  bar.style.width = `${pct}%`;
  bar.classList.toggle('ok', s.status === 'done');
  bar.classList.toggle('static', !running);
  bar.classList.toggle('indet', running && s.steps.scan && s.steps.scan.status === 'active');

  const sizesKnown = s.files.length && s.files.every((f) => f.size);
  $('#st-bytes').textContent = s.bytesTotal && sizesKnown ? `${fmtBytes(s.bytesDone)} / ${fmtBytes(s.bytesTotal)}` : fmtBytes(s.bytesDone || 0);
  $('#st-speed').textContent = running && s.speed > 1024 ? `${fmtBytes(s.speed)}/s` : '—';
  $('#st-eta').textContent = running && sizesKnown && s.speed > 1024 ? fmtEta((s.bytesTotal - s.bytesDone) / s.speed) : '—';
  $('#st-files').textContent = s.files.length ? `${s.files.filter((f) => f.status === 'done').length} / ${s.files.length}` : '—';

  setHTML($('#steps'), STEPS.map((def) => {
    const st = s.steps[def.key] || { status: 'pending' };
    const dot = st.status === 'active' ? '<span class="spinner"></span>' : st.status === 'done' ? icon('check') : st.status === 'error' ? icon('x') : icon(def.icon);
    return `<div class="step ${st.status}"><div class="step-dot">${dot}</div><div class="step-text"><div class="step-name">${stepLabel(def, s)}</div><div class="step-sub">${esc(stepSub(def.key, st, s))}</div></div></div>`;
  }).join(''));

  const browserWaiting = running && s.mode === 'browser' && s.steps.download && s.steps.download.status === 'active';
  $('#hero-progress').classList.toggle('hidden', browserWaiting);
  renderBrowserCard(s, browserWaiting);

  // Sidebar
  $('#sidebar-job').classList.toggle('hidden', !running);
  $('#sj-name').textContent = s.name;
  $('#sj-bar').style.width = `${pct}%`;

  renderDoneCard(s);
  renderFiles(s);
  setHTML($('#warnings'), (s.warnings || []).map((w) => `<div class="warning">${icon('alert')}<span>${esc(w)}</span></div>`).join(''));
}

function renderBrowserCard(s, show) {
  const card = $('#browser-card');
  card.classList.toggle('hidden', !show);
  if (!show) return;
  const b = s.browser || {};
  const where = b.opener === 'Chrome' ? 'Chrome' : 'ton navigateur';
  let status;
  if (b.current) {
    const pct = b.current.total ? Math.floor((b.current.done / b.current.total) * 100) : 0;
    status = `<div class="bc-status active"><span class="spinner"></span><div class="bc-st-text"><b>Extraction et rangement de ${esc(b.current.name)}</b><span>${fmtBytes(b.current.done)} / ${fmtBytes(b.current.total)} · ${b.imported} fichiers rangés</span><div class="bar small"><div class="bar-fill" style="width:${pct}%"></div></div></div></div>`;
  } else if (b.partials && b.partials.length) {
    const p = b.partials[0];
    status = `<div class="bc-status active"><span class="spinner"></span><div class="bc-st-text"><b>Téléchargement en cours dans ${where}…</b><span>${esc(p.name || 'Fichier')} · ${fmtBytes(p.size)}${b.partials.length > 1 ? ` · +${b.partials.length - 1} autre(s)` : ''}</span></div></div>`;
  } else if (b.imported) {
    status = `<div class="bc-status ok">${icon('check')}<div class="bc-st-text"><b>${plural(b.imported, 'fichier rangé', 'fichiers rangés')}</b><span>Si Google a découpé le dossier en plusieurs .zip, attends qu'ils soient tous téléchargés, puis clique sur « Terminer l'import ».</span></div></div>`;
  } else {
    status = `<div class="bc-status"><span class="pulse"></span><div class="bc-st-text"><b>En attente du téléchargement…</b><span>Surveillance de ${esc(b.downloadsDir || 'Téléchargements')}</span></div></div>`;
  }
  setHTML(
    card,
    `<div class="bc-head">
      <div class="bc-ico">${icon('chrome')}</div>
      <div><h2>Télécharge le dossier depuis ${where}</h2><p>Ton Drive est privé : il vient de s'ouvrir dans ${where}, connecté à ton compte Google. Coffile s'occupe du reste.</p></div>
    </div>
    <ol class="bc-steps">
      <li><span>1</span><div>En haut de la page Drive, clique sur le <b>nom du dossier ▾</b> puis sur <b>Télécharger</b>.</div></li>
      <li><span>2</span><div>Google prépare un ou plusieurs <b>.zip</b>. Pour un gros dossier, ça peut prendre quelques minutes.</div></li>
      <li><span>3</span><div>Coffile détecte le téléchargement, l'extrait et range tout dans <b>RUSHES</b> et <b>IMAGES</b>.</div></li>
    </ol>
    ${status}
    <div class="bc-actions">
      <button class="btn" id="bc-reopen">${icon('external')}Rouvrir dans ${b.opener === 'Chrome' ? 'Chrome' : 'le navigateur'}</button>
      <button class="btn primary" id="bc-finish" ${!b.imported || b.current ? 'disabled' : ''}>${icon('check')}Terminer l'import</button>
    </div>`
  );
}

function renderDoneCard(s) {
  const card = $('#done-card');
  if (s.status === 'running') {
    card.classList.add('hidden');
    card._key = null;
    return;
  }
  const key = `${s.dir}|${s.status}|${JSON.stringify(s.result)}`;
  if (card._key === key) return;
  card._key = key;
  card.classList.remove('hidden', 'error', 'cancel');
  const r = s.result || {};
  if (s.status === 'done') {
    const chips = [];
    if (r.videos) chips.push(`<span class="chip">${icon('film')}${plural(r.videos, 'vidéo', 'vidéos')}</span>`);
    if (r.images) chips.push(`<span class="chip">${icon('image')}${plural(r.images, 'image', 'images')}</span>`);
    if (r.audio) chips.push(`<span class="chip">${icon('audio')}${r.audio} audio</span>`);
    if (r.bytes) chips.push(`<span class="chip">${fmtBytes(r.bytes)}</span>`);
    if (r.prproj) chips.push(`<span class="chip ok">${icon('check')}Projet Premiere créé</span>`);
    if (r.failed) chips.push(`<span class="chip" style="color:var(--err)">${icon('alert')}${r.failed} échec(s)</span>`);
    if (r.already) chips.push(`<span class="chip">${icon('check')}${plural(r.already, 'fichier déjà présent', 'fichiers déjà présents')}</span>`);
    card.innerHTML = `
      <div class="done-badge">${icon('check')}</div>
      <div class="done-body"><h2>${s.addTo ? 'Les fichiers sont dans ton projet.' : 'Ton projet est prêt à monter.'}</h2><p>${s.addTo ? 'Ajoutés dans RUSHES et IMAGES de' : 'Tout est rangé dans'} <b>${esc(s.name)}</b>.</p><div class="done-chips">${chips.join('')}</div></div>
      <div class="done-actions">
        ${r.prproj ? `<button class="btn primary" data-open="${esc(r.prproj)}">${icon('play')}Ouvrir dans Premiere Pro</button>` : ''}
        <button class="btn" data-autoedit="${esc(s.dir)}" data-name="${esc(s.name)}" title="Classer les rushes, bout à bout sans les blancs, images et sound effects">${icon('wand')}AUTOEDIT</button>
        <button class="btn" data-open="${esc(s.dir)}">${icon('folderOpen')}Ouvrir le dossier</button>
      </div>`;
  } else if (s.status === 'cancelled') {
    card.classList.add('cancel');
    card.innerHTML = `
      <div class="done-badge">${icon('stop')}</div>
      <div class="done-body"><h2>Création annulée</h2><p>Les fichiers déjà téléchargés sont conservés dans le dossier du projet.</p></div>
      <div class="done-actions"><button class="btn" data-open="${esc(s.dir)}">${icon('folderOpen')}Ouvrir le dossier</button></div>`;
  } else {
    card.classList.add('error');
    card.innerHTML = `
      <div class="done-badge">${icon('alert')}</div>
      <div class="done-body"><h2>Impossible de terminer</h2><p>${esc(s.error).replace(/\n/g, '<br>')}</p></div>
      <div class="done-actions"><button class="btn" id="retry-btn">${icon('refresh')}Modifier et réessayer</button></div>`;
  }
}

function fileVisible(f) {
  const flt = state.fileFilter;
  if (flt === 'all') return true;
  if (flt === 'error') return f.status === 'error';
  return f.category === flt;
}

function renderFiles(s) {
  const list = $('#file-list');
  const files = s.files.filter(fileVisible);
  if (!files.length) {
    fileRows.clear();
    const scan = s.steps.scan || {};
    const msg =
      s.mode === 'browser' ? (s.status === 'running' ? 'Les fichiers apparaîtront ici dès que le téléchargement sera détecté.' : 'Aucun fichier importé.')
      : scan.status === 'active' ? 'Lecture du dossier Drive…'
      : scan.status === 'skipped' ? 'Aucun lien Drive : seule la structure est créée.'
      : 'Aucun fichier.';
    list.innerHTML = `<div class="empty">${msg}</div>`;
    return;
  }
  const empty = $('.empty', list);
  if (empty) empty.remove();
  const wanted = new Set(files.map((f) => f.key));
  for (const [key, row] of fileRows) {
    if (!wanted.has(key)) {
      row.remove();
      fileRows.delete(key);
    }
  }
  files.forEach((f, idx) => {
    let row = fileRows.get(f.key);
    if (!row) {
      row = document.createElement('div');
      row.innerHTML = `<div class="file-ico"></div><div style="min-width:0"><div class="file-name"></div><div class="file-sub"></div></div><div class="file-size"></div><div class="bar small"><div class="bar-fill"></div></div><div class="file-state"></div>`;
      fileRows.set(f.key, row);
    }
    if (list.children[idx] !== row) list.insertBefore(row, list.children[idx] || null);
    const cat = CAT[f.category] || CAT.other;
    const cls = `file-row ${cat.cls} ${f.status}`;
    if (row.className !== cls) {
      row.className = cls;
      row.children[0].innerHTML = icon(cat.icon);
      row.children[4].innerHTML = f.status === 'active' ? '<span class="spinner"></span>' : f.status === 'done' ? icon('check') : f.status === 'error' ? icon('alert') : '';
    }
    const name = f.name || 'Fichier';
    if (row.children[1].firstChild.textContent !== name) row.children[1].firstChild.textContent = name;
    const sub = row.children[1].lastChild;
    const subText = f.status === 'error' ? f.error : `${f.category === 'image' ? 'IMAGES' : f.category === 'other' ? 'AUTRES' : 'RUSHES'}${f.rel && f.rel.length ? ' › ' + f.rel.join(' › ') : ''}`;
    if (sub.textContent !== subText) sub.textContent = subText;
    sub.classList.toggle('err', f.status === 'error');
    row.children[2].textContent = f.status === 'active' && f.size ? `${fmtBytes(f.received)} / ${fmtBytes(f.size)}` : f.size ? fmtBytes(f.size) : f.received ? fmtBytes(f.received) : '';
    const fill = row.children[3].firstChild;
    const pct = f.status === 'done' ? 100 : f.size ? (f.received / f.size) * 100 : f.status === 'active' ? 30 : 0;
    fill.style.width = `${pct}%`;
    fill.classList.toggle('ok', f.status === 'done');
    fill.classList.toggle('static', f.status !== 'active');
  });
}

// ---------- Médias : miniatures et lecture au survol ----------
const mediaUrl = (p) => 'filedit-media://f/' + encodeURIComponent(p);
const thumbMem = new Map(); // chemin -> fichier miniature | null (impossible)
const thumbQueue = [];
let thumbBusy = 0;

// Attributs HTML d'une zone qui affiche la miniature d'un fichier.
function thumbAttrs(item, kind) {
  if (!item) return '';
  return `data-thumb="${esc(item.path)}" data-size="${item.size}" data-mtime="${Math.round(item.mtime)}" data-kind="${kind}"`;
}

function applyThumb(el, file) {
  if (file) {
    el.style.setProperty('--img', `url("${mediaUrl(file)}")`);
    el.classList.add('has-thumb');
  } else el.classList.add('no-thumb');
}

// Applique les miniatures connues et génère celles qui manquent.
async function hydrateThumbs(root = document) {
  const els = $$('[data-thumb]', root).filter((el) => !el.classList.contains('has-thumb') && !el.classList.contains('no-thumb'));
  const unknown = [];
  for (const el of els) {
    const p = el.dataset.thumb;
    if (thumbMem.has(p)) applyThumb(el, thumbMem.get(p));
    else unknown.push({ path: p, size: Number(el.dataset.size), mtime: Number(el.dataset.mtime), kind: el.dataset.kind });
  }
  if (!unknown.length) return;
  const uniq = [...new Map(unknown.map((u) => [u.path, u])).values()];
  const found = await api.thumbLookup(uniq);
  for (const u of uniq) {
    const r = found[u.path];
    if (r.file || r.fail) setThumb(u.path, r.file || null);
    else if (!thumbQueue.some((q) => q.path === u.path)) thumbQueue.push({ ...u, key: r.key });
  }
  pumpThumbs();
}

function setThumb(path, file) {
  thumbMem.set(path, file);
  $$('[data-thumb]').forEach((el) => el.dataset.thumb === path && applyThumb(el, file));
}

function pumpThumbs() {
  while (thumbBusy < 2 && thumbQueue.length) {
    const job = thumbQueue.shift();
    thumbBusy++;
    makeThumb(job)
      .then(async (blob) => setThumb(job.path, await api.thumbSave(job.key, blob ? await blob.arrayBuffer() : null)))
      .catch(() => setThumb(job.path, null))
      .finally(() => {
        thumbBusy--;
        pumpThumbs();
      });
  }
}

function drawToBlob(source, w, h) {
  const max = 640;
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
}

// Image extraite à ~30 % de la vidéo (ou image réduite), via le décodeur de l'app.
function makeThumb(job) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(null), 15000);
    let el;
    const done = (v) => {
      clearTimeout(timer);
      if (el && el.tagName === 'VIDEO') {
        el.removeAttribute('src');
        el.load();
      }
      resolve(v);
    };
    if (job.kind === 'image') {
      el = new Image();
      el.onload = () => drawToBlob(el, el.naturalWidth, el.naturalHeight).then(done);
      el.onerror = () => done(null);
      el.src = mediaUrl(job.path);
      return;
    }
    el = document.createElement('video');
    el.muted = true;
    el.preload = 'auto';
    el.onloadedmetadata = () => {
      if (!el.videoWidth) return done(null);
      el.currentTime = Math.min(Math.max(0.5, el.duration * 0.3), Math.max(0, el.duration - 0.1));
    };
    el.onseeked = () => drawToBlob(el, el.videoWidth, el.videoHeight).then(done);
    el.onerror = () => done(null);
    el.src = mediaUrl(job.path);
  });
}

// Lecture muette au survol de tout élément [data-preview].
let preview = null;
function startPreview(host) {
  stopPreview();
  const p = { host, timer: null, video: null };
  preview = p;
  p.timer = setTimeout(() => {
    const v = document.createElement('video');
    v.className = 'preview-video';
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.src = mediaUrl(host.dataset.preview);
    v.addEventListener('playing', () => host.classList.add('playing'));
    v.addEventListener('timeupdate', () => {
      const bar = $('.preview-bar', host);
      if (bar && v.duration) bar.style.width = `${(v.currentTime / v.duration) * 100}%`;
    });
    v.addEventListener('error', () => host.classList.add('noplay'));
    host.appendChild(v);
    p.video = v;
    v.play().catch(() => {});
  }, 160);
}
function stopPreview() {
  if (!preview) return;
  clearTimeout(preview.timer);
  const { host, video } = preview;
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
  }
  host.classList.remove('playing', 'noplay');
  const bar = $('.preview-bar', host);
  if (bar) bar.style.width = '0';
  preview = null;
}

// ---------- Personnalisation des projets ----------
const PROJECT_COLORS = ['#ff6a3d', '#f43f5e', '#ec4899', '#a855f7', '#6366f1', '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e', '#eab308'];
const PROJECT_ICONS = ['clapper', 'film', 'camera', 'video', 'mic', 'music', 'heart', 'plane', 'car', 'mountain', 'sun', 'moon', 'flame', 'rocket', 'briefcase', 'bag', 'gift', 'trophy', 'dumbbell', 'gamepad', 'palette', 'building', 'coffee', 'star'];
const ICON_GUESS = [
  [/mariage|wedding|love|couple/i, 'heart'],
  [/voyage|travel|trip|japon|vlog/i, 'plane'],
  [/clip|music|musique|concert|artiste|son\b/i, 'music'],
  [/interview|podcast|itw/i, 'mic'],
  [/sport|fitness|gym|foot|match/i, 'dumbbell'],
  [/pub|spot|ads?\b|campagne|brand|marque/i, 'briefcase'],
  [/auto|car|voiture|moto/i, 'car'],
  [/game|gaming|stream|twitch/i, 'gamepad'],
  [/food|resto|cuisine|caf[ée]/i, 'coffee'],
  [/mode|fashion|shop|beaut[ée]/i, 'bag'],
  [/event|soir[ée]e|party|anniv/i, 'gift'],
  [/photo|shooting/i, 'camera']
];

function hashStr(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return h;
}

function metaFor(dir, name) {
  const m = (state.settings.projects || {})[dir] || {};
  const guess = ICON_GUESS.find(([re]) => re.test(name || ''));
  return {
    color: m.color || PROJECT_COLORS[hashStr(name || dir) % PROJECT_COLORS.length],
    icon: m.icon || (guess ? guess[1] : 'clapper'),
    pinned: !!m.pinned,
    pinnedAt: m.pinnedAt || 0
  };
}

function badge(meta, cls = '') {
  return `<span class="pbadge ${cls}" style="--pc:${meta.color}">${icon(meta.icon)}</span>`;
}

async function setMeta(dir, patch) {
  state.settings = await api.setProjectMeta(dir, patch);
  renderSidePins();
  if (state.view === 'projects') renderProjects();
  if (!$('#project-modal').classList.contains('hidden') && state.modalDir === dir) openProjectModal(dir, true);
}

async function togglePin(dir) {
  const name = dir.split(/[\\/]/).pop();
  const pinned = !metaFor(dir, name).pinned;
  await setMeta(dir, { pinned });
  toast(pinned ? `${name} épinglé` : `${name} désépinglé`);
}

function renderSidePins() {
  const box = $('#side-pins');
  const metas = state.settings.projects || {};
  const pins = Object.entries(metas)
    .filter(([, m]) => m.pinned)
    .sort((a, b) => (b[1].pinnedAt || 0) - (a[1].pinnedAt || 0));
  box.classList.toggle('hidden', !pins.length);
  setHTML(
    box,
    `<div class="side-title">${icon('pin')}Épinglés</div>` +
      pins
        .map(([dir]) => {
          const name = dir.split(/[\\/]/).pop();
          return `<button class="side-pin" data-detail-open="${esc(dir)}" title="${esc(name)}">${badge(metaFor(dir, name), 'xs')}<span>${esc(name)}</span></button>`;
        })
        .join('')
  );
}

// Popover : couleur + icône (pour un projet existant, ou pour le prochain projet).
function openCustomizer(anchor, target) {
  const pop = $('#customizer');
  const cur = target === 'new' ? { ...metaFor('', sanitizeName(nameInput.value)), ...state.newMeta } : metaFor(target, target.split(/[\\/]/).pop());
  pop.dataset.target = target;
  pop.innerHTML = `
    <div class="pop-title">Couleur</div>
    <div class="swatches">${PROJECT_COLORS.map((c) => `<button class="swatch ${cur.color === c ? 'on' : ''}" data-color="${c}" style="--pc:${c}"></button>`).join('')}</div>
    <div class="pop-title">Icône</div>
    <div class="icon-grid">${PROJECT_ICONS.map((i) => `<button class="icon-pick ${cur.icon === i ? 'on' : ''}" data-icon-pick="${i}" style="--pc:${cur.color}">${icon(i)}</button>`).join('')}</div>
    <div class="pop-foot"><button class="btn sm ghost" data-meta-reset>Par défaut</button><button class="btn sm" data-pop-close>Fermer</button></div>`;
  pop.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  let left = Math.min(window.innerWidth - w - 12, Math.max(12, r.left));
  let top = r.bottom + 8;
  if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 8);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

function closeCustomizer() {
  $('#customizer').classList.add('hidden');
}

async function onCustomizerClick(e) {
  const pop = $('#customizer');
  const target = pop.dataset.target;
  const color = e.target.closest('[data-color]');
  const ic = e.target.closest('[data-icon-pick]');
  if (e.target.closest('[data-pop-close]')) return closeCustomizer();
  let patch = null;
  if (color) patch = { color: color.dataset.color };
  if (ic) patch = { icon: ic.dataset.iconPick };
  if (e.target.closest('[data-meta-reset]')) patch = { color: '', icon: '' };
  if (!patch) return;
  if (target === 'new') {
    state.newMeta = patch.color === '' ? {} : { ...state.newMeta, ...patch };
    renderNewBadge();
    renderTree();
  } else await setMeta(target, patch);
  openCustomizer($(`[data-customize="${CSS.escape(target)}"]`) || $('#new-badge'), target);
}

function renderNewBadge() {
  const meta = { ...metaFor('', sanitizeName(nameInput.value)), ...state.newMeta };
  setHTML($('#new-badge'), badge(meta));
}

// ---------- Projets ----------
const FOLDER_CLS = { RUSHES: 'c-rushes', IMAGES: 'c-images', MONTAGE: 'c-montage', MUSIQUE: 'c-musique', 'SOUND EFFECT': 'c-sfx', TEMPLATE: 'c-template' };

async function loadLibrary() {
  renderProjects();
  if (state.libLoading) return;
  state.libLoading = true;
  $('#lib-refresh').classList.add('spinning');
  state.library = await api.scanLibrary();
  state.libLoading = false;
  $('#recent-count').textContent = state.library.length;
  $('#lib-refresh').classList.remove('spinning');
  renderProjects();
}

function initials(name) {
  return name.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'P';
}

function recentFor(dir) {
  return state.settings.recent.find((r) => r.dir === dir);
}

function stackBar(p) {
  const t = p.totals;
  const parts = [
    ['c-rushes', t.video.bytes],
    ['c-images', t.image.bytes],
    ['c-musique', t.audio.bytes],
    ['c-other', t.other.bytes + Math.max(0, p.bytes - t.video.bytes - t.image.bytes - t.audio.bytes - t.other.bytes)]
  ];
  if (!p.bytes) return '<div class="stack empty"></div>';
  return `<div class="stack">${parts.filter(([, b]) => b > 0).map(([c, b]) => `<span class="${c}" style="flex:${b}"></span>`).join('')}</div>`;
}

function renderProjects() {
  const grid = $('#projects-grid');
  const root = state.settings.projectsRoot;
  setHTML($('#lib-root'), `${icon('folder')}${esc(root || 'Aucun dossier de projets')}`);
  if (!state.library) {
    $('#lib-summary').innerHTML = '';
    grid.innerHTML = Array.from({ length: 6 }, () => '<div class="card project-card skeleton"><div class="sk sk-a"></div><div class="sk sk-b"></div><div class="sk sk-c"></div></div>').join('');
    return;
  }
  const lib = state.library;
  if (!lib.length) {
    $('#lib-summary').innerHTML = '';
    grid.innerHTML = `<div class="empty-state"><div class="big-ico">${icon('clapper')}</div><h3>Aucun projet dans ce dossier</h3><p>Les dossiers présents dans ${esc(root)} apparaîtront ici.</p><button class="btn primary" id="empty-new">${icon('plus')}Créer un projet</button></div>`;
    $('#empty-new').onclick = () => showView('new');
    return;
  }
  const sum = (k) => lib.reduce((a, p) => a + p.totals[k].count, 0);
  $('#lib-summary').innerHTML = `
    <div class="sum"><b>${lib.length}</b><span>projets</span></div>
    <div class="sum"><b>${fmtBytes(lib.reduce((a, p) => a + p.bytes, 0))}</b><span>au total</span></div>
    <div class="sum c-rushes"><b>${sum('video')}</b><span>vidéos</span></div>
    <div class="sum c-images"><b>${sum('image')}</b><span>images</span></div>
    <div class="sum c-montage"><b>${lib.reduce((a, p) => a + p.prproj.length, 0)}</b><span>projets Premiere</span></div>`;

  const q = $('#search').value.trim().toLowerCase();
  const sorters = {
    modified: (a, b) => b.modified - a.modified,
    name: (a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }),
    bytes: (a, b) => b.bytes - a.bytes
  };
  const list = lib.filter((p) => !q || p.name.toLowerCase().includes(q)).sort(sorters[state.libSort]);
  if (!list.length) {
    grid.innerHTML = `<div class="empty-state"><h3>Aucun résultat</h3><p>Aucun projet ne correspond à « ${esc(q)} ».</p></div>`;
    return;
  }
  const card = (p) => {
    const t = p.totals;
    const meta = metaFor(p.dir, p.name);
    const chips = [];
    if (t.video.count) chips.push(`<span class="chip">${icon('film')}${t.video.count}</span>`);
    if (t.image.count) chips.push(`<span class="chip">${icon('image')}${t.image.count}</span>`);
    if (t.audio.count) chips.push(`<span class="chip">${icon('audio')}${t.audio.count}</span>`);
    chips.push(`<span class="chip">${fmtBytes(p.bytes)}</span>`);
    const pr = p.prproj[0];
    const ex = p.latestExport;
    const cover = ex ? thumbAttrs(ex, 'video') : p.coverRush ? thumbAttrs(p.coverRush, 'video') : p.coverImage ? thumbAttrs(p.coverImage, 'image') : '';
    const tag = ex
      ? `<span class="cover-tag">${icon('play')}${ex.version ? esc(ex.version) : 'Dernier export'}</span>`
      : p.coverRush
        ? `<span class="cover-tag dim">${icon('film')}Rush · pas encore d'export</span>`
        : p.coverImage
          ? `<span class="cover-tag dim">${icon('image')}Image</span>`
          : '';
    return `
      <div class="card project-card ${meta.pinned ? 'pinned' : ''}" data-detail="${esc(p.dir)}" style="--pc:${meta.color}">
        <div class="pc-cover thumb" ${cover} ${ex && ex.playable ? `data-preview="${esc(ex.path)}"` : ''}>
          <div class="cover-fallback">${icon(meta.icon)}</div>
          <div class="cover-shade"></div>
          ${tag}
          <button class="pin-btn ${meta.pinned ? 'on' : ''}" data-pin="${esc(p.dir)}" title="${meta.pinned ? 'Désépingler' : 'Épingler'}">${icon('pin')}</button>
          <div class="preview-bar"></div>
          <span class="noplay-label">Aperçu indisponible</span>
        </div>
        <div class="pc-body">
          <div class="pc-head">
            <button class="badge-btn" data-customize="${esc(p.dir)}" title="Changer l'icône et la couleur">${badge(meta)}</button>
            <div class="pc-title"><div class="pc-name" title="${esc(p.name)}">${esc(p.name)}</div><div class="pc-date">${icon('clock')}Modifié ${relTime(p.modified)}${ex ? ` · ${plural(p.exports.length, 'export', 'exports')}` : ''}</div></div>
            ${recentFor(p.dir) ? '<span class="pc-badge">Coffile</span>' : ''}
          </div>
          <div class="pc-stats">${chips.join('')}</div>
          ${stackBar(p)}
          <div class="pc-actions">
            <button class="btn sm" data-open="${esc(p.dir)}">${icon('folderOpen')}Ouvrir</button>
            ${pr ? `<button class="btn sm" data-open="${esc(pr.path)}" title="${esc(pr.name)}">${icon('play')}Premiere</button>` : ''}
            <button class="btn sm ghost icon-only" title="Détails">${icon('arrow')}</button>
          </div>
        </div>
      </div>`;
  };
  const pinned = list.filter((p) => metaFor(p.dir, p.name).pinned).sort((a, b) => metaFor(b.dir, b.name).pinnedAt - metaFor(a.dir, a.name).pinnedAt);
  const others = list.filter((p) => !metaFor(p.dir, p.name).pinned);
  grid.innerHTML =
    (pinned.length ? `<div class="grid-title">${icon('pin')}Épinglés</div>${pinned.map(card).join('')}${others.length ? `<div class="grid-title">${icon('grid')}Tous les projets</div>` : ''}` : '') +
    others.map(card).join('');
  hydrateThumbs(grid);
}

async function openProjectModal(dir, keepScroll) {
  state.modalDir = dir;
  const modal = $('#project-modal');
  const scroll = keepScroll ? $('#project-modal-body').scrollTop : 0;
  const body = $('#project-modal-body');
  let p = (state.library || []).find((x) => x.dir === dir);
  modal.classList.remove('hidden');
  body.innerHTML = p ? '' : '<div class="empty"><span class="spinner"></span></div>';
  // Rafraîchit les infos du projet à l'ouverture.
  const fresh = await api.scanProject(dir);
  if (fresh) {
    p = fresh;
    if (state.library) state.library = state.library.map((x) => (x.dir === dir ? fresh : x));
  }
  if (!p) {
    body.innerHTML = `<div class="empty">Dossier introuvable.</div>`;
    return;
  }
  const t = p.totals;
  const rec = recentFor(p.dir);
  const maxFolder = Math.max(1, ...p.folders.map((f) => f.bytes));
  const tile = (cls, ic, label, v) => `<div class="tile ${cls}"><div class="tile-ico">${icon(ic)}</div><div><b>${v.count}</b><span>${label}</span><small>${fmtBytes(v.bytes)}</small></div></div>`;
  const meta = metaFor(p.dir, p.name);
  const cover = p.latestExport ? thumbAttrs(p.latestExport, 'video') : p.coverRush ? thumbAttrs(p.coverRush, 'video') : p.coverImage ? thumbAttrs(p.coverImage, 'image') : '';
  const fdate = (ms) => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) + ' à ' + new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  body.innerHTML = `
    <button class="btn ghost icon-only modal-close" id="pm-close" title="Fermer">${icon('x')}</button>
    <div class="pm-cover thumb" style="--pc:${meta.color}" ${cover} ${p.latestExport && p.latestExport.playable ? `data-preview="${esc(p.latestExport.path)}"` : ''}>
      <div class="cover-fallback">${icon(meta.icon)}</div>
      <div class="cover-shade"></div>
      ${p.latestExport ? `<span class="cover-tag">${icon('play')}${esc(p.latestExport.version || 'Dernier export')} · survole pour lire</span>` : p.coverRush ? `<span class="cover-tag dim">${icon('film')}Rush · pas encore d'export</span>` : ''}
      <div class="preview-bar"></div>
      <span class="noplay-label">Aperçu indisponible</span>
    </div>
    <div class="pm-head">
      <button class="badge-btn" data-customize="${esc(p.dir)}" title="Changer l'icône et la couleur">${badge(meta, 'lg')}</button>
      <div class="pm-title">
        <h2>${esc(p.name)}</h2>
        <button class="path-link" data-open="${esc(p.dir)}">${icon('folder')}${esc(p.dir)}</button>
      </div>
      <div class="pm-head-acts">
        <button class="btn sm ${meta.pinned ? 'pin-on' : ''}" data-pin="${esc(p.dir)}">${icon('pin')}${meta.pinned ? 'Épinglé' : 'Épingler'}</button>
        <button class="btn sm" data-customize="${esc(p.dir)}">${icon('palette')}Personnaliser</button>
      </div>
    </div>
    <div class="pm-info">
      <div><span>Taille totale</span><b>${fmtBytes(p.bytes)}</b></div>
      <div><span>Fichiers</span><b>${p.files.toLocaleString('fr-FR')}${p.truncated ? '+' : ''}</b></div>
      <div><span>Créé le</span><b>${fdate(p.created)}</b></div>
      <div><span>Dernière modification</span><b>${fdate(p.modified)}</b></div>
    </div>
    <div class="pm-section">Médias</div>
    <div class="tiles">
      ${tile('c-rushes', 'film', 'vidéos', t.video)}
      ${tile('c-images', 'image', 'images', t.image)}
      ${tile('c-musique', 'audio', 'audio', t.audio)}
      ${tile('c-other', 'file', 'autres', t.other)}
    </div>
    <div class="pm-section">Dossiers</div>
    <div class="pm-folders">
      ${p.folders
        .map(
          (f) => `<div class="pm-folder ${FOLDER_CLS[f.name.toUpperCase()] || 'c-other'}">
            <div class="tree-ico">${icon('folder')}</div>
            <span class="pm-fname">${esc(f.name)}</span>
            <div class="bar small"><div class="bar-fill static" style="width:${f.bytes ? Math.max(2, (f.bytes / maxFolder) * 100) : 0}%"></div></div>
            <span class="pm-fmeta">${plural(f.count, 'fichier', 'fichiers')}</span>
            <span class="pm-fsize">${f.bytes ? fmtBytes(f.bytes) : 'Vide'}</span>
          </div>`
        )
        .join('') || '<div class="empty">Dossier vide.</div>'}
    </div>
    <div class="pm-section">Projets Premiere Pro</div>
    <div class="pm-prs">
      ${p.prproj
        .map(
          (x) => `<div class="pm-pr"><div class="pr-logo small">Pr</div><div class="pm-pr-text"><b>${esc(x.name)}</b><span>${esc(x.path.slice(p.dir.length + 1))} · modifié ${relTime(x.mtime)}</span></div><button class="btn sm" data-open="${esc(x.path)}">${icon('play')}Ouvrir</button></div>`
        )
        .join('') || '<div class="empty small-empty">Aucun fichier .prproj dans ce projet.</div>'}
    </div>
    ${
      p.exports && p.exports.length
        ? `<div class="pm-section">Exports <button class="link inline" data-goto-exports="${esc(p.name)}">Tout voir dans Exports</button><button class="link inline" data-rename-project="${esc(p.dir)}">${icon('wand')}Auto rename</button></div><div class="pm-prs">${p.exports
            .slice()
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 6)
            .map(
              (x) =>
                `<div class="pm-pr"><div class="mini-thumb thumb" ${thumbAttrs(x, 'video')} ${/\.(mp4|m4v|mov|webm)$/i.test(x.name) ? `data-preview="${esc(x.path)}"` : ''}><div class="cover-fallback">${icon('film')}</div><div class="preview-bar"></div></div><div class="pm-pr-text"><b>${esc(x.name)}</b><span>${esc(x.rel.join(' › ') || 'Racine du projet')} · ${fmtBytes(x.size)} · ${relTime(x.mtime)}</span></div><button class="btn sm" data-reveal="${esc(x.path)}">${icon('folderOpen')}Afficher</button></div>`
            )
            .join('')}</div>`
        : ''
    }
    ${rec && rec.driveUrl ? `<div class="pm-section">Source</div><div class="pm-pr"><div class="tree-ico c-images">${icon('drive')}</div><div class="pm-pr-text"><b>Google Drive</b><span>${esc(rec.driveUrl)}</span></div><button class="btn sm" data-url="${esc(rec.driveUrl)}">${icon('external')}Ouvrir</button></div>` : ''}
    <div class="pm-actions">
      <button class="btn" data-open="${esc(p.dir)}">${icon('folderOpen')}Ouvrir le dossier</button>
      <button class="btn" data-autoedit="${esc(p.dir)}" data-name="${esc(p.name)}" title="Classer les rushes, bout à bout sans les blancs, images et sound effects">${icon('wand')}AUTOEDIT</button>
      ${p.prproj[0] ? `<button class="btn primary" data-open="${esc(p.prproj[0].path)}">${icon('play')}Ouvrir dans Premiere Pro</button>` : ''}
    </div>`;
  hydrateThumbs(body);
  body.scrollTop = scroll;
  if (state.view === 'projects' && !keepScroll) renderProjects();
}

function closeProjectModal() {
  stopPreview();
  state.modalDir = null;
  $('#project-modal').classList.add('hidden');
}

// ---------- Comptes Google ----------
function avatar(a) {
  return a.picture ? `<img class="avatar" src="${esc(a.picture)}" alt="" />` : `<span class="avatar letter">${esc((a.name || a.email || '?')[0].toUpperCase())}</span>`;
}

function renderAccountPick() {
  const accs = (state.settings.googleAccounts || []).concat(chromeAccs());
  if (state.account && !accs.some((a) => a.email === state.account)) state.account = '';
  const items = [`<button class="acc-chip ${!state.account ? 'active' : ''}" data-acc="" title="Comptes connectés puis accès public, et Chrome en dernier recours">${icon('bolt')}<span>Automatique</span></button>`];
  for (const a of accs) {
    items.push(
      `<button class="acc-chip ${state.account === a.email ? 'active' : ''} ${a.invalid ? 'invalid' : ''}" data-acc="${esc(a.email)}" title="${esc(a.name)} — ${esc(accLabel(a.email))}${a.chrome ? ' (session Chrome de Coffile)' : ''}">${a.chrome ? `<span class="avatar chrome-av">${icon('chrome')}</span>` : avatar(a)}<span>${esc(accLabel(a.email))}</span>${a.invalid ? icon('alert') : ''}</button>`
    );
  }
  items.push(
    state.connecting
      ? `<button class="acc-chip add" data-connect>${'<span class="spinner"></span>'}<span>En attente de Google… Annuler</span></button>`
      : `<button class="acc-chip add" ${viaChromeMode() ? `data-chrome-login="${chromeAccs().length ? 'add' : ''}"` : 'data-connect'}>${icon('plus')}<span>${accs.length ? 'Ajouter un compte' : 'Connecter un compte Google'}</span></button>`
  );
  setHTML($('#account-pick'), items.join(''));
}

function selectAccount(email) {
  state.account = email;
  renderAccountPick();
  if (driveInput.value.trim()) driveInput.dispatchEvent(new Event('input'));
}

async function connectGoogle() {
  if (state.connecting) {
    api.googleCancel();
    return;
  }
  if (!state.settings.googleClient.configured) {
    showView('settings');
    $('#oauth-details').open = true;
    $('#google-setting').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('Configure d\'abord la connexion Google (une seule fois).', 'err');
    return;
  }
  state.connecting = true;
  renderConnectState();
  toast('Choisis ton compte Google dans Chrome…');
  const r = await api.googleConnect();
  state.connecting = false;
  state.settings = r.settings;
  renderAllSettingsDependent();
  renderConnectState();
  if (r.ok) {
    toast(`Compte ${r.account.email} connecté`);
    selectAccount(r.account.email);
  } else if (!r.cancelled) toast(r.error, 'err');
}

function renderConnectState() {
  renderAccountPick();
  const b = $('#acc-connect');
  b.innerHTML = state.connecting ? `<span class="spinner"></span>En attente de Google… Annuler` : `${icon('plus')}Connecter un compte Google`;
  b.classList.toggle('primary', !state.connecting);
}

async function renderGoogleSettings() {
  const s = state.settings;
  const accs = s.googleAccounts || [];
  setHTML(
    $('#accounts-list'),
    accs.length
      ? accs
          .map(
            (a) => `<div class="acc-row ${a.invalid ? 'invalid' : ''}">
          ${avatar(a)}
          <div class="acc-text"><b>${esc(a.name || a.email)}</b><span>${esc(a.email)}</span></div>
          ${s.defaultAccount === a.email ? '<span class="pill accent">Par défaut</span>' : ''}
          ${a.invalid ? '<span class="pill warn">Reconnexion nécessaire</span>' : '<span class="pill ok">Drive</span>'}
          ${a.features && a.features.gmail ? '<span class="pill ok">Gmail</span>' : ''}
          ${a.features && a.features.chat ? '<span class="pill ok">Chat</span>' : ''}
          <div class="acc-acts">
            ${a.invalid ? `<button class="btn sm" data-connect>${icon('refresh')}Reconnecter</button>` : ''}
            ${s.defaultAccount !== a.email ? `<button class="btn sm ghost" data-acc-default="${esc(a.email)}">Par défaut</button>` : `<button class="btn sm ghost" data-acc-default="">Retirer le défaut</button>`}
            <button class="btn sm ghost icon-only danger" data-acc-remove="${esc(a.email)}" title="Déconnecter">${icon('trash')}</button>
          </div>
        </div>`
          )
          .join('')
      : `<div class="acc-empty">${icon('user')}<span>Aucun compte connecté. Sans compte, seuls les Drive publics se téléchargent automatiquement.</span></div>`
  );
  const g = s.googleClient || {};
  $('#oauth-summary').innerHTML = g.configured
    ? `<span class="ok-text">${icon('check')}Connexion Google ${g.bundled ? 'intégrée' : 'configurée'}</span><span class="muted">· modifier</span>`
    : 'Configuration de la connexion Google <span class="pill warn">À faire une fois</span>';
  if (!g.configured && !accs.length) $('#oauth-details').open = true;
  if (document.activeElement !== $('#oauth-id')) $('#oauth-id').value = g.id || '';

  if (!state.chromeProfiles) state.chromeProfiles = await api.chromeProfiles();
  const sel = $('#chrome-profile');
  const opts = [`<option value="">Profil par défaut</option>`].concat(
    state.chromeProfiles.map((p) => `<option value="${esc(p.dir)}">${esc(p.name)}${p.email ? ' — ' + esc(p.email) : ''}</option>`)
  );
  setHTML(sel, opts.join(''));
  sel.value = s.chromeProfile || '';
  $('.acc-profile').classList.toggle('hidden', !state.chromeProfiles.length);
}

// ---------- Exports ----------
const ASPECT_NAMES = { '16:9': 'Horizontal', '9:16': 'Vertical · Reels, TikTok, Shorts', '1:1': 'Carré', '4:5': 'Portrait · Instagram', '4:3': 'Classique', '3:4': 'Portrait', '21:9': 'Cinémascope', '1.85:1': 'Cinéma', '1.9:1': 'Cinéma DCI', '2:1': 'Univisium', Inconnu: 'Format non détecté' };

async function loadExports() {
  renderExports();
  if (state.expLoading) return;
  state.expLoading = true;
  $('#exp-refresh').classList.add('spinning');
  state.exports = await api.scanExports();
  state.expLoading = false;
  $('#exp-refresh').classList.remove('spinning');
  $('#exports-count').textContent = state.exports.length || '';
  renderExports();
}

function fmtDur(sec) {
  if (!sec) return '—';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s2 = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s2}` : `${m}:${s2}`;
}

const PLAYABLE_EXT = /^(MP4|M4V|MOV|WEBM)$/;

function exportMedia(e, cls) {
  const ar = e.width && e.height ? e.width / e.height : 16 / 9;
  return `<div class="${cls} thumb" ${thumbAttrs(e, 'video')} ${PLAYABLE_EXT.test(e.ext) ? `data-preview="${esc(e.path)}"` : ''} style="--ar:${ar.toFixed(4)}">
      <div class="cover-fallback">${icon('film')}</div>
      <div class="preview-bar"></div>
      <span class="noplay-label">Aperçu indisponible</span>`;
}

function exportCard(e, latest) {
  const meta = metaFor(e.projectDir, e.project);
  return `<div class="exp-card ${state.expSelected === e.path ? 'selected' : ''}" data-path="${esc(e.path)}" title="Survol : lecture · Double-clic : afficher dans l'Explorateur">
    ${exportMedia(e, 'ec-media')}
      <div class="ec-top">${e.version ? `<span class="ver ${e.final ? 'final' : ''}">${esc(e.version)}</span>` : ''}${latest ? '<span class="latest-pill">Dernière</span>' : ''}</div>
      <div class="ec-bottom"><span class="ec-ratio"><span class="ratio mini" style="${miniRatio(e.aspect)}"></span>${esc(e.aspect)}${e.resolution ? ' · ' + esc(e.resolution) : ''}</span>${e.duration ? `<span class="ec-dur">${fmtDur(e.duration)}</span>` : ''}</div>
    </div>
    <div class="ec-body">
      <div class="ec-name">${esc(e.name)}</div>
      <div class="ec-sub"><span class="pdot" style="--pc:${meta.color}"></span>${esc(e.project)} · ${fmtBytes(e.size)} · ${relTime(e.mtime)}</div>
    </div>
    <div class="ec-acts"><button class="btn sm ghost icon-only" data-play title="Lire avec le lecteur vidéo">${icon('play')}</button><button class="btn sm ghost icon-only" data-reveal title="Afficher dans le dossier">${icon('folderOpen')}</button></div>
  </div>`;
}

function exportRow(e, latest) {
  return `<div class="exp-row ${state.expSelected === e.path ? 'selected' : ''}" data-path="${esc(e.path)}" title="Double-clic : afficher dans l'Explorateur">
    <div class="ratio-cell">${exportMedia(e, 'row-media')}</div></div>
    <div class="exp-main"><div class="exp-name">${esc(e.name)}</div><div class="exp-sub">${esc(e.project)}${e.rel.length ? ' › ' + esc(e.rel.join(' › ')) : ''}</div></div>
    <div class="exp-ver">${e.version ? `<span class="ver ${e.final ? 'final' : ''}">${esc(e.version)}</span>` : '<span class="ver none">—</span>'}${latest ? '<span class="latest">Dernière</span>' : ''}</div>
    <div class="exp-fmt" title="${e.width ? e.width + '×' + e.height : 'Résolution inconnue'}${e.codec ? ' · ' + esc(e.codec) : ''}"><b>${esc(e.aspect)}${e.resolution ? ` <em>${esc(e.resolution)}</em>` : ''}</b><span>${esc(e.ext)}${e.codec ? ' · ' + esc(e.codec) : ''}${e.width ? ' · ' + e.width + '×' + e.height : ''}</span></div>
    <div class="exp-dur">${fmtDur(e.duration)}</div>
    <div class="exp-size">${fmtBytes(e.size)}</div>
    <div class="exp-date">${relTime(e.mtime)}</div>
    <div class="exp-acts"><button class="btn sm ghost icon-only" data-play title="Lire">${icon('play')}</button><button class="btn sm ghost icon-only" data-reveal title="Afficher dans le dossier">${icon('folderOpen')}</button></div>
  </div>`;
}

function renderExports() {
  const list = $('#exp-list');
  const filters = $('#exp-filters');
  if (!state.exports) {
    filters.innerHTML = '';
    list.innerHTML = Array.from({ length: 6 }, () => '<div class="exp-row skeleton"><div class="sk" style="height:28px;width:28px"></div><div class="sk" style="height:30px"></div></div>').join('');
    return;
  }
  const all = state.exports;
  if (!all.length) {
    filters.innerHTML = '';
    list.innerHTML = `<div class="empty-state"><div class="big-ico">${icon('film')}</div><h3>Aucun export trouvé</h3><p>Coffile repère les vidéos rangées dans un dossier EXPORT, RENDU ou LIVRABLE,<br />celles avec une version dans le nom (V1, V2, VF…), et celles posées dans MONTAGE ou à la racine d'un projet.</p></div>`;
    return;
  }
  const count = (key) => all.reduce((m, e) => m.set(e[key], (m.get(e[key]) || 0) + 1), new Map());
  const aspects = [...count('aspect').entries()].sort((a, b) => b[1] - a[1]);
  const exts = [...count('ext').entries()].sort((a, b) => b[1] - a[1]);
  setHTML(
    filters,
    `<div class="fgroup"><span class="flabel">Format</span>
      <button class="fchip ${state.expAspect === 'all' ? 'active' : ''}" data-aspect="all">Tous <i>${all.length}</i></button>
      ${aspects.map(([a, n]) => `<button class="fchip ${state.expAspect === a ? 'active' : ''}" data-aspect="${esc(a)}"><span class="ratio mini" style="${miniRatio(a)}"></span>${esc(a)} <i>${n}</i></button>`).join('')}
    </div>
    <div class="fgroup"><span class="flabel">Fichier</span>
      <button class="fchip ${state.expExt === 'all' ? 'active' : ''}" data-ext="all">Tous</button>
      ${exts.map(([x, n]) => `<button class="fchip ${state.expExt === x ? 'active' : ''}" data-ext="${esc(x)}">${esc(x)} <i>${n}</i></button>`).join('')}
    </div>`
  );

  const q = $('#exp-search').value.trim().toLowerCase();
  const items = all.filter(
    (e) => (state.expAspect === 'all' || e.aspect === state.expAspect) && (state.expExt === 'all' || e.ext === state.expExt) && (!q || e.name.toLowerCase().includes(q) || e.project.toLowerCase().includes(q))
  );
  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><h3>Aucun export</h3><p>Aucun export ne correspond à ces filtres.</p></div>`;
    return;
  }

  // Dernière version de chaque montage (même projet + même nom sans version).
  const latestByFamily = new Map();
  for (const e of all) {
    const k = e.projectDir + '|' + e.family;
    const cur = latestByFamily.get(k);
    if (!cur || e.versionRank > cur.versionRank || (e.versionRank === cur.versionRank && e.mtime > cur.mtime)) latestByFamily.set(k, e);
  }
  const isLatest = (e) => {
    const k = e.projectDir + '|' + e.family;
    const siblings = all.filter((x) => x.projectDir + '|' + x.family === k).length;
    return siblings > 1 && latestByFamily.get(k) === e;
  };
  const byVersion = (a, b) => b.versionRank - a.versionRank || b.mtime - a.mtime;

  const groups = new Map();
  const add = (key, title, sub, e) => {
    if (!groups.has(key)) groups.set(key, { title, sub, items: [] });
    groups.get(key).items.push(e);
  };
  for (const e of items) {
    if (state.expGroup === 'version') add(e.projectDir + '|' + e.family, e.familyLabel, e.project, e);
    else if (state.expGroup === 'format') add(e.aspect, e.aspect, ASPECT_NAMES[e.aspect] || '', e);
    else add(e.projectDir, e.project, '', e);
  }
  let arr = [...groups.values()];
  for (const g of arr) {
    if (state.expGroup === 'format') g.items.sort((a, b) => b.mtime - a.mtime);
    else if (state.expGroup === 'project') g.items.sort((a, b) => a.familyLabel.localeCompare(b.familyLabel, 'fr', { numeric: true }) || byVersion(a, b));
    else g.items.sort(byVersion);
    g.last = Math.max(...g.items.map((e) => e.mtime));
  }
  arr.sort(state.expGroup === 'format' ? (a, b) => b.items.length - a.items.length : (a, b) => b.last - a.last);

  const grid = state.expView === 'grid';
  list.classList.toggle('as-grid', grid);
  list.innerHTML =
    (grid ? '' : `<div class="exp-head"><span></span><span>Export</span><span>Version</span><span>Format</span><span>Durée</span><span>Taille</span><span>Date</span><span></span></div>`) +
    arr
      .map((g) => {
        const sub =
          state.expGroup === 'version'
            ? `${esc(g.sub)} · ${plural(g.items.length, 'version', 'versions')}`
            : `${g.sub ? esc(g.sub) + ' · ' : ''}${plural(g.items.length, 'export', 'exports')}`;
        const head = state.expGroup === 'format' ? `<span class="ratio mini big" style="${miniRatio(g.title)}"></span>` : state.expGroup === 'version' ? icon('layers') : icon('folder');
        const body = grid ? `<div class="ec-grid">${g.items.map((e) => exportCard(e, isLatest(e))).join('')}</div>` : g.items.map((e) => exportRow(e, isLatest(e))).join('');
        const rnBtn = state.expGroup === 'project' ? `<button class="btn sm rename-btn eg-rename" data-rename="${esc(g.items[0].projectDir)}">${icon('wand')}Auto rename</button>` : '';
        return `<div class="exp-group"><div class="eg-head">${head}<span class="eg-title">${esc(g.title)}</span><span class="eg-sub">${sub}</span>${rnBtn}</div>${body}</div>`;
      })
      .join('');
  hydrateThumbs(list);
}

function miniRatio(label) {
  const m = /^([\d.]+):([\d.]+)$/.exec(label || '');
  if (!m) return 'width:12px;height:12px;border-style:dashed';
  const w = Number(m[1]);
  const h = Number(m[2]);
  const max = 14;
  return `width:${w >= h ? max : Math.max(6, Math.round((max * w) / h))}px;height:${h >= w ? max : Math.max(6, Math.round((max * h) / w))}px`;
}

function selectExport(path, scroll) {
  state.expSelected = path;
  $$('#exp-list [data-path]').forEach((r) => r.classList.toggle('selected', r.dataset.path === path));
  if (scroll) {
    const row = $$('#exp-list [data-path]').find((r) => r.dataset.path === path);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }
}

// ---------- Auto rename des exports ----------
// Nouveau nom : titre_version_format_date.ext (ex. SpotNike_V2_16x9_010126.mp4).
// La version est reprise telle qu'écrite dans le nom actuel ; sans version, le fichier est ignoré
// (sauf si l'utilisateur la saisit dans l'aperçu).
const rn = { dir: null, title: '', overrides: {}, result: null, busy: false };

function dateCode(ms) {
  const d = new Date(ms);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(d.getDate())}${p2(d.getMonth() + 1)}${String(d.getFullYear()).slice(-2)}`;
}

function formatCode(aspect) {
  if (!aspect || aspect === 'Inconnu') return '';
  return aspect.replace(/[:×]/g, 'x');
}

function renameItems() {
  return (state.exports || [])
    .filter((e) => e.projectDir === rn.dir)
    .sort((a, b) => a.familyLabel.localeCompare(b.familyLabel, 'fr', { numeric: true }) || b.versionRank - a.versionRank || b.mtime - a.mtime);
}

function renamePlan() {
  const title = sanitizeName(rn.title.trim());
  const used = new Set();
  return renameItems().map((e) => {
    const version = (rn.overrides[e.path] ?? e.versionRaw ?? '').trim();
    const ext = (e.name.match(/\.[^.]+$/) || [''])[0];
    if (!title) return { e, status: 'notitle' };
    if (!version) return { e, status: 'noversion' };
    const parts = { t: title, v: sanitizeName(version), f: formatCode(e.aspect), d: dateCode(e.created || e.mtime) };
    const base = [parts.t, parts.v, parts.f, parts.d].filter(Boolean).join('_');
    const dir = e.path.slice(0, e.path.length - e.name.length).toLowerCase();
    let name = base + ext;
    let i = 2;
    while (used.has(dir + name.toLowerCase())) name = `${base}_${i++}${ext}`;
    used.add(dir + name.toLowerCase());
    return { e, parts, name, suffix: name.slice(base.length, name.length - ext.length), ext, status: name === e.name ? 'same' : 'rename' };
  });
}

function openRename(dir) {
  const projects = [...new Map((state.exports || []).map((e) => [e.projectDir, e.project])).entries()];
  if (!projects.length) {
    toast('Aucun export à renommer.', 'err');
    return;
  }
  const sel = state.expSelected && (state.exports || []).find((e) => e.path === state.expSelected);
  rn.dir = dir || (sel ? sel.projectDir : projects[0][0]);
  rn.title = ((state.settings.projects || {})[rn.dir] || {}).renameTitle || '';
  rn.overrides = {};
  rn.result = null;
  $('#rename-modal').classList.remove('hidden');
  renderRename();
  setTimeout(() => $('#rn-title') && $('#rn-title').focus(), 50);
}

function closeRename() {
  if (rn.busy) return;
  $('#rename-modal').classList.add('hidden');
  stopPreview();
}

function renderRename() {
  const body = $('#rename-body');
  const projects = [...new Map((state.exports || []).map((e) => [e.projectDir, e.project])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  const meta = metaFor(rn.dir, (projects.find((p) => p[0] === rn.dir) || [])[1]);
  body.innerHTML = `
    <button class="btn ghost icon-only modal-close" data-rn-close title="Fermer">${icon('x')}</button>
    <div class="rn-head">
      <div class="rn-ico">${icon('wand')}</div>
      <div><h2>Auto rename</h2><p class="muted">Renomme tous les exports d'un projet au même format.</p></div>
    </div>
    <div class="rn-pattern"><span class="t">titre</span>_<span class="v">version</span>_<span class="f">format</span>_<span class="d">date</span><span class="x">.mp4</span>
      <span class="rn-pattern-ex">ex. SpotNike_V2_16x9_010126.mp4 · la date est celle de l'export (JJMMAA)</span></div>
    <div class="rn-form">
      <label>Projet
        <div class="select-wrap rn-project">${badge(meta, 'xs')}<select id="rn-project">${projects.map(([d, n]) => `<option value="${esc(d)}" ${d === rn.dir ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
      </label>
      <label>Titre
        <div class="input-wrap"><span class="input-ico" data-icon="clapper">${icon('clapper')}</span><input id="rn-title" type="text" placeholder="Ex : SpotNike" maxlength="80" spellcheck="false" autocomplete="off" value="${esc(rn.title)}" /></div>
      </label>
    </div>
    <div class="rn-list" id="rn-list"></div>
    <div class="rn-foot" id="rn-foot"></div>`;
  renderRenameList();
}

function partsHtml(r) {
  return `<span class="t">${esc(r.parts.t)}</span>_<span class="v">${esc(r.parts.v)}</span>${r.parts.f ? `_<span class="f">${esc(r.parts.f)}</span>` : ''}_<span class="d">${esc(r.parts.d)}</span>${esc(r.suffix)}<span class="x">${esc(r.ext)}</span>`;
}

function renderRenameList() {
  const list = $('#rn-list');
  const foot = $('#rn-foot');
  if (!list) return;
  const focus = document.activeElement && document.activeElement.dataset.verPath;
  const caret = focus ? document.activeElement.selectionStart : 0;

  if (rn.result) {
    const { done, errors } = rn.result;
    list.innerHTML =
      done.map((d) => `<div class="rn-row ok"><div class="rn-state">${icon('check')}</div><div class="rn-before">${esc(d.from.split(/[\\/]/).pop())}</div><div class="rn-arrow">${icon('arrow')}</div><div class="rn-after">${esc(d.to.split(/[\\/]/).pop())}</div></div>`).join('') +
      errors.map((x) => `<div class="rn-row err"><div class="rn-state">${icon('alert')}</div><div class="rn-before">${esc(x.from.split(/[\\/]/).pop())}</div><div class="rn-arrow"></div><div class="rn-after">${esc(x.error)}</div></div>`).join('');
    foot.innerHTML = `<span class="rn-sum">${icon('check')}${plural(done.length, 'export renommé', 'exports renommés')}${errors.length ? ` · <b class="err-text">${errors.length} erreur(s)</b>` : ''}</span>
      <div class="rn-btns">${done.length && !rn.result.undone ? `<button class="btn" data-rn-undo>${icon('undo')}Annuler le renommage</button>` : ''}<button class="btn primary" data-rn-close>Terminé</button></div>`;
    return;
  }

  const plan = renamePlan();
  if (!plan.length) {
    list.innerHTML = '<div class="empty">Aucun export dans ce projet.</div>';
    foot.innerHTML = '';
    return;
  }
  list.innerHTML = plan
    .map((r) => {
      const e = r.e;
      let after;
      if (r.status === 'notitle') after = '<span class="rn-wait">Saisis un titre…</span>';
      else if (r.status === 'noversion')
        after = `<span class="rn-nover">${icon('alert')}Pas de version dans le nom</span><input class="rn-ver" data-ver-path="${esc(e.path)}" placeholder="V1" maxlength="20" value="${esc(rn.overrides[e.path] || '')}" spellcheck="false" />`;
      else after = `<span class="rn-name">${partsHtml(r)}</span>`;
      const state2 = r.status === 'same' ? `<span class="rn-chip same">${icon('check')}Déjà bon</span>` : r.status === 'noversion' ? `<span class="rn-chip skip">Ignoré</span>` : r.status === 'rename' ? `<span class="rn-chip go">À renommer</span>` : '';
      return `<div class="rn-row ${r.status}">
        <div class="mini-thumb thumb" ${thumbAttrs(e, 'video')} ${PLAYABLE_EXT.test(e.ext) ? `data-preview="${esc(e.path)}"` : ''}><div class="cover-fallback">${icon('film')}</div><div class="preview-bar"></div></div>
        <div class="rn-before" title="${esc(e.name)}">${esc(e.name)}<small>${esc(e.aspect)} · ${new Date(e.created || e.mtime).toLocaleDateString('fr-FR')}${e.rel.length ? ' · ' + esc(e.rel.join(' › ')) : ''}</small></div>
        <div class="rn-arrow">${icon('arrow')}</div>
        <div class="rn-after">${after}</div>
        <div class="rn-status">${state2}</div>
      </div>`;
    })
    .join('');
  hydrateThumbs(list);
  if (focus) {
    const inp = $$('[data-ver-path]', list).find((i) => i.dataset.verPath === focus);
    if (inp) {
      inp.focus();
      inp.setSelectionRange(caret, caret);
    }
  }
  const n = plan.filter((r) => r.status === 'rename').length;
  const same = plan.filter((r) => r.status === 'same').length;
  const skip = plan.filter((r) => r.status === 'noversion').length;
  foot.innerHTML = `<span class="rn-sum">${n ? `<b>${plural(n, 'export à renommer', 'exports à renommer')}</b>` : 'Rien à renommer'}${same ? ` · ${same} déjà bon${same > 1 ? 's' : ''}` : ''}${skip ? ` · <span class="warn-text">${skip} sans version (ignoré${skip > 1 ? 's' : ''})</span>` : ''}</span>
    <div class="rn-btns"><button class="btn" data-rn-close>Annuler</button><button class="btn primary" data-rn-go ${n && !rn.busy ? '' : 'disabled'}>${rn.busy ? '<span class="spinner"></span>' : icon('wand')}Renommer ${n || ''}</button></div>`;
}

async function runRename() {
  const ops = renamePlan()
    .filter((r) => r.status === 'rename')
    .map((r) => ({ from: r.e.path, to: r.name }));
  if (!ops.length) return;
  rn.busy = true;
  renderRenameList();
  await api.setProjectMeta(rn.dir, { renameTitle: rn.title.trim() });
  const res = await api.renameExports(ops);
  rn.busy = false;
  rn.result = res;
  state.settings = await api.getSettings();
  await reloadAfterRename();
  renderRenameList();
  if (res.errors.length) toast(`${res.errors.length} export(s) n'ont pas pu être renommés`, 'err');
  else toast(plural(res.done.length, 'export renommé', 'exports renommés'));
}

async function undoRename() {
  if (!rn.result || rn.busy) return;
  rn.busy = true;
  const ops = rn.result.done.map((d) => ({ from: d.to, to: d.from.split(/[\\/]/).pop() }));
  const res = await api.renameExports(ops);
  rn.busy = false;
  rn.result = { done: res.done.map((d) => ({ from: d.from, to: d.to })), errors: res.errors, undone: true };
  await reloadAfterRename();
  renderRenameList();
  toast(res.errors.length ? 'Annulation partielle' : 'Renommage annulé', res.errors.length ? 'err' : 'ok');
}

async function reloadAfterRename() {
  state.exports = await api.scanExports();
  state.library = null;
  if (state.view === 'exports') renderExports();
}

// ---------- Messagerie : Gmail et Google Chat ----------
const ib = {
  tab: 'mail',
  account: '',
  filter: 'all',
  q: '',
  mail: { items: [], next: null, loading: false, error: null, selected: null, full: {}, key: '' },
  chat: { spaces: null, space: null, msgs: {}, loading: false, error: null, key: '' },
  names: {}, // nom du projet saisi, par message
  labels: {}, // nom du dossier saisi, par lien
  include: {}, // liens décochés
  sheet: null // fiche plein écran ouverte : { kind, id }
};
const MONTAGE_Q = '(drive.google.com OR rush OR rushes OR montage OR tournage OR wetransfer OR we.tl OR footage)';

const viaChromeMode = () => (state.settings.inboxMode || 'chrome') === 'chrome';

// Comptes connectés dans le Chrome de Coffile (identifiant « chrome:email »).
function chromeAccs() {
  return (state.settings.chromeAccounts || []).map((a) => ({ email: `chrome:${a.email}`, display: a.email, name: a.name, picture: null, chrome: true, features: { gmail: true, chat: true } }));
}

const accLabel = (account) => String(account || '').replace(/^chrome:/, '');

function inboxAccounts() {
  return viaChromeMode() ? chromeAccs() : (state.settings.googleAccounts || []).filter((a) => !a.invalid);
}

function currentInboxAccount() {
  const accs = inboxAccounts();
  if (!accs.some((a) => a.email === ib.account)) ib.account = (accs.find((a) => a.email === state.settings.defaultAccount) || accs[0] || {}).email || '';
  return accs.find((a) => a.email === ib.account) || null;
}

function colorOf(str) {
  return PROJECT_COLORS[hashStr(str || '?') % PROJECT_COLORS.length];
}

function shortDate(ms) {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (now - d < 6 * 86400e3) return d.toLocaleDateString('fr-FR', { weekday: 'short' });
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function inboxNotice(iconName, title, text, actions = '') {
  return `<div class="inbox-notice"><div class="big-ico">${icon(iconName)}</div><h3>${title}</h3><p>${text}</p><div class="inbox-notice-acts">${actions}</div></div>`;
}

// Message affiché quand le compte n'a pas (encore) accès à Gmail / Chat, ou en cas d'erreur.
function chromeLoginNotice() {
  return inboxNotice(
    'chrome',
    'Connecte-toi à Google dans le Chrome de Coffile',
    "Coffile ouvre son propre Chrome (profil « Coffile »). Connecte-toi une fois : la fenêtre se cache ensuite derrière l'app et Coffile lit tes mails et ton Chat tout seul. Il n'y a ni clé ni réglage à faire.",
    `<button class="btn primary" data-chrome-login="">${icon('chrome')}Se connecter à Google</button>`
  );
}

function inboxGate(feature) {
  const svc = feature === 'gmail' ? 'Gmail' : 'Google Chat';
  if (viaChromeMode()) {
    if (!state.settings.chromeAvailable)
      return inboxNotice('alert', 'Google Chrome est nécessaire', "Coffile pilote Chrome pour lire ta messagerie. Installe Google Chrome, puis relance Coffile.", `<button class="btn primary" data-url="https://www.google.com/chrome/">${icon('external')}Télécharger Chrome</button>`);
    if (!chromeAccs().length) return chromeLoginNotice();
    return null;
  }
  if (!state.settings.googleClient || !state.settings.googleClient.configured || !inboxAccounts().length) {
    return inboxNotice('user', 'Connecte ton compte Google', `Coffile lit tes ${feature === 'gmail' ? 'mails' : 'conversations'} avec le compte Google connecté dans Chrome, en lecture seule.`, `<button class="btn primary" data-connect>${icon('plus')}Connecter un compte Google</button>`);
  }
  const acc = currentInboxAccount();
  if (!acc.features || !acc.features[feature]) {
    return inboxNotice(
      feature === 'gmail' ? 'mail' : 'chat',
      `Autoriser ${svc}`,
      `Pour afficher ${feature === 'gmail' ? 'tes mails' : 'tes messages Chat'}, Coffile a besoin d'un accès <b>en lecture seule</b> à ${svc} pour <b>${esc(acc.email)}</b>. Chrome s'ouvre sur la page Google : coche la case ${svc} et valide.`,
      `<button class="btn primary" data-authorize="${feature}">${icon('key')}Autoriser ${svc}</button>`
    );
  }
  return null;
}

function inboxErrorHtml(err, feature) {
  const lib = feature === 'gmail' ? 'https://console.cloud.google.com/apis/library/gmail.googleapis.com' : 'https://console.cloud.google.com/apis/library/chat.googleapis.com';
  if (err.code === 'SCOPE') return inboxNotice('key', 'Accès non autorisé', esc(err.error), `<button class="btn primary" data-authorize="${feature}">${icon('key')}Autoriser</button>`);
  if (err.code === 'API_DISABLED')
    return inboxNotice('alert', "API non activée", `${esc(err.error)} Active-la dans le projet Google Cloud « Coffile » (un clic), puis actualise.`, `<button class="btn primary" data-url="${lib}">${icon('external')}Activer l'API</button><button class="btn" data-inbox-retry>${icon('refresh')}Réessayer</button>`);
  if (err.code === 'CHAT_APP')
    return inboxNotice('alert', 'Configuration Chat requise', `Google demande de renseigner une fiche « application Chat » (nom, icône, description) dans le projet Google Cloud avant de pouvoir lire les messages. ${esc(err.error)}`, `<button class="btn primary" data-url="https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat">${icon('external')}Configurer</button><button class="btn" data-inbox-retry>${icon('refresh')}Réessayer</button>`);
  if (err.code === 'WORKSPACE_ONLY')
    return inboxNotice('alert', 'Google Chat indisponible pour ce compte', `Google ne donne accès aux messages Chat qu'aux comptes <b>Google Workspace</b> (adresse pro), pas aux comptes Gmail personnels. Détail : ${esc(err.error)}`, '');
  if (err.code === 'LOGIN' || err.code === 'NO_CHROME') return err.code === 'LOGIN' ? chromeLoginNotice() : inboxGate(feature) || inboxNotice('alert', 'Chrome introuvable', esc(err.error));
  if (err.code === 'CHAT_SCRAPE')
    return inboxNotice('alert', 'Lecture du Chat impossible', `${esc(err.error)} La lecture de Google Chat par Chrome est expérimentale. Tu peux passer la messagerie en mode « API Google » dans les Réglages.`, `<button class="btn" data-inbox-retry>${icon('refresh')}Réessayer</button><button class="btn" data-chrome-show>${icon('external')}Voir la fenêtre Chrome</button>`);
  if (err.code === 'AUTH') return inboxNotice('alert', 'Connexion expirée', esc(err.error), `<button class="btn primary" data-connect>${icon('refresh')}Reconnecter</button>`);
  return inboxNotice('alert', 'Erreur', esc(err.error), `<button class="btn" data-inbox-retry>${icon('refresh')}Réessayer</button>`);
}

function renderInboxBar() {
  const accs = inboxAccounts();
  const acc = currentInboxAccount();
  const sel = $('#inbox-account');
  setHTML(sel, accs.length ? accs.map((a) => `<option value="${esc(a.email)}">${esc(accLabel(a.email))}</option>`).join('') : '<option value="">Aucun compte</option>');
  sel.value = ib.account;
  setHTML($('#inbox-avatar'), acc ? avatar(acc) : '');
  $$('#inbox-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.t === ib.tab));
  $$('#inbox-filter button').forEach((b) => b.classList.toggle('active', b.dataset.f === ib.filter));
  $('#inbox-search-wrap').classList.toggle('hidden', ib.tab !== 'mail');
}

// ----- Filtre des expéditeurs, « Pas un montage », « C'est un montage » -----
// Les règles s'appliquent par-dessus l'analyse : a.raw garde ce que la détection a trouvé.
function senderKey(m, kind) {
  return kind === 'chat' ? `chat:${String(m.sender || '').trim().toLowerCase()}` : String((m.from && m.from.email) || '').trim().toLowerCase();
}

function applyMontageRules() {
  const s = state.settings || {};
  const f = s.inboxFilter || {};
  const only = f.enabled && f.senders && f.senders.length ? new Set(f.senders) : null;
  const dismissed = new Set(s.inboxDismissed || []);
  const forced = new Set(s.inboxForced || []);
  const apply = (m, kind) => {
    const a = m && m.analysis;
    if (!a) return;
    if (a.raw === undefined) {
      a.raw = a.isMontage;
      a.rawLevel = a.level;
    }
    let v = a.raw;
    a.forced = forced.has(m.id);
    if (a.forced) v = true;
    if (dismissed.has(m.id)) v = false;
    a.filteredOut = !!(only && v && !only.has(senderKey(m, kind)));
    if (a.filteredOut) v = false;
    a.isMontage = v;
    a.level = v ? (a.rawLevel === 'none' ? 'medium' : a.rawLevel) : 'none';
  };
  for (const m of ib.mail.items) apply(m, 'mail');
  for (const m of Object.values(ib.mail.full)) apply(m, 'mail');
  for (const d of Object.values(ib.chat.msgs)) for (const m of d.messages || []) apply(m, 'chat');
}

const learnPayload = (kind, msg) => ({ subject: msg.subject || '', text: msg.text || '', sender: kind === 'mail' ? (msg.from && msg.from.name) || '' : msg.sender || '' });

async function markMontage(kind, id, yes) {
  const msg = findMessage(kind, id);
  const s = state.settings;
  const dismissed = new Set(s.inboxDismissed || []);
  const forced = new Set(s.inboxForced || []);
  if (yes) {
    forced.add(id);
    dismissed.delete(id);
  } else {
    dismissed.add(id);
    forced.delete(id);
  }
  state.settings = await api.setSettings({ inboxDismissed: [...dismissed].slice(-3000), inboxForced: [...forced].slice(-3000) });
  if (msg) api.inboxLearn(learnPayload(kind, msg), yes);
  toast(yes ? "Noté : c'est un montage. Coffile s'en souviendra pour les prochains messages." : "Noté : pas un montage. Coffile s'en souviendra pour les prochains messages.");
  updateInboxBadge();
  renderInbox();
  if (ib.sheet) renderSheet();
}

// Barre sous un message qui n'est pas (ou plus) compté comme montage.
function notMontageBar(kind, msg) {
  const a = msg.analysis || {};
  const why = a.filteredOut
    ? `Pas compté comme montage : ${esc(kind === 'mail' ? msg.from.email : msg.sender)} n'est pas dans ton filtre.`
    : a.raw && !a.isMontage
      ? 'Tu as indiqué que ce message n\'est pas un montage.'
      : 'Aucune demande de montage détectée dans ce message.';
  return `<div class="sheet-none">${icon('sparkles')}<span>${why}</span><button class="btn sm ghost" data-is-montage="${kind}|${esc(msg.id)}">${icon('thumbUp')}C'est un montage</button></div>`;
}

// ----- Ce que Coffile a compris du message -----
function detailsChips(a, src) {
  const d = a && a.details;
  if (!d) return '';
  const bits = [];
  if (d.tasks.length) bits.push(`${icon('checklist')}${plural(d.tasks.length, 'chose à faire', 'choses à faire')}`);
  if (d.feedback.length) bits.push(`${icon('clock')}${plural(d.feedback.length, 'retour', 'retours')}`);
  if (d.transcript) bits.push(`${icon('quote')}Transcription`);
  if (d.sendTo.length) bits.push(`${icon('send')}Envoyer à ${esc(d.sendTo[0])}`);
  d.software.slice(0, 2).forEach((x) => bits.push(esc(x)));
  if (!bits.length) return '';
  return `<button class="md-chips" data-sheet="${src.kind}|${esc(src.id)}" title="Voir tout ce que Coffile a compris">${bits.map((b) => `<span>${b}</span>`).join('')}</button>`;
}

function detailsHtml(a, inCard) {
  const d = a && a.details;
  if (!d || (!d.count && !d.points.length)) return '';
  const sec = (ic, title, body, cls = '') => `<div class="md-sec ${cls}"><div class="md-title">${icon(ic)}${title}</div>${body}</div>`;
  const chips = (list, cls = '') => `<div class="md-tags">${list.map((x) => `<span class="mchip ${cls}">${x}</span>`).join('')}</div>`;
  const parts = [];
  if (d.summary) parts.push(sec('mail', 'En bref', `<p class="md-summary">${esc(d.summary)}</p>`, 'wide'));
  if (d.deadline) {
    const dl = deadlineInfo(a) || { text: d.deadline.label, cls: '' };
    parts.push(sec('calendar', 'Date limite', `<div class="md-dl"><span class="mchip warn dl-${dl.cls}">${icon('calendar')}${esc(dl.text)}</span>${dl.full ? `<span class="md-dl-full">${esc(dl.full)}</span>` : ''}${d.urgent ? `<span class="mchip urgent">${icon('flame')}Urgent</span>` : ''}</div><p class="md-line">« ${esc(d.deadline.sentence)} »</p>`, 'wide'));
  } else if (d.urgent) parts.push(sec('flame', 'Urgence', `<span class="mchip urgent">${icon('flame')}Urgent</span>`));
  if (d.tasks.length) parts.push(sec('checklist', 'À faire', `<ul class="md-tasks">${d.tasks.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`, 'wide'));
  if (d.feedback.length) parts.push(sec('clock', 'Retours avec timecodes', `<ul class="md-fb">${d.feedback.map((f) => `<li><span class="tc ${f.tc ? '' : 'none'}">${esc(f.tc || '•')}</span><span>${esc(f.text.replace(f.tc, '').replace(/^[\s\-–—:à]+/, '') || f.text)}</span></li>`).join('')}</ul>`, 'wide'));
  if (d.sendTo.length || d.delivery.length) parts.push(sec('send', 'Envoyer à', chips([...d.sendTo.map(esc), ...d.delivery.map((x) => `${icon('link')}${esc(x)}`)])));
  if (d.people.length) parts.push(sec('users', 'Personnes citées', `<div class="md-tags">${d.people.map((p) => `<span class="mchip" title="${esc(p.context)}">${icon('user')}${esc(p.name)}</span>`).join('')}</div>`));
  if (d.software.length) parts.push(sec('clapper', 'Logiciels', chips(d.software.map(esc))));
  if (d.points.length) parts.push(sec('sparkles', 'Points clés', chips(d.points.map(esc))));
  if (d.music.length || d.musicLinks.length) parts.push(sec('music', 'Musique', `${d.music.map((x) => `<p class="md-line">${esc(x)}</p>`).join('')}${d.musicLinks.map((u) => `<button class="btn sm ghost md-link" data-url="${esc(u)}">${icon('external')}${esc(u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40))}</button>`).join('')}`));
  if (d.refs.length) parts.push(sec('star', 'Références', `<div class="md-tags">${d.refs.map((r) => `<button class="mchip md-ref" data-url="${esc(r.url)}">${icon('external')}${esc(r.service)}</button>`).join('')}</div>`));
  if (d.budget.length) parts.push(sec('euro', 'Budget', chips(d.budget.map(esc), 'ok')));
  if (d.phones.length) parts.push(sec('phone', 'Téléphone', `<div class="md-tags">${d.phones.map((p) => `<button class="mchip" data-copy="${esc(p)}" title="Copier">${esc(p)}</button>`).join('')}</div>`));
  if (d.transcript) {
    const t = d.transcript;
    parts.push(
      sec(
        'quote',
        `Transcription <i>${plural(t.lines, 'ligne', 'lignes')}</i>`,
        `${t.intro ? `<p class="md-line">« ${esc(t.intro)} »</p>` : ''}<details class="md-transcript" ${inCard ? '' : 'open'}><summary>Afficher le texte</summary><pre>${esc(t.text)}</pre></details><button class="btn sm ghost" data-copy="${esc(t.text)}">${icon('copy')}Copier la transcription</button>`,
        'wide'
      )
    );
  }
  const learned =
    (a.nn != null ? `<span class="md-learn" title="Avis du réseau de neurones de Coffile (hors ligne), qui apprend aussi de tes choix">${icon('sparkles')}Réseau : ${a.nn} % montage</span>` : '') +
    (a.learned != null ? `<span class="md-learn" title="D'après tes choix précédents (projets créés, « Pas un montage »)">Appris : ${a.learned} %</span>` : '');
  return `<div class="mail-details ${inCard ? 'in-card' : ''}"><div class="md-head"><span>${icon('sparkles')}Ce que Coffile a compris</span><span class="md-badges">${learned}</span></div><div class="md-grid">${parts.join('')}</div></div>`;
}

// ----- Bouton « Filtre » et sa fenêtre -----
const SENDERS_KEY = 'coffile-known-senders';
function knownSenders() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SENDERS_KEY)) || {};
  } catch {}
  const add = (key, name, email, kind, montage, date) => {
    if (!key) return;
    const s = saved[key] || (saved[key] = { name, email, kind, n: 0, montage: 0, last: 0, ids: [] });
    s.name = name || s.name;
    s.ids = s.ids || [];
    if (!s.ids.includes(montage.id)) {
      s.ids = [...s.ids, montage.id].slice(-200);
      s.n++;
      if (montage.raw) s.montage++;
    }
    s.last = Math.max(s.last || 0, date || 0);
  };
  for (const m of ib.mail.items) add(senderKey(m, 'mail'), m.from.name, m.from.email, 'mail', { id: m.id, raw: m.analysis && m.analysis.raw }, m.date);
  for (const d of Object.values(ib.chat.msgs)) for (const m of d.messages || []) add(senderKey(m, 'chat'), m.sender, '', 'chat', { id: m.id, raw: m.analysis && m.analysis.raw }, m.date);
  try {
    localStorage.setItem(SENDERS_KEY, JSON.stringify(saved));
  } catch {}
  for (const key of (state.settings.inboxFilter || {}).senders || []) if (!saved[key]) saved[key] = { name: key.replace(/^chat:/, ''), email: key.startsWith('chat:') ? '' : key, kind: key.startsWith('chat:') ? 'chat' : 'mail', n: 0, montage: 0, last: 0 };
  return saved;
}

function renderFilterButton() {
  const f = (state.settings && state.settings.inboxFilter) || {};
  const btn = $('#sf-btn');
  if (!btn) return;
  const on = !!(f.enabled && (f.senders || []).length);
  btn.classList.toggle('on', !!f.enabled);
  $('#sf-count').textContent = f.enabled ? (f.senders || []).length : '';
  btn.title = on ? `Filtre activé : seuls ${plural(f.senders.length, 'expéditeur compte', 'expéditeurs comptent')} comme montages` : 'Filtre : seuls les expéditeurs choisis comptent comme montages';
}

const sf = { open: false, q: '' };

async function saveFilter(patch) {
  const cur = state.settings.inboxFilter || { enabled: false, senders: [] };
  state.settings = await api.setSettings({ inboxFilter: { ...cur, ...patch } });
  renderFilterButton();
  updateInboxBadge();
  renderInbox();
}

async function openFilter() {
  sf.open = true;
  sf.q = '';
  const pop = $('#sf-pop');
  const stats = await api.inboxModelStats().catch(() => null);
  const f = state.settings.inboxFilter || {};
  pop.innerHTML = `
    <div class="sf-head">
      <div><b>Filtre des montages</b><span>Seuls les messages des expéditeurs cochés peuvent être des montages. Les autres messages restent visibles.</span></div>
      <label class="switch" title="Activer / désactiver le filtre"><input type="checkbox" id="sf-on" ${f.enabled ? 'checked' : ''} /><span></span></label>
    </div>
    <div class="input-wrap search sf-search"><span class="input-ico">${icon('search')}</span><input id="sf-search" placeholder="Rechercher un nom ou une adresse…" spellcheck="false" /></div>
    <div class="sf-tools"><span id="sf-sel"></span><button class="btn sm ghost" data-sf-montage>Cocher ceux qui envoient des montages</button><button class="btn sm ghost" data-sf-none>Tout décocher</button></div>
    <div class="sf-list" id="sf-list"></div>
    <div class="sf-foot">${stats ? `${icon('sparkles')}<span>Coffile a appris de <b>${stats.pos + stats.neg}</b> choix (${stats.pos} montages, ${stats.neg} « pas un montage »).</span>${stats.pos + stats.neg ? '<button class="btn sm ghost" data-sf-reset>Oublier</button>' : ''}` : ''}</div>`;
  pop.classList.remove('hidden');
  renderFilterList();
  setTimeout(() => $('#sf-search').focus(), 30);
}

function closeFilter() {
  sf.open = false;
  $('#sf-pop').classList.add('hidden');
}

function renderFilterList() {
  const f = state.settings.inboxFilter || {};
  const sel = new Set(f.senders || []);
  const all = knownSenders();
  const q = sf.q.toLowerCase();
  const rows = Object.entries(all)
    .filter(([key, s]) => !q || `${s.name} ${s.email} ${key}`.toLowerCase().includes(q))
    .sort(([ka, a], [kb, b]) => sel.has(kb) - sel.has(ka) || b.montage - a.montage || b.n - a.n || (a.name || '').localeCompare(b.name || ''));
  $('#sf-sel').textContent = `${plural(sel.size, 'sélectionné', 'sélectionnés')} · ${plural(Object.keys(all).length, 'expéditeur', 'expéditeurs')}`;
  const hint = f.enabled && !sel.size ? `<div class="sf-hint">${icon('alert')}Coche au moins un expéditeur : tant que la liste est vide, tous les messages comptent.</div>` : '';
  $('#sf-list').innerHTML = hint + (rows.length
    ? rows
        .slice(0, 300)
        .map(
          ([key, s]) => `<label class="sf-row ${sel.has(key) ? 'on' : ''}">
            <input type="checkbox" data-sf="${esc(key)}" ${sel.has(key) ? 'checked' : ''} /><span class="check-box"></span>
            <span class="mi-avatar sm" style="--pc:${colorOf(s.email || key)}">${esc((s.name || '?')[0].toUpperCase())}</span>
            <span class="sf-who"><b>${esc(s.name || s.email)}</b><span>${esc(s.email || 'Google Chat')}${s.n ? ` · ${plural(s.n, 'message', 'messages')}` : ''}</span></span>
            ${s.montage ? `<span class="sf-tag">${icon('sparkles')}${s.montage}</span>` : ''}${s.kind === 'chat' ? '<span class="sf-tag chat">Chat</span>' : ''}
          </label>`
        )
        .join('')
    : `<div class="empty">${q ? 'Aucun expéditeur trouvé.' : 'Charge tes mails ou tes conversations pour voir les expéditeurs.'}</div>`);
}

// ----- Carte « Montage détecté » -----
function handledFor(id) {
  return (state.settings.inboxHandled || {})[id];
}

// Date limite affichée par rapport à aujourd'hui (« Aujourd'hui », « Demain 18h », « En retard »…).
const DL_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const DL_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const DL_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function deadlineInfo(a) {
  if (!a || !a.deadline) return null;
  if (!a.deadlineDate) return { text: a.deadline, cls: a.urgent ? 'urgent' : '' };
  const d = new Date(`${a.deadlineDate}T00:00:00`);
  const now = new Date();
  const days = Math.round((d - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  const at = a.deadlineTime ? ` ${a.deadlineTime.replace(':', 'h').replace(/h00$/, 'h')}` : a.deadlinePart ? ` ${a.deadlinePart}` : '';
  const full = `${DL_SHORT[d.getDay()]} ${d.getDate()} ${DL_MONTHS[d.getMonth()]}`;
  if (days < 0) return { text: `En retard · ${full}`, cls: 'late', full };
  if (days === 0) {
    const today = !a.deadlineTime && a.deadlinePart && /soir|matin|midi/.test(a.deadlinePart) ? `Ce ${a.deadlinePart}` : `Aujourd'hui${at}`;
    return { text: a.urgent ? `${today} · urgent` : today, cls: 'today', full };
  }
  if (days === 1) return { text: `Demain${at}`, cls: 'soon', full };
  if (days < 7) return { text: `${DL_DAYS[d.getDay()][0].toUpperCase()}${DL_DAYS[d.getDay()].slice(1)} ${d.getDate()} ${DL_MONTHS[d.getMonth()]}${at}`, cls: '', full };
  return { text: `${full}${at}`, cls: '', full };
}
function deadlineChip(a) {
  const dl = deadlineInfo(a);
  return dl ? `<span class="mchip warn dl-${dl.cls}" title="${esc(dl.full || '')}">${icon('calendar')}${esc(dl.text)}</span>` : '';
}

function montageInfo(a, client) {
  const cells = [];
  if (client) cells.push(`<div><span>Client</span><b>${esc(client)}</b></div>`);
  cells.push(`<div><span>Formats</span><b>${a.formats.length ? a.formats.map((f) => `<i class="fmt"><span class="ratio mini" style="${miniRatio(f)}"></span>${f}</i>`).join('') : '—'}</b></div>`);
  cells.push(`<div><span>Durée</span><b>${a.durations.join(' · ') || '—'}</b></div>`);
  const dl = deadlineInfo(a);
  cells.push(`<div><span>Date limite</span><b class="${dl ? `deadline dl-${dl.cls}` : ''}" title="${esc(dl && dl.full ? dl.full : '')}">${dl ? icon('calendar') + esc(dl.text) : '—'}</b></div>`);
  return cells.join('');
}

// Valeurs saisies dans les fiches (nom du projet, nom de chaque lien, liens cochés) :
// gardées pendant que les listes se rafraîchissent.
const linkKey = (srcId, i) => `${srcId}|${i}`;
const nameFor = (srcId, a) => (ib.names[srcId] != null ? ib.names[srcId] : a.name);
const labelFor = (srcId, i, d) => (ib.labels[linkKey(srcId, i)] != null ? ib.labels[linkKey(srcId, i)] : d.label || `Lien ${i + 1}`);
const included = (srcId, i) => ib.include[linkKey(srcId, i)] !== false;

function montageCard(a, src, big) {
  const done = handledFor(src.id);
  const multi = a.drive.length > 1;
  const nSel = a.drive.filter((d, i) => included(src.id, i)).length;
  const links = a.drive
    .map(
      (d, i) => `<div class="mc-link ${multi && !included(src.id, i) ? 'off' : ''}">
        ${multi ? `<label class="mc-check" title="Inclure ce lien"><input type="checkbox" data-inc-for="${esc(src.id)}" data-idx="${i}" ${included(src.id, i) ? 'checked' : ''} /><span class="check-box"></span></label>` : ''}
        <span class="mc-link-ico">${icon('drive')}</span>
        <div class="mc-link-text">
          ${d.context ? `<span class="mc-ctx">« ${esc(d.context)} »</span>` : ''}
          <b>${d.kind === 'folder' ? 'Dossier Google Drive' : d.kind === 'file' ? 'Fichier Google Drive' : 'Lien Google Drive'}</b>
          <span>${esc(d.url.replace(/^https?:\/\//, '').slice(0, 70))}</span>
        </div>
        ${
          multi
            ? `<label class="mc-label" title="Nom du dossier créé dans RUSHES (et IMAGES) pour ce lien"><span>Dossier</span><input data-label-for="${esc(src.id)}" data-idx="${i}" value="${esc(labelFor(src.id, i, d))}" spellcheck="false" /></label>`
            : ''
        }
        <button class="btn sm ghost icon-only" data-url="${esc(d.url)}" title="Ouvrir dans le navigateur">${icon('external')}</button>
        ${
          done || multi
            ? ''
            : `<button class="btn primary dl-btn" data-dl="${esc(d.url)}" data-src="${esc(src.id)}" data-kind="${src.kind}" data-account="${esc(src.account)}" title="Créer un nouveau projet">${icon('download')}Télécharger</button><button class="btn dl-btn add-btn" data-add-to="${esc(d.url)}" data-src="${esc(src.id)}" data-kind="${src.kind}" data-account="${esc(src.account)}" title="Ajouter à un projet existant (RUSHES / IMAGES)">${icon('folderOpen')}Ajouter à…</button>`
        }
      </div>`
    )
    .join('');
  const others = a.others
    .map(
      (o) =>
        `<div class="mc-link other"><span class="mc-link-ico">${icon('link')}</span><div class="mc-link-text">${o.context ? `<span class="mc-ctx">« ${esc(o.context)} »</span>` : ''}<b>${esc(o.service)}</b><span>Téléchargement à faire dans le navigateur</span></div><button class="btn sm" data-url="${esc(o.url)}">${icon('external')}Ouvrir</button></div>`
    )
    .join('');
  const vids = a.videoFiles.length ? `<div class="mc-attach">${icon('paperclip')}${plural(a.videoFiles.length, 'vidéo en pièce jointe', 'vidéos en pièce jointe')}</div>` : '';
  return `<div class="mcard ${big ? 'big' : ''} ${a.level}" data-card="${esc(src.id)}">
    <div class="mc-head">
      <span class="mc-badge">${icon('sparkles')}Montage détecté</span>
      <span class="mc-level">${a.level === 'strong' ? 'Très probable' : 'Probable'}</span>
      ${a.keywords.length ? `<span class="mc-kw">${a.keywords.slice(0, big ? 8 : 4).map((k) => `<i>${esc(k)}</i>`).join('')}</span>` : ''}
      ${big ? '' : `<button class="btn sm ghost mc-full" data-sheet="${src.kind}|${esc(src.id)}">${icon('external')}Ouvrir en grand</button>`}
      ${done ? '' : `<button class="btn sm ghost mc-no" data-not-montage="${src.kind}|${esc(src.id)}" title="Coffile s'en souviendra pour les prochains messages">${icon('thumbDown')}Pas un montage</button>`}
    </div>
    <div class="mc-grid">${montageInfo(a, src.client)}</div>
    ${big ? detailsHtml(a, true) : detailsChips(a, src)}
    ${
      done
        ? `<div class="mc-done">${icon('check')}<span>Projet créé : <b>${esc(done.name)}</b></span><button class="btn sm" data-open="${esc(done.dir)}">${icon('folderOpen')}Ouvrir</button><button class="btn sm ghost" data-detail-open="${esc(done.dir)}">Détails</button></div>`
        : a.drive.length
          ? `<label class="mc-name"><span>Nom du projet</span><div class="input-wrap"><span class="input-ico">${icon('clapper')}</span><input data-name-for="${esc(src.id)}" value="${esc(nameFor(src.id, a))}" spellcheck="false" /></div></label>`
          : ''
    }
    ${multi ? `<div class="mc-hint">${icon('folder')}Chaque lien est rangé dans un dossier à son nom : <b>RUSHES/nom</b> pour les vidéos, <b>IMAGES/nom</b> pour les images.</div>` : ''}
    <div class="mc-links">${links}${others}</div>
    ${!done && a.drive.length ? aeToggleHtml(src.id) : ''}
    ${
      multi && !done
        ? `<div class="dl-all-row"><button class="btn primary dl-all" data-dl-all="${esc(src.id)}" data-kind="${src.kind}" data-account="${esc(src.account)}" ${nSel ? '' : 'disabled'}>${icon('download')}Télécharger ${nSel === a.drive.length ? `les ${nSel} liens` : `${plural(nSel, 'lien', 'liens')} sur ${a.drive.length}`} dans un nouveau projet</button><button class="btn dl-all add-btn" data-add-all="${esc(src.id)}" data-kind="${src.kind}" data-account="${esc(src.account)}" ${nSel ? '' : 'disabled'} title="Ajouter à un projet existant">${icon('folderOpen')}Ajouter à un projet…</button></div>`
        : ''
    }
    ${vids}
  </div>`;
}

// Case AUTOEDIT d'une fiche de montage (décochée par défaut, retenue tant que la liste se redessine).
function aeToggleHtml(id) {
  return `<label class="ae-toggle mc-ae"><input type="checkbox" data-ae-for="${esc(id)}" ${state.aeFor.has(id) ? 'checked' : ''} /><span class="ae-t-text"><b>${icon('wand')}AUTOEDIT</b><span>Après le téléchargement : classer les rushes, bout à bout sans les blancs, images et sound effects, puis Premiere.</span></span></label>`;
}

// ----- Pause café en plein écran (bouton Jouer, et pendant la création d'un projet) -----
function openDino(withJob) {
  state.dinoJob = !!withJob;
  $('#dino-full').classList.remove('hidden');
  renderDinoJob();
  document.activeElement && document.activeElement.blur && document.activeElement.blur();
}

function closeDino() {
  $('#dino-full').classList.add('hidden');
  state.dinoJob = false;
}

// Avancement du projet affiché en haut du jeu.
function renderDinoJob() {
  const box = $('#df-job');
  const s = state.job;
  const show = state.dinoJob && s && s.status === 'running';
  box.classList.toggle('hidden', !show);
  $('#df-close').innerHTML = show ? `${icon('list')}Voir le détail` : `${icon('x')}Fermer`;
  if (!show) return;
  const pct = computePercent(s);
  const step = STEPS.find((d) => (s.steps[d.key] || {}).status === 'active');
  const sizesKnown = s.files.length && s.files.every((f) => f.size);
  const stats = [
    s.bytesTotal && sizesKnown ? `${fmtBytes(s.bytesDone)} / ${fmtBytes(s.bytesTotal)}` : s.bytesDone ? fmtBytes(s.bytesDone) : '',
    s.speed > 1024 ? `${fmtBytes(s.speed)}/s` : '',
    sizesKnown && s.speed > 1024 ? `reste ${fmtEta((s.bytesTotal - s.bytesDone) / s.speed)}` : '',
    s.files.length ? `${s.files.filter((f) => f.status === 'done').length}/${s.files.length} fichiers` : ''
  ].filter(Boolean);
  $('#df-name').textContent = s.name;
  $('#df-step').textContent = step ? `${stepLabel(step, s)}${stats.length ? ' · ' : ''}${stats.join(' · ')}` : stats.join(' · ');
  $('#df-pct').textContent = `${pct} %`;
  const bar = $('#df-bar');
  bar.style.width = `${pct}%`;
  bar.classList.toggle('indet', !!(s.steps.scan && s.steps.scan.status === 'active'));
}

// ----- Fiche plein écran (mail ou message Chat) -----
function findMessage(kind, id) {
  if (kind === 'mail') return ib.mail.full[id] || ib.mail.items.find((m) => m.id === id) || null;
  for (const [space, d] of Object.entries(ib.chat.msgs)) {
    const m = (d.messages || []).find((x) => x.id === id);
    if (m) return { ...m, spaceTitle: ((ib.chat.spaces || []).find((x) => x.name === space) || {}).title || '' };
  }
  return null;
}

async function openSheet(kind, id) {
  ib.sheet = { kind, id };
  $('#msg-sheet').classList.remove('hidden');
  renderSheet();
  $('#msg-sheet').scrollTop = 0;
  if (kind === 'mail' && !ib.mail.full[id]) {
    await openMail(id);
    if (ib.sheet && ib.sheet.id === id) renderSheet();
  }
}

function closeSheet() {
  ib.sheet = null;
  $('#msg-sheet').classList.add('hidden');
  stopPreview();
}

function renderSheet() {
  const sh = ib.sheet;
  const box = $('#msg-sheet');
  if (!sh || !box) return;
  const msg = findMessage(sh.kind, sh.id);
  if (!msg) {
    box.innerHTML = `<div class="sheet-in"><button class="btn" data-sheet-close>${icon('arrow')}Retour</button><div class="empty">Message introuvable.</div></div>`;
    return;
  }
  const isMail = sh.kind === 'mail';
  const who = isMail ? msg.from.name : msg.sender;
  const src = { id: msg.id, kind: sh.kind, account: ib.account, client: who };
  const scroll = box.scrollTop;
  box.innerHTML = `<div class="sheet-in">
    <div class="sheet-top">
      <button class="btn" data-sheet-close><span class="back-ico">${icon('arrow')}</span>Retour</button>
      <span class="sheet-kind">${icon(isMail ? 'mail' : 'chat')}${isMail ? 'Mail' : `Chat · ${esc(msg.spaceTitle || '')}`}</span>
    </div>
    <div class="sheet-head">
      <h1>${esc(isMail ? msg.subject : `Message de ${who}`)}</h1>
      <div class="reader-from">
        <div class="mi-avatar" style="--pc:${colorOf(isMail ? msg.from.email : who)}">${esc((who || '?')[0].toUpperCase())}</div>
        <div><b>${esc(who)}</b><span>${esc(isMail ? msg.from.email : msg.spaceTitle || '')}</span></div>
        <span class="reader-date">${new Date(msg.date).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })}</span>
      </div>
    </div>
    ${
      msg.analysis && msg.analysis.isMontage
        ? montageCard(msg.analysis, src, true)
        : `${detailsHtml(msg.analysis)}${notMontageBar(sh.kind, msg)}`
    }
    <div class="sheet-section">${isMail ? 'Mail complet' : 'Message'}</div>
    ${
      isMail
        ? ib.mail.full[msg.id]
          ? `<div class="reader-body sheet-body">${mailFrame(msg)}</div>`
          : loaderHtml('Chargement du mail…')
        : `<div class="sheet-chat">${esc(msg.text).replace(/https?:\/\/[^\s<]+/g, (u) => `<a data-url="${u}">${u}</a>`).replace(/\n/g, '<br>')}</div>`
    }
  </div>`;
  box.scrollTop = scroll;
}

// ----- Mail -----
async function loadMail(more, force) {
  const acc = currentInboxAccount();
  if (!acc || !acc.features || !acc.features.gmail) return renderInbox();
  const m = ib.mail;
  const key = `${ib.account}|${ib.q}|${ib.filter}`;
  if (!more && m.key === key && m.items.length) return renderInbox();
  if (m.loading) return;
  if (!more) {
    m.items = [];
    m.next = null;
    m.selected = null;
  }
  m.key = key;
  m.loading = true;
  m.error = null;
  renderInbox();
  let q = ib.q.trim() || 'in:inbox';
  if (ib.filter === 'montage') q = `${q} ${MONTAGE_Q}`;
  const res = await api.inboxMail(ib.account, { q, pageToken: more ? m.next : '', force: !!force });
  m.loading = false;
  if (m.key !== key) return;
  if (!res.ok) m.error = res;
  else {
    m.items = m.items.concat(res.messages);
    m.next = res.nextPageToken;
  }
  updateInboxBadge();
  renderInbox();
  if (res.ok && res.pending && res.pending.length) enrichMail(key, res.pending);
}

// Mode Chrome : la liste s'affiche tout de suite, puis le contenu complet de chaque mail est
// lu par paquets pour affiner la détection des montages.
async function enrichMail(key, pending) {
  const m = ib.mail;
  m.analyzing = { done: 0, total: pending.length };
  m.skipWait = false;
  if (ib.tab === 'mail') renderInbox();
  for (let i = 0; i < pending.length; i += 10) {
    if (m.key !== key) return;
    const chunk = pending.slice(i, i + 10).map((p) => {
      const it = m.items.find((x) => x.id === p.id) || {};
      return { ...p, subject: it.subject || '', sender: (it.from && it.from.name) || '', senderEmail: (it.from && it.from.email) || '', date: it.date };
    });
    const res = await api.inboxMailBodies(ib.account, chunk);
    if (m.key !== key) return;
    if (res.ok) {
      for (const b of res.bodies) {
        const it = m.items.find((x) => x.id === b.id);
        if (it) {
          it.text = b.text;
          it.analysis = b.analysis;
        }
      }
    }
    m.analyzing.done = Math.min(pending.length, i + chunk.length);
    updateInboxBadge();
    if (mailBusy()) updateLoader();
    else {
      renderDetected();
      refreshMailList();
    }
  }
  m.analyzing = null;
  if (ib.tab === 'mail') renderInbox();
}

// Chargement de la Messagerie : tant que tout n'est pas chargé (liste + contenu des mails, ou
// conversations), le jeu du dino (dino.js) s'affiche en grand dans l'emplacement data-dino.
function loaderHtml(label, big) {
  if (!big) return `<div class="list-loading"><span class="spinner"></span>${label}</div>`;
  return `<div class="dino-load big" id="inbox-loader">
    <div class="dino-label"><span class="spinner"></span><span id="loader-text">${label}</span></div>
    <div class="bar small dino-bar"><div class="bar-fill" id="loader-bar"></div></div>
    <div class="dino-slot" data-dino data-scale-max="1.9"></div>
    <button class="btn sm ghost" data-skip-wait>${icon('list')}Afficher sans attendre</button>
  </div>`;
}

function mailBusy() {
  const m = ib.mail;
  return !m.error && ((m.loading && !m.items.length) || (!!m.analyzing && !m.skipWait));
}

function chatBusy() {
  const c = ib.chat;
  return !c.error && (!c.spaces || (c.loading && !c.skipWait));
}

// Texte et barre du chargement mis à jour sans toucher au jeu.
function updateLoader() {
  const text = $('#loader-text');
  if (!text) return;
  let label;
  let pct = null;
  if (ib.tab === 'mail') {
    const a = ib.mail.analyzing;
    label = a ? `Lecture du contenu des mails ${a.done}/${a.total}…` : 'Chargement des mails…';
    if (a) pct = (a.done / Math.max(1, a.total)) * 100;
  } else {
    const c = ib.chat;
    const n = c.spaces ? Math.min(c.spaces.length, /^chrome:/.test(ib.account) ? 3 : 10) : 0;
    const done = Object.keys(c.msgs).length;
    label = c.spaces ? `Lecture des conversations ${Math.min(done, n)}/${n}…` : 'Chargement des conversations…';
    if (c.spaces && n) pct = (Math.min(done, n) / n) * 100;
  }
  text.textContent = label;
  const bar = $('#loader-bar');
  bar.classList.toggle('indet', pct == null);
  bar.style.width = pct == null ? '' : `${pct}%`;
}

function mailListHtml() {
  const m = ib.mail;
  let items = m.items;
  if (ib.filter === 'montage') items = items.filter((x) => x.analysis.isMontage);
  return (
    (m.analyzing ? `<div class="list-progress"><span class="spinner"></span>Analyse des mails ${m.analyzing.done}/${m.analyzing.total}…<div class="bar small"><div class="bar-fill" style="width:${(m.analyzing.done / m.analyzing.total) * 100}%"></div></div></div>` : '') +
    items.map(mailItem).join('') +
    (m.loading ? loaderHtml('Chargement des mails…') : '') +
    (!m.loading && !items.length ? `<div class="empty">${ib.filter === 'montage' ? 'Aucun montage détecté dans ces mails.' : 'Aucun mail.'}</div>` : '') +
    (!m.loading && m.next ? '<button class="btn load-more" data-more-mail>Charger plus</button>' : '')
  );
}

function refreshMailList() {
  const list = $('#mail-list');
  if (!list || ib.tab !== 'mail') return;
  const scroll = list.scrollTop;
  list.innerHTML = mailListHtml();
  list.scrollTop = scroll;
}

function mailItem(msg) {
  const a = msg.analysis;
  const done = handledFor(msg.id);
  return `<div class="mail-item ${msg.unread ? 'unread' : ''} ${a.isMontage ? 'montage ' + a.level : ''} ${ib.mail.selected === msg.id ? 'selected' : ''}" data-mail="${esc(msg.id)}">
    <div class="mi-avatar" style="--pc:${colorOf(msg.from.email)}">${esc((msg.from.name || '?')[0].toUpperCase())}</div>
    <div class="mi-main">
      <div class="mi-top"><span class="mi-from">${esc(msg.from.name)}</span><span class="mi-date">${shortDate(msg.date)}</span></div>
      <div class="mi-subject">${esc(msg.subject)}</div>
      <div class="mi-snippet">${esc(msg.snippet)}</div>
      ${
        a.isMontage
          ? `<div class="mi-tags"><span class="mtag">${icon('sparkles')}Montage</span>${a.drive.length ? `<span class="mchip">${icon('drive')}${a.drive[0].kind === 'folder' ? 'Dossier' : 'Fichier'}${a.drive.length > 1 ? ' +' + (a.drive.length - 1) : ''}</span>` : ''}${a.formats.map((f) => `<span class="mchip">${f}</span>`).join('')}${deadlineChip(a)}${done ? `<span class="mchip ok">${icon('check')}Projet créé</span>` : ''}</div>`
          : ''
      }
    </div>
  </div>`;
}

function mailFrame(msg) {
  const base = '<base target="_blank"><meta charset="utf-8"><style>body{font:14px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#1f2937;margin:16px;word-wrap:break-word}img{max-width:100%;height:auto}pre{white-space:pre-wrap;font:inherit}a{color:#2563eb}</style>';
  const content = msg.html
    ? msg.html
    : `<pre>${esc(msg.text || msg.snippet).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`)}</pre>`;
  return `<iframe class="mail-frame" sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc="${esc(base + content)}"></iframe>`;
}

function renderMailReader() {
  const box = $('#mail-reader');
  if (!box) return;
  applyMontageRules();
  const m = ib.mail;
  const msg = m.full[m.selected] || m.items.find((x) => x.id === m.selected);
  if (!msg) {
    box.innerHTML = `<div class="reader-empty">${icon('mail')}<span>Sélectionne un mail</span></div>`;
    return;
  }
  const a = msg.analysis;
  box.innerHTML = `
    <div class="reader-head">
      <button class="btn sm ghost reader-full" data-sheet="mail|${esc(msg.id)}" title="Ouvrir en plein écran">${icon('external')}Plein écran</button>
      <h2>${esc(msg.subject)}</h2>
      <div class="reader-from">
        <div class="mi-avatar" style="--pc:${colorOf(msg.from.email)}">${esc((msg.from.name || '?')[0].toUpperCase())}</div>
        <div><b>${esc(msg.from.name)}</b><span>${esc(msg.from.email)}</span></div>
        <span class="reader-date">${new Date(msg.date).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}</span>
      </div>
      ${msg.attachments && msg.attachments.length ? `<div class="reader-att">${msg.attachments.map((x) => `<span class="mchip">${icon('paperclip')}${esc(x.filename)}</span>`).join('')}</div>` : ''}
    </div>
    ${a.isMontage ? montageCard(a, { id: msg.id, kind: 'mail', account: ib.account, client: msg.from.name }, true) : `${detailsHtml(a)}${notMontageBar('mail', msg)}`}
    ${m.full[m.selected] ? `<div class="reader-body">${mailFrame(msg)}</div>` : loaderHtml('Chargement du mail…')}
    ${msg.html ? '<div class="reader-note">Images distantes masquées pour ta confidentialité.</div>' : ''}`;
}

async function openMail(id) {
  const m = ib.mail;
  m.selected = id;
  $$('#mail-list .mail-item').forEach((el) => el.classList.toggle('selected', el.dataset.mail === id));
  renderMailReader();
  if (!m.full[id]) {
    const base = m.items.find((x) => x.id === id) || {};
    const res = await api.inboxMailGet(ib.account, id, base.threadId, { date: base.date, subject: base.subject || '', sender: (base.from && base.from.name) || '', senderEmail: (base.from && base.from.email) || '' });
    if (res.ok) {
      const full = { ...base, ...res.message };
      // L'analyse complète (corps du mail) complète celle de la liste.
      if (!res.message.analysis || (!res.message.analysis.isMontage && base.analysis)) full.analysis = base.analysis;
      m.full[id] = full;
    }
    if (m.selected === id) renderMailReader();
  }
}

// ----- Chat -----
async function loadChat(force) {
  const acc = currentInboxAccount();
  if (!acc || !acc.features || !acc.features.chat) return renderInbox();
  const c = ib.chat;
  if (!force && c.key === ib.account && c.spaces) return renderInbox();
  if (c.loading) return;
  c.key = ib.account;
  c.loading = true;
  c.skipWait = false;
  c.error = null;
  c.spaces = null;
  c.msgs = {};
  renderInbox();
  const res = await api.inboxSpaces(ib.account, { force: !!force });
  if (!res.ok) {
    c.loading = false;
    c.error = res;
    return renderInbox();
  }
  c.spaces = res.spaces;
  c.space = c.space && c.spaces.some((s) => s.name === c.space) ? c.space : (c.spaces[0] || {}).name || null;
  renderInbox();
  // Conversation affichée d'abord, puis quelques conversations récentes pour repérer les montages
  // (3 en mode Chrome : chaque conversation doit être ouverte dans la page Chat).
  const key = c.key;
  const order = [c.space, ...c.spaces.map((s) => s.name).filter((n) => n !== c.space)].filter(Boolean);
  for (const name of order.slice(0, /^chrome:/.test(ib.account) ? 3 : 10)) {
    if (c.key !== key) return;
    if (c.msgs[name]) continue;
    const r = await api.inboxChat(ib.account, name, { max: 40 });
    if (c.key !== key) return;
    c.msgs[name] = r.ok ? r : { messages: [], error: r };
    updateInboxBadge();
    if (ib.tab === 'chat') chatBusy() ? updateLoader() : renderInbox();
  }
  c.loading = false;
  if (ib.tab === 'chat') renderInbox();
}

async function openSpace(name) {
  const c = ib.chat;
  c.space = name;
  renderInbox();
  if (!c.msgs[name]) {
    const r = await api.inboxChat(ib.account, name, { max: 50 });
    c.msgs[name] = r.ok ? r : { messages: [], error: r };
    if (c.space === name) renderInbox();
  }
}

function chatThread() {
  const c = ib.chat;
  const sp = (c.spaces || []).find((s) => s.name === c.space);
  if (!sp) return `<div class="reader-empty">${icon('chat')}<span>Aucune conversation</span></div>`;
  const data = c.msgs[sp.name];
  if (!data) return `<div class="dino-load"><div class="dino-label"><span class="spinner"></span>Chargement de ${esc(sp.title)}…</div><div class="dino-slot" data-dino data-scale-max="1.5"></div></div>`;
  if (data.error) return inboxErrorHtml(data.error, 'chat');
  let msgs = data.messages.slice().reverse();
  if (ib.filter === 'montage') msgs = msgs.filter((m) => m.analysis.isMontage);
  const diag = /^chrome:/.test(ib.account) ? `<button class="btn sm ghost" data-chat-diag title="Enregistre la structure de la page Chat (sans le contenu des messages) pour corriger la lecture">${icon('alert')}Diagnostic</button>` : '';
  if (!data.messages.length && /^chrome:/.test(ib.account))
    return `<div class="thread-head">${icon(sp.type === 'DIRECT_MESSAGE' ? 'user' : 'users')}<b>${esc(sp.title)}</b>${diag}</div>${inboxNotice(
      'alert',
      "Coffile n'arrive pas à lire cette conversation",
      "La page Google Chat a une structure que Coffile ne reconnaît pas encore. Clique sur <b>Diagnostic</b> : un fichier est créé dans tes Téléchargements, avec seulement la structure de la page, sans tes messages, sans noms ni adresses. Envoie-le pour que la lecture soit corrigée.",
      `<button class="btn primary" data-chat-diag>${icon('alert')}Créer le diagnostic</button>`
    )}`;
  return `<div class="thread-head">${icon(sp.type === 'DIRECT_MESSAGE' ? 'user' : 'users')}<b>${esc(sp.title)}</b><span>${plural(data.messages.length, 'message', 'messages')}</span>${diag}</div>
    <div class="thread-msgs">${
      msgs
        .map(
          (m) => `<div class="bubble-row ${m.analysis.isMontage ? 'montage' : ''}" data-msg="${esc(m.id)}" title="Double-clic : ouvrir en grand">
        <div class="mi-avatar sm" style="--pc:${colorOf(m.sender)}">${esc(m.sender[0].toUpperCase())}</div>
        <div class="bubble-col">
          <div class="bubble-meta"><b>${esc(m.sender)}</b><span>${shortDate(m.date)}</span></div>
          <div class="bubble">${esc(m.text).replace(/https?:\/\/[^\s<]+/g, (u) => `<a data-url="${u}">${u.length > 60 ? u.slice(0, 60) + '…' : u}</a>`).replace(/\n/g, '<br>')}</div>
          ${m.analysis.isMontage ? montageCard(m.analysis, { id: m.id, kind: 'chat', account: ib.account, client: m.sender }, false) : m.analysis.partOf ? `<div class="bubble-part">${icon('link')}Lu avec le message qui contient les liens</div>` : ''}
        </div>
      </div>`
        )
        .join('') || '<div class="empty">Aucun message' + (ib.filter === 'montage' ? ' de montage' : '') + ' dans cette conversation.</div>'
    }</div>`;
}

// ----- Bandeau « Montages détectés » -----
function detectedList() {
  const out = [];
  if (ib.tab === 'mail') {
    for (const m of ib.mail.items) if (m.analysis.isMontage) out.push({ id: m.id, kind: 'mail', title: m.analysis.name, who: m.from.name, date: m.date, a: m.analysis, open: `data-mail="${esc(m.id)}"` });
  } else {
    for (const [space, d] of Object.entries(ib.chat.msgs)) {
      const sp = (ib.chat.spaces || []).find((s) => s.name === space);
      for (const m of d.messages || []) if (m.analysis.isMontage) out.push({ id: m.id, kind: 'chat', title: m.analysis.name, who: `${m.sender} · ${sp ? sp.title : ''}`, date: m.date, a: m.analysis, open: `data-space="${esc(space)}"` });
    }
  }
  return out.sort((x, y) => y.date - x.date);
}

function renderDetected() {
  applyMontageRules();
  const box = $('#inbox-detected');
  if (ib.tab === 'mail' ? mailBusy() : chatBusy()) {
    box.innerHTML = '';
    return;
  }
  const list = detectedList();
  if (!list.length) {
    box.innerHTML = '';
    return;
  }
  const pending = list.filter((d) => !handledFor(d.id));
  box.innerHTML = `<div class="det-title">${icon('sparkles')}Montages détectés <i>${list.length}</i>${pending.length ? `<span class="det-new">${pending.length} à lancer</span>` : ''}</div>
    <div class="det-row">${list
      .slice(0, ib.showAllDetected ? list.length : 8)
      .map((d) => {
        const done = handledFor(d.id);
        const link = d.a.drive[0];
        return `<div class="det-card ${done ? 'done' : ''} ${d.a.level}">
          <div class="det-top"><span class="mtag">${icon('sparkles')}${d.a.level === 'strong' ? 'Très probable' : 'Probable'}</span><span class="det-date">${shortDate(d.date)}</span></div>
          <div class="det-name" title="${esc(d.title)}">${esc(d.title)}</div>
          <div class="det-who">${esc(d.who)}</div>
          <div class="det-chips">${link ? `<span class="mchip">${icon('drive')}${link.kind === 'folder' ? 'Dossier' : 'Fichier'}</span>` : d.a.others[0] ? `<span class="mchip">${icon('link')}${esc(d.a.others[0].service)}</span>` : ''}${d.a.formats.map((f) => `<span class="mchip">${f}</span>`).join('')}${deadlineChip(d.a)}</div>
          <div class="det-acts">
            ${done ? `<span class="mchip ok">${icon('check')}${esc(done.name)}</span>` : link ? `<button class="btn primary sm" data-dl="${esc(link.url)}" data-src="${esc(d.id)}" data-kind="${d.kind}" data-account="${esc(ib.account)}" data-name="${esc(d.title)}" title="Créer un nouveau projet">${icon('download')}Télécharger</button><button class="btn sm icon-only" data-add-to="${esc(link.url)}" data-src="${esc(d.id)}" data-kind="${d.kind}" data-account="${esc(ib.account)}" data-name="${esc(d.title)}" title="Ajouter à un projet existant">${icon('folderOpen')}</button>` : ''}
            <button class="btn sm ghost" data-sheet="${d.kind}|${esc(d.id)}">Voir</button>
            ${done ? '' : `<button class="btn sm ghost icon-only det-no" data-not-montage="${d.kind}|${esc(d.id)}" title="Pas un montage (Coffile s'en souviendra)">${icon('thumbDown')}</button>`}
          </div>
        </div>`;
      })
      .join('')}</div>${
      list.length > 8
        ? `<button class="btn ghost sm det-more" data-det-more>${ib.showAllDetected ? 'Réduire' : `Voir les ${list.length} montages`}</button>`
        : ''
    }`;
}

function updateInboxBadge() {
  applyMontageRules();
  renderFilterButton();
  const ids = new Set();
  for (const m of ib.mail.items) if (m.analysis.isMontage && !handledFor(m.id)) ids.add(m.id);
  for (const d of Object.values(ib.chat.msgs)) for (const m of d.messages || []) if (m.analysis.isMontage && !handledFor(m.id)) ids.add(m.id);
  $('#inbox-count').textContent = ids.size || '';
}

function renderInbox() {
  if (!state.settings) return;
  applyMontageRules();
  renderInboxBar();
  renderFilterButton();
  const body = $('#inbox-body');
  const feature = ib.tab === 'mail' ? 'gmail' : 'chat';
  const gate = inboxGate(feature);
  if (gate) {
    $('#inbox-detected').innerHTML = '';
    body.innerHTML = gate;
    return;
  }
  renderDetected();
  if (ib.tab === 'mail') {
    const m = ib.mail;
    if (m.error) {
      body.innerHTML = inboxErrorHtml(m.error, 'gmail');
      return;
    }
    if (mailBusy()) {
      $('#inbox-detected').innerHTML = '';
      if (!$('#inbox-loader')) body.innerHTML = loaderHtml('Chargement des mails…', true);
      updateLoader();
      return;
    }
    if (!$('#mail-list')) body.innerHTML = `<div class="mail-pane"><div class="mail-list" id="mail-list"></div><div class="mail-reader" id="mail-reader"></div></div>`;
    refreshMailList();
    renderMailReader();
  } else {
    const c = ib.chat;
    if (c.error) {
      body.innerHTML = inboxErrorHtml(c.error, 'chat');
      return;
    }
    if (chatBusy()) {
      $('#inbox-detected').innerHTML = '';
      if (!$('#inbox-loader')) body.innerHTML = loaderHtml('Chargement des conversations…', true);
      updateLoader();
      return;
    }
    const spaces = c.spaces
      .map((s) => {
        const d = c.msgs[s.name];
        const n = d && d.messages ? d.messages.filter((m) => m.analysis.isMontage).length : 0;
        return `<button class="space-item ${c.space === s.name ? 'active' : ''}" data-space="${esc(s.name)}">
          <span class="mi-avatar sm" style="--pc:${colorOf(s.name)}">${icon(s.type === 'DIRECT_MESSAGE' ? 'user' : 'users')}</span>
          <span class="space-title">${esc(s.title)}</span>${n ? `<span class="space-n">${n}</span>` : ''}</button>`;
      })
      .join('');
    body.innerHTML = `<div class="chat-pane"><div class="space-list">${spaces || '<div class="empty">Aucune conversation.</div>'}</div><div class="chat-thread">${chatThread()}</div></div>`;
    const t = $('.thread-msgs', body);
    if (t) t.scrollTop = t.scrollHeight;
  }
}

function loadInbox(force) {
  currentInboxAccount();
  if (ib.tab === 'mail') {
    if (force) ib.mail.key = '';
    loadMail(false, force);
  } else loadChat(force);
}

async function chromeLogin(add) {
  if (state.chromeBusy) {
    // Connexion déjà en cours : on remet la fenêtre Chrome devant.
    api.chromeShow();
    toast('Connexion en cours : termine-la dans la fenêtre Chrome (ou ferme son onglet pour annuler).');
    return;
  }
  state.chromeBusy = true;
  toast(add ? 'Ajoute ton compte dans la fenêtre Chrome qui vient de s\'ouvrir…' : 'Connecte-toi à Google dans la fenêtre Chrome qui vient de s\'ouvrir…');
  const r = await api.chromeLogin(!!add);
  state.chromeBusy = false;
  if (r.settings) state.settings = r.settings;
  renderAllSettingsDependent();
  if (!r.ok) {
    toast(r.error, 'err');
    return;
  }
  if (r.added && r.added.length) {
    toast(`Connecté : ${r.added.join(', ')}`);
    ib.account = `chrome:${r.added[0]}`;
  } else if (r.accounts.length) toast(`Session Chrome prête : ${r.accounts.map((a) => a.email).join(', ')}`);
  else toast("Coffile n'a trouvé aucun compte. Termine la connexion dans la fenêtre Chrome, puis clique à nouveau sur « Se connecter ». Si ça bloque, Réglages › Chrome de Coffile › Réinitialiser.", 'err');
  ib.mail = { items: [], next: null, loading: false, error: null, selected: null, full: {}, key: '' };
  ib.chat = { spaces: null, space: null, msgs: {}, loading: false, error: null, key: '' };
  if (state.view === 'inbox') {
    $('#inbox-body').innerHTML = '';
    loadInbox(true);
  }
}

function renderChromeSettings() {
  const s = state.settings;
  $$('#set-inbox-mode button').forEach((b) => b.classList.toggle('active', b.dataset.m === (s.inboxMode || 'chrome')));
  const accs = s.chromeAccounts || [];
  setHTML(
    $('#chrome-accounts'),
    !s.chromeAvailable
      ? `<div class="acc-empty">${icon('alert')}<span>Google Chrome n'est pas installé sur ce PC.</span></div>`
      : accs.length
        ? accs
            .map(
              (a) => `<div class="acc-row"><span class="avatar chrome-av">${icon('chrome')}</span><div class="acc-text"><b>${esc(a.name || a.email)}</b><span>${esc(a.email)} · session ${a.u}</span></div><span class="pill ok">Gmail</span><span class="pill ok">Chat</span><span class="pill ok">Drive</span></div>`
            )
            .join('')
        : `<div class="acc-empty">${icon('user')}<span>Pas encore connecté. Clique sur « Se connecter à Google » : une fenêtre Chrome s'ouvre, tu te connectes, puis elle se cache toute seule.</span></div>`
  );
  $('#chrome-login-label').textContent = accs.length ? 'Ajouter un compte Google' : 'Se connecter à Google';
  $('[data-chrome-login]', $('#chrome-setting')).dataset.chromeLogin = accs.length ? 'add' : '';
}

async function authorizeFeature(feature) {
  const acc = currentInboxAccount();
  if (!acc) return connectGoogle();
  toast(`Autorise l'accès dans Chrome pour ${acc.email}…`);
  const r = await api.googleAuthorize(acc.email, feature);
  state.settings = r.settings;
  renderAllSettingsDependent();
  if (r.ok) {
    toast(`${feature === 'gmail' ? 'Gmail' : 'Google Chat'} autorisé`);
    loadInbox(true);
  } else if (!r.cancelled) toast(r.error, 'err');
  else renderInbox();
}

// « Télécharger » depuis un message : remplit le nouveau projet et lance toute la création.
// Lance un projet depuis un message : remplit Nouveau projet (lien(s), nom, compte) et démarre.
async function startFromMessage({ srcId, kind, account, sources, name, addTo = null }) {
  if (state.jobRunning) {
    toast('Un projet est déjà en cours de création.', 'err');
    return;
  }
  const base = sanitizeName(name || 'Nouveau_montage') || 'Nouveau_montage';
  let finalName = base;
  if (!addTo) for (let n = 2; await api.projectExists(finalName); n++) finalName = `${base}_${n}`;
  state.addTo = addTo;
  setNewMode(addTo ? 'add' : 'new');
  $('#ae-check').checked = state.aeFor.has(srcId);
  state.aeFor.delete(srcId);
  state.pendingSource = { kind, id: srcId };
  state.pendingSources = sources.length > 1 || sources[0].label ? sources : null;
  state.job = null;
  closeSheet();
  showView('new');
  driveInput.value = sources[0].url;
  nameInput.value = finalName;
  state.account = account || '';
  renderAccountPick();
  onNameChange();
  state.inspect = { loading: true };
  renderDriveStatus();
  const res = await api.inspect(sources[0].url, state.account);
  state.inspect = res;
  state.nameExists = false;
  renderDriveStatus();
  renderTree();
  updateCreateBtn();
  if (!res.ok && sources.length === 1) {
    state.pendingSource = null;
    state.pendingSources = null;
    toast(res.error || 'Lien Drive inaccessible', 'err');
    return;
  }
  if (addTo) toast(`Ajout ${sources.length > 1 ? `des ${sources.length} liens ` : ''}au projet « ${addTo.name} »`);
  else toast(sources.length > 1 ? `Création du projet « ${finalName} » avec ${sources.length} liens` : `Création du projet « ${finalName} »`);
  createProject(true);
}

// Un seul lien (message avec un lien).
function downloadFromMessage(btn) {
  const msg = findMessage(btn.dataset.kind, btn.dataset.src);
  const a = msg && msg.analysis;
  startFromMessage({
    srcId: btn.dataset.src,
    kind: btn.dataset.kind,
    account: btn.dataset.account,
    sources: [{ url: btn.dataset.dl, label: '' }],
    name: a ? nameFor(btn.dataset.src, a) : btn.dataset.name
  });
}

// « Ajouter à… » : on choisit un projet existant, puis même téléchargement que d'habitude.
function addFromMessage(btn) {
  openProjectPicker('Ajouter les fichiers à quel projet ?', (p) => {
    if (btn.dataset.addAll) return downloadAllFromMessage(btn, p);
    const msg = findMessage(btn.dataset.kind, btn.dataset.src);
    const a = msg && msg.analysis;
    startFromMessage({ srcId: btn.dataset.src, kind: btn.dataset.kind, account: btn.dataset.account, sources: [{ url: btn.dataset.addTo, label: '' }], name: a ? nameFor(btn.dataset.src, a) : btn.dataset.name, addTo: p });
  });
}

// Tous les liens cochés d'un message, chacun dans un dossier à son nom.
function downloadAllFromMessage(btn, addTo = null) {
  const srcId = btn.dataset.dlAll || btn.dataset.addAll;
  const msg = findMessage(btn.dataset.kind, srcId);
  if (!msg) return;
  const a = msg.analysis;
  const picked = a.drive.map((d, i) => ({ d, i })).filter(({ i }) => included(srcId, i));
  if (!picked.length) return;
  const sources = picked.map(({ d, i }) => ({ url: d.url, label: picked.length > 1 ? labelFor(srcId, i, d).trim() || `Lien ${i + 1}` : '' }));
  startFromMessage({ srcId, kind: btn.dataset.kind, account: btn.dataset.account, sources, name: nameFor(srcId, a), addTo });
}


// ---------- Mises à jour ----------
// Au lancement, une nouvelle version s'installe toute seule : un écran l'indique pendant le
// téléchargement, puis Coffile redémarre dessus. Trouvée en cours d'utilisation, elle attend le
// prochain lancement (rien n'est interrompu).
function renderUpdate() {
  const u = state.update || { status: 'idle', version: state.settings.version };
  const v = state.settings.version;
  const ver = $('#version');
  ver.innerHTML = `Version ${esc(v)}${u.status === 'latest' ? ' · à jour' : ''}`;

  const lock = $('#update-lock');
  const atLaunch = u.launch && ['downloading', 'ready', 'installing'].includes(u.status);
  if (atLaunch) {
    const pct = u.status === 'downloading' ? u.percent || 0 : 100;
    setHTML(
      lock,
      `<div class="modal ul-modal"><div class="modal-glow"></div><img src="assets/icon.png" class="modal-logo" alt="" /><h2>Mise à jour ${esc(u.available || '')}</h2><p class="lead">${u.status === 'downloading' ? `Téléchargement de la nouvelle version… <b>${pct} %</b>` : 'Installation… Coffile redémarre tout seul.'}</p><div class="bar small"><div class="bar-fill ${u.status === 'downloading' ? '' : 'indet'}" style="width:${pct}%"></div></div></div>`
    );
    lock.classList.remove('hidden');
  } else lock.classList.add('hidden');

  const card = $('#update-card');
  if (!atLaunch && u.status === 'ready') {
    card.classList.remove('hidden');
    setHTML(card, `<div class="uc-head">${icon('sparkles')}Version ${esc(u.available)} prête</div><div class="uc-sub">Elle s'installera au prochain lancement de Coffile.</div><button class="btn sm" id="uc-install">Redémarrer maintenant</button>`);
  } else card.classList.add('hidden');

  const box = $('#update-box');
  const acts = $('#update-actions');
  if (!box) return;
  let html;
  switch (u.status) {
    case 'dev':
      html = `<div class="ub">${icon('alert')}<span>Version de développement : les mises à jour ne sont actives que dans l'application installée.</span></div>`;
      break;
    case 'checking':
      html = `<div class="ub"><span class="spinner"></span><span>Recherche de mises à jour…</span></div>`;
      break;
    case 'latest':
      html = `<div class="ub ok">${icon('check')}<span>Coffile est à jour (v${esc(v)})${u.checkedAt ? ` · vérifié ${relTime(u.checkedAt)}` : ''}</span></div>`;
      break;
    case 'downloading':
      html = `<div class="ub">${icon('download')}<span>Téléchargement de la version ${esc(u.available)}… ${u.percent || 0}%</span></div><div class="bar small"><div class="bar-fill" style="width:${u.percent || 0}%"></div></div>`;
      break;
    case 'ready':
      html = `<div class="ub ok">${icon('sparkles')}<span>La version ${esc(u.available)} est prête. Elle s'installera au prochain lancement de Coffile.</span></div>`;
      break;
    case 'installing':
      html = `<div class="ub"><span class="spinner"></span><span>Installation de la version ${esc(u.available)}…</span></div>`;
      break;
    case 'error':
      html = `<div class="ub err">${icon('alert')}<span>${esc(u.error || 'Erreur de mise à jour')}</span></div>`;
      break;
    default:
      html = `<div class="ub"><span>Version installée : v${esc(v)}</span></div>`;
  }
  setHTML(box, html);
  setHTML(
    acts,
    u.status === 'ready'
      ? `<button class="btn primary" id="up-install">${icon('refresh')}Redémarrer et installer</button>`
      : `<button class="btn" id="up-check" ${['checking', 'downloading', 'dev'].includes(u.status) ? 'disabled' : ''}>${icon('refresh')}Rechercher</button>`
  );
}

// Après une mise à jour : ce qui a été ajouté (versions installées depuis la dernière ouverture).
async function showWhatsNew() {
  const wn = await api.whatsNew();
  if (!wn || !wn.entries || !wn.entries.length) return;
  const el = $('#whats-new');
  setHTML(
    el,
    `<div class="modal wn-modal"><div class="modal-glow"></div><img src="assets/icon.png" class="modal-logo" alt="" /><div class="eyebrow">Mise à jour installée</div><h2>Nouveautés de Coffile ${esc(wn.version)}</h2>
      <div class="wn-list">${wn.entries
        .map((e) => `<div class="wn-ver">${wn.entries.length > 1 ? `<b>Version ${esc(e.version)}</b>` : ''}<ul>${e.items.map((it) => `<li>${esc(it)}</li>`).join('')}</ul></div>`)
        .join('')}</div>
      <div class="modal-actions"><span></span><button class="btn primary" id="wn-ok">${icon('check')}C'est parti</button></div></div>`
  );
  el.classList.remove('hidden');
  $('#wn-ok').onclick = () => el.classList.add('hidden');
}

async function installUpdate() {
  if (state.jobRunning) {
    toast('Attends la fin de la création du projet pour installer la mise à jour.', 'err');
    return;
  }
  await api.installUpdate();
}

// ---------- Réglages ----------
async function setPathBox(el, p, emptyText) {
  el.textContent = p || emptyText;
  el.title = p || '';
  el.classList.toggle('empty', !p);
  el.classList.remove('ok', 'bad');
  if (p) el.classList.add((await api.exists(p)) ? 'ok' : 'bad');
}

function renderSettings() {
  const s = state.settings;
  setPathBox($('#set-root'), s.projectsRoot, 'Non défini');
  setPathBox($('#set-prproj'), s.premiereTemplate, 'Aucun modèle sélectionné');
  $('#set-prproj-clear').disabled = !s.premiereTemplate;
  setPathBox($('#set-dl'), s.downloadsDir, 'Non défini');
  $$('#set-mode button').forEach((b) => b.classList.toggle('active', b.dataset.m === (s.downloadMode || 'auto')));
  $('#set-delzip').checked = s.deleteZips !== false;
  if (document.activeElement !== $('#api-key')) $('#api-key').value = s.apiKey || '';
  renderChromeSettings();
  renderGoogleSettings();
}

async function pickRoot() {
  const dir = await api.pickFolder({ title: 'Dossier où créer les projets de montage', defaultPath: state.settings.projectsRoot || undefined });
  if (dir) {
    await updateSettings({ projectsRoot: dir });
    checkNameExists();
    toast('Dossier des projets mis à jour');
  }
  return dir;
}

async function pickPrproj() {
  const file = await api.pickPrproj();
  if (file) {
    await updateSettings({ premiereTemplate: file });
    toast('Modèle Premiere Pro enregistré');
  }
  return file;
}

// ---------- Onboarding ----------
function renderOnboarding() {
  setPathBox($('#ob-root'), state.settings.projectsRoot, 'Non défini');
  setPathBox($('#ob-prproj'), state.settings.premiereTemplate, 'Optionnel — à faire plus tard');
}

// ---------- Événements ----------
function bind() {
  $$('.nav-item').forEach((b) => (b.onclick = () => showView(b.dataset.view)));
  $('#sidebar-job').onclick = () => showView('new');
  $('#root-card').onclick = pickRoot;

  driveInput.addEventListener('input', () => {
    state.inspect = driveInput.value.trim() ? { loading: true } : null;
    renderDriveStatus();
    updateCreateBtn();
    runInspect();
  });
  nameInput.addEventListener('input', onNameChange);
  $('#paste-btn').onclick = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        driveInput.value = text.trim();
        driveInput.dispatchEvent(new Event('input'));
      }
    } catch {
      driveInput.focus();
      toast('Utilise Ctrl+V pour coller le lien', 'err');
    }
  };
  $('#create-btn').onclick = createProject;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && state.view === 'new' && !state.job) createProject();
  });

  $('#slots-new').addEventListener('click', onSlotClick);
  $('#slots-settings').addEventListener('click', onSlotClick);

  document.addEventListener('change', (e) => {
    const t = e.target.closest('[data-ae-for]');
    if (!t) return;
    if (t.checked) state.aeFor.add(t.dataset.aeFor);
    else state.aeFor.delete(t.dataset.aeFor);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#customizer, [data-customize], #new-badge')) closeCustomizer();
    const aeBtn = e.target.closest('[data-autoedit]');
    if (aeBtn) {
      if (typeof closeProjectModal === 'function' && aeBtn.closest('.pm, #project-modal')) closeProjectModal();
      AutoEdit.open(aeBtn.dataset.autoedit, aeBtn.dataset.name);
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open && !open.disabled) {
      api.open(open.dataset.open).then((err) => err && toast(err, 'err'));
      return;
    }
    const url = e.target.closest('[data-url]');
    if (url) {
      api.external(url.dataset.url);
      return;
    }
    const detail = e.target.closest('[data-detail]');
    if (detail && !e.target.closest('button')) {
      openProjectModal(detail.dataset.detail);
      return;
    }
    if (detail && e.target.closest('button[title="Détails"]')) {
      openProjectModal(detail.dataset.detail);
      return;
    }
    if (e.target.id === 'project-modal' || e.target.closest('#pm-close')) closeProjectModal();
    if (e.target.closest('#bc-reopen')) api.reopenBrowser();
    const cl = e.target.closest('[data-chrome-login]');
    if (cl) {
      chromeLogin(cl.dataset.chromeLogin === 'add');
      return;
    }
    if (e.target.closest('[data-chrome-show]')) {
      api.chromeShow().then((r) => !r.ok && toast(r.error, 'err'));
      return;
    }
    if (e.target.closest('[data-chrome-hide]')) {
      api.chromeHide();
      return;
    }
    if (e.target.closest('[data-chrome-reset]')) {
      if (!confirm('Réinitialiser le Chrome de Coffile ? Tu devras te reconnecter à Google.')) return;
      api.chromeReset().then((r) => {
        if (r.settings) state.settings = r.settings;
        state.chromeBusy = false;
        renderAllSettingsDependent();
        toast(r.ok ? 'Chrome de Coffile réinitialisé : reconnecte-toi.' : r.error, r.ok ? 'ok' : 'err');
      });
      return;
    }
    const sheetBtn = e.target.closest('[data-sheet]');
    if (sheetBtn) {
      const [kind, ...rest] = sheetBtn.dataset.sheet.split('|');
      openSheet(kind, rest.join('|'));
      return;
    }
    if (e.target.closest('[data-sheet-close]')) {
      closeSheet();
      return;
    }
    const dlAll = e.target.closest('[data-dl-all]');
    if (dlAll) {
      downloadAllFromMessage(dlAll);
      return;
    }
    if (e.target.closest('.mc-link input, .mc-check, .mc-label, .mc-name, .ae-toggle')) return;
    const dl = e.target.closest('[data-dl]');
    if (dl) {
      downloadFromMessage(dl);
      return;
    }
    const mailEl = e.target.closest('[data-mail]');
    if (mailEl) {
      openMail(mailEl.dataset.mail);
      return;
    }
    const spaceEl = e.target.closest('[data-space]');
    if (spaceEl) {
      if (ib.tab !== 'chat') ib.tab = 'chat';
      openSpace(spaceEl.dataset.space);
      return;
    }
    const auth = e.target.closest('[data-authorize]');
    if (auth) {
      authorizeFeature(auth.dataset.authorize);
      return;
    }
    if (e.target.closest('[data-inbox-retry]')) {
      ib.mail.error = null;
      ib.chat.error = null;
      loadInbox(true);
      return;
    }
    const diagBtn = e.target.closest('[data-chat-diag]');
    if (diagBtn) {
      diagBtn.disabled = true;
      toast('Diagnostic en cours…');
      api.inboxChatDiagnostic(ib.account, ib.chat.space).then((r) => {
        diagBtn.disabled = false;
        toast(r.ok ? `Diagnostic enregistré : ${r.file.split(/[\\/]/).pop()}` : r.error, r.ok ? 'ok' : 'err');
      });
      return;
    }
    if (e.target.closest('[data-det-more]')) {
      ib.showAllDetected = !ib.showAllDetected;
      renderDetected();
      return;
    }
    if (e.target.closest('[data-more-mail]')) {
      loadMail(true);
      return;
    }
    const rnOpen = e.target.closest('[data-rename]');
    if (rnOpen) {
      openRename(rnOpen.dataset.rename);
      return;
    }
    const rnProj = e.target.closest('[data-rename-project]');
    if (rnProj) {
      closeProjectModal();
      (state.exports ? Promise.resolve() : api.scanExports().then((x) => (state.exports = x))).then(() => openRename(rnProj.dataset.renameProject));
      return;
    }
    if (e.target.closest('[data-rn-close]') || e.target.id === 'rename-modal') {
      closeRename();
      return;
    }
    if (e.target.closest('[data-rn-go]')) {
      runRename();
      return;
    }
    if (e.target.closest('[data-rn-undo]')) {
      undoRename();
      return;
    }
    const pin = e.target.closest('[data-pin]');
    if (pin) {
      togglePin(pin.dataset.pin);
      return;
    }
    const cust = e.target.closest('[data-customize]');
    if (cust) {
      openCustomizer(cust, cust.dataset.customize);
      return;
    }
    if (e.target.closest('#new-badge')) {
      openCustomizer($('#new-badge'), 'new');
      return;
    }
    const sidePin = e.target.closest('[data-detail-open]');
    if (sidePin) openProjectModal(sidePin.dataset.detailOpen);
    const accBtn = e.target.closest('[data-acc]');
    if (accBtn) selectAccount(accBtn.dataset.acc);
    if (e.target.closest('[data-connect]') || e.target.closest('#ds-connect') || e.target.closest('#acc-connect')) connectGoogle();
    const def = e.target.closest('[data-acc-default]');
    if (def) updateSettings({ defaultAccount: def.dataset.accDefault });
    const rmAcc = e.target.closest('[data-acc-remove]');
    if (rmAcc) {
      api.googleRemove(rmAcc.dataset.accRemove).then((s) => {
        state.settings = s;
        renderAllSettingsDependent();
        toast('Compte déconnecté');
      });
    }
    const rev = e.target.closest('[data-reveal]');
    if (rev && rev.dataset.reveal) api.reveal(rev.dataset.reveal);
    const go = e.target.closest('[data-goto-exports]');
    if (go) {
      closeProjectModal();
      $('#exp-search').value = go.dataset.gotoExports;
      showView('exports');
    }
    if (e.target.closest('#bc-finish')) {
      e.target.closest('#bc-finish').disabled = true;
      api.finishImport();
    }
    if (e.target.closest('#uc-install') || e.target.closest('#up-install')) installUpdate();
    if (e.target.closest('#up-check')) api.checkUpdate();
    if (e.target.closest('#cancel-btn')) {
      api.cancelProject();
      e.target.closest('#cancel-btn').disabled = true;
    }
    if (e.target.closest('#again-btn')) resetNewProject();
    if (e.target.closest('#dino-job-btn')) openDino(true);
    const addBtn = e.target.closest('[data-add-to], [data-add-all]');
    if (addBtn && !addBtn.disabled) addFromMessage(addBtn);
    const notM = e.target.closest('[data-not-montage]');
    if (notM) {
      const [kind, ...id] = notM.dataset.notMontage.split('|');
      markMontage(kind, id.join('|'), false);
    }
    const isM = e.target.closest('[data-is-montage]');
    if (isM) {
      const [kind, ...id] = isM.dataset.isMontage.split('|');
      markMontage(kind, id.join('|'), true);
    }
    const cp = e.target.closest('[data-copy]');
    if (cp) api.copyText(cp.dataset.copy).then(() => toast('Copié dans le presse-papiers.'));
    if (e.target.closest('[data-skip-wait]')) {
      if (ib.tab === 'mail') ib.mail.skipWait = true;
      else ib.chat.skipWait = true;
      renderInbox();
    }
    if (e.target.closest('#retry-btn')) {
      state.job = null;
      showView('new');
      checkNameExists();
    }
    if (e.target.closest('#pg-path') && state.job) api.open(state.job.dir);
  });

  $$('#file-filter button').forEach(
    (b) =>
      (b.onclick = () => {
        state.fileFilter = b.dataset.f;
        $$('#file-filter button').forEach((x) => x.classList.toggle('active', x === b));
        if (state.job) renderFiles(state.job);
      })
  );

  $('#search').addEventListener('input', debounce(renderProjects, 120));
  $$('#lib-sort button').forEach(
    (b) =>
      (b.onclick = () => {
        state.libSort = b.dataset.s;
        $$('#lib-sort button').forEach((x) => x.classList.toggle('active', x === b));
        renderProjects();
      })
  );
  $('#lib-refresh').onclick = loadLibrary;

  // Exports
  $('#exp-refresh').onclick = loadExports;
  $('#exp-search').addEventListener('input', debounce(renderExports, 120));
  $$('#exp-view button').forEach(
    (b) =>
      (b.onclick = () => {
        state.expView = b.dataset.v;
        $$('#exp-view button').forEach((x) => x.classList.toggle('active', x === b));
        renderExports();
      })
  );
  $$('#exp-group button').forEach(
    (b) =>
      (b.onclick = () => {
        state.expGroup = b.dataset.g;
        $$('#exp-group button').forEach((x) => x.classList.toggle('active', x === b));
        renderExports();
      })
  );
  $('#exp-filters').addEventListener('click', (e) => {
    const a = e.target.closest('[data-aspect]');
    const x = e.target.closest('[data-ext]');
    if (a) state.expAspect = a.dataset.aspect;
    if (x) state.expExt = x.dataset.ext;
    if (a || x) renderExports();
  });
  const expList = $('#exp-list');
  expList.addEventListener('click', (e) => {
    const row = e.target.closest('[data-path]');
    if (!row) return;
    if (e.target.closest('[data-play]')) api.open(row.dataset.path);
    else if (e.target.closest('[data-reveal]')) api.reveal(row.dataset.path);
    selectExport(row.dataset.path);
    expList.focus({ preventScroll: true });
  });
  expList.addEventListener('dblclick', (e) => {
    const row = e.target.closest('[data-path]');
    if (row && !e.target.closest('button')) api.reveal(row.dataset.path);
  });
  expList.addEventListener('keydown', (e) => {
    const rows = $$('[data-path]', expList);
    if (!rows.length) return;
    const i = rows.findIndex((r) => r.dataset.path === state.expSelected);
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight';
      const n = rows[Math.max(0, Math.min(rows.length - 1, i + (fwd ? 1 : -1)))];
      selectExport(n.dataset.path, true);
    } else if (e.key === 'Enter' && state.expSelected) api.reveal(state.expSelected);
  });

  // Comptes Google
  $('#chrome-profile').onchange = (e) => updateSettings({ chromeProfile: e.target.value });
  $('#oauth-save').onclick = async () => {
    const id = $('#oauth-id').value.trim();
    const secret = $('#oauth-secret').value.trim();
    if (!/\.apps\.googleusercontent\.com$/.test(id) || !secret) {
      toast("Colle l'ID client (…apps.googleusercontent.com) et le code secret.", 'err');
      return;
    }
    state.settings = await api.googleSetClient({ id, secret });
    $('#oauth-secret').value = '';
    $('#oauth-details').open = false;
    renderAllSettingsDependent();
    toast('Connexion Google configurée : tu peux connecter ton compte');
  };
  $('#lib-root').onclick = () => state.settings.projectsRoot && api.open(state.settings.projectsRoot);
  $('#version').onclick = () => showView('settings');
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#dino-full').classList.contains('hidden')) closeDino();
    else if (ib.sheet) closeSheet();
    else if (!$('#customizer').classList.contains('hidden')) closeCustomizer();
    else if (!$('#rename-modal').classList.contains('hidden')) closeRename();
    else closeProjectModal();
  });
  $('#customizer').addEventListener('click', onCustomizerClick);

  // Nouveau projet ou ajout à un projet existant.
  $$('#new-mode button').forEach((b) => (b.onclick = () => setNewMode(b.dataset.mode)));
  $('#addto-pick').onclick = () =>
    openProjectPicker('Ajouter à quel projet ?', (p) => {
      state.addTo = p;
      setNewMode('add');
    });
  $('#pp-search').addEventListener('input', () => {
    pp.index = 0;
    renderProjectPicker();
  });
  $('#pp-search').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!pp.shown.length) return;
      pp.index = (pp.index + (e.key === 'ArrowDown' ? 1 : -1) + pp.shown.length) % pp.shown.length;
      renderProjectPicker();
      const act = $('#pp-list .np-item.active');
      if (act) act.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      chooseProject(pp.index);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      closeProjectPicker();
    }
  });
  $('#proj-pick').addEventListener('click', (e) => {
    const it = e.target.closest('[data-pp]');
    if (it) chooseProject(Number(it.dataset.pp));
    else if (e.target.id === 'proj-pick' || e.target.closest('[data-pp-close]')) closeProjectPicker();
  });

  // Filtre des expéditeurs (Messagerie).
  $('#sf-btn').addEventListener('click', async () => {
    const f = state.settings.inboxFilter || {};
    if (!f.enabled) {
      await saveFilter({ enabled: true });
      openFilter();
    } else if (sf.open) closeFilter();
    else openFilter();
  });
  $('#sf-pop').addEventListener('input', (e) => {
    if (e.target.id === 'sf-search') {
      sf.q = e.target.value.trim();
      renderFilterList();
    }
  });
  $('#sf-pop').addEventListener('change', async (e) => {
    const f = state.settings.inboxFilter || { enabled: false, senders: [] };
    if (e.target.id === 'sf-on') return saveFilter({ enabled: e.target.checked });
    const key = e.target.dataset.sf;
    if (key == null) return;
    const set = new Set(f.senders || []);
    if (e.target.checked) set.add(key);
    else set.delete(key);
    await saveFilter({ senders: [...set] });
    renderFilterList();
  });
  $('#sf-pop').addEventListener('click', async (e) => {
    if (e.target.closest('[data-sf-none]')) {
      await saveFilter({ senders: [] });
      renderFilterList();
    } else if (e.target.closest('[data-sf-montage]')) {
      const all = knownSenders();
      const keys = Object.keys(all).filter((k) => all[k].montage > 0);
      const f = state.settings.inboxFilter || {};
      await saveFilter({ senders: [...new Set([...(f.senders || []), ...keys])] });
      renderFilterList();
    } else if (e.target.closest('[data-sf-reset]')) {
      if (!confirm('Oublier tout ce que Coffile a appris de tes choix ?')) return;
      await api.inboxModelReset();
      toast('Apprentissage remis à zéro.');
      openFilter();
    }
  });
  document.addEventListener('mousedown', (e) => {
    if (sf.open && !e.target.closest('.sf-wrap')) closeFilter();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sf.open) closeFilter();
  });

  // Pause café : le jeu du dino à la demande.
  $('#dino-btn-img').src = dinoIcon();
  $('#df-logo').src = dinoIcon();
  $('#dino-play').onclick = () => openDino(false);
  $('#df-close').onclick = () => {
    const toDetail = state.dinoJob;
    closeDino();
    if (toDetail) showView('new');
  };
  $('#exp-rename').onclick = () => openRename();

  // Fiches montage : saisies gardées en mémoire, double-clic pour ouvrir en grand.
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.nameFor) ib.names[t.dataset.nameFor] = t.value;
    if (t.dataset.labelFor) ib.labels[linkKey(t.dataset.labelFor, t.dataset.idx)] = t.value;
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.dataset.incFor) return;
    ib.include[linkKey(t.dataset.incFor, t.dataset.idx)] = t.checked;
    // Rafraîchit le libellé du bouton et l'aspect des liens de toutes les fiches de ce message.
    if (ib.sheet) renderSheet();
    if (ib.tab === 'mail') renderMailReader();
    else renderInbox();
  });
  document.addEventListener('dblclick', (e) => {
    if (e.target.closest('input, button, a')) return;
    const mail = e.target.closest('[data-mail]');
    if (mail) return openSheet('mail', mail.dataset.mail);
    const bubble = e.target.closest('[data-msg]');
    if (bubble) openSheet('chat', bubble.dataset.msg);
  });
  $$('#set-inbox-mode button').forEach(
    (b) =>
      (b.onclick = async () => {
        await updateSettings({ inboxMode: b.dataset.m });
        ib.account = '';
        ib.mail = { items: [], next: null, loading: false, error: null, selected: null, full: {}, key: '' };
        ib.chat = { spaces: null, space: null, msgs: {}, loading: false, error: null, key: '' };
      })
  );

  // Messagerie
  $$('#inbox-tabs button').forEach(
    (b) =>
      (b.onclick = () => {
        ib.tab = b.dataset.t;
        $('#inbox-body').innerHTML = '';
        renderInbox();
        loadInbox();
      })
  );
  $$('#inbox-filter button').forEach(
    (b) =>
      (b.onclick = () => {
        ib.filter = b.dataset.f;
        if (ib.tab === 'mail') loadMail();
        else renderInbox();
      })
  );
  $('#inbox-account').onchange = (e) => {
    ib.account = e.target.value;
    ib.mail = { items: [], next: null, loading: false, error: null, selected: null, full: {}, key: '' };
    ib.chat = { spaces: null, space: null, msgs: {}, loading: false, error: null, key: '' };
    $('#inbox-body').innerHTML = '';
    loadInbox();
  };
  $('#inbox-search').addEventListener(
    'input',
    debounce(() => {
      ib.q = $('#inbox-search').value;
      loadMail();
    }, 500)
  );
  $('#inbox-refresh').onclick = () => {
    ib.mail.full = {};
    loadInbox(true);
  };
  $('#rename-modal').addEventListener('input', (e) => {
    if (e.target.id === 'rn-title') {
      rn.title = e.target.value;
      renderRenameList();
    } else if (e.target.dataset.verPath) {
      rn.overrides[e.target.dataset.verPath] = e.target.value;
      renderRenameList();
    }
  });
  $('#rename-modal').addEventListener('change', (e) => {
    if (e.target.id === 'rn-project') {
      rn.dir = e.target.value;
      rn.title = ((state.settings.projects || {})[rn.dir] || {}).renameTitle || '';
      rn.overrides = {};
      renderRename();
    }
  });
  $('#rename-modal').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target.id === 'rn-title' || e.target.dataset.verPath)) runRename();
  });
  document.addEventListener('mouseover', (e) => {
    const host = e.target.closest('[data-preview]');
    if (host && (!preview || preview.host !== host)) startPreview(host);
  });
  document.addEventListener('mouseout', (e) => {
    if (preview && !preview.host.contains(e.relatedTarget)) stopPreview();
  });
  $('.content').addEventListener('scroll', closeCustomizer, { passive: true });

  $$('#set-mode button').forEach(
    (b) =>
      (b.onclick = async () => {
        await updateSettings({ downloadMode: b.dataset.m });
        if (driveInput.value.trim()) driveInput.dispatchEvent(new Event('input'));
      })
  );
  $('#set-dl-btn').onclick = async () => {
    const dir = await api.pickFolder({ title: 'Dossier où ton navigateur enregistre les téléchargements', defaultPath: state.settings.downloadsDir || undefined });
    if (dir) await updateSettings({ downloadsDir: dir });
  };
  $('#set-delzip').onchange = (e) => updateSettings({ deleteZips: e.target.checked });

  $('#set-root-btn').onclick = pickRoot;
  $('#set-root-open').onclick = () => state.settings.projectsRoot && api.open(state.settings.projectsRoot);
  $('#set-prproj-btn').onclick = pickPrproj;
  $('#set-prproj-clear').onclick = () => updateSettings({ premiereTemplate: '' });
  $('#api-key').addEventListener(
    'input',
    debounce(async () => {
      await updateSettings({ apiKey: $('#api-key').value.trim() });
      toast($('#api-key').value.trim() ? 'Clé API enregistrée' : 'Clé API retirée');
    }, 700)
  );
  $('#api-key-toggle').onclick = () => {
    const i = $('#api-key');
    i.type = i.type === 'password' ? 'text' : 'password';
    $('#api-key-toggle').textContent = i.type === 'password' ? 'Afficher' : 'Masquer';
  };
  $('#api-help').onclick = () => api.external('https://developers.google.com/workspace/drive/api/guides/api-key');

  $('#ob-root-btn').onclick = async () => (await pickRoot()) && renderOnboarding();
  $('#ob-prproj-btn').onclick = async () => (await pickPrproj()) && renderOnboarding();
  $('#ob-done').onclick = async () => {
    if (!state.settings.projectsRoot && !(await pickRoot())) return;
    await updateSettings({ onboarded: true });
    $('#onboarding').classList.add('hidden');
    driveInput.focus();
  };

  api.onUpdate((u) => {
    state.update = u;
    renderUpdate();
  });
  showWhatsNew();

  api.onJobUpdate((s) => {
    state.job = s;
    renderProgress();
  });
}

async function init() {
  hydrateIcons();
  state.settings = await api.getSettings();
  document.body.classList.toggle('mac', state.settings.platform === 'darwin');
  state.update = await api.updateState();
  state.account = state.settings.defaultAccount || '';
  bind();
  renderAllSettingsDependent();
  renderDriveStatus();
  updateCreateBtn();
  loadLibrary();
  // Repère en arrière-plan les nouvelles demandes de montage (badge Messagerie), puis toutes les 10 min
  // (entre deux, le Chrome de Coffile se ferme tout seul pour libérer la mémoire).
  const bgMail = () => {
    const acc = currentInboxAccount();
    if (acc && acc.features && acc.features.gmail && state.view !== 'inbox') {
      ib.mail.key = '';
      loadMail();
    }
  };
  setTimeout(bgMail, 3000);
  setInterval(bgMail, 10 * 60 * 1000);
  api.scanExports().then((x) => {
    if (!state.exports) state.exports = x;
    $('#exports-count').textContent = x.length || '';
  });
  if (!state.settings.onboarded) {
    renderOnboarding();
    $('#onboarding').classList.remove('hidden');
  } else {
    driveInput.focus();
  }
}

init();
