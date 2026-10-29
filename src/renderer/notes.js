'use strict';
// Notes : feuilles avec titres, gras, MAJUSCULES et couleurs, enregistrées toutes seules dans
// un fichier .txt par feuille (format lisible décrit dans src/notes.js).
// Un code couleur écrit dans le texte (A7998B ou #A7998B) s'affiche dans sa couleur ;
// un clic le copie (sans « # », comme Premiere Pro l'attend).
// Commandes « / » (ou clic droit) : /projet, /export, /file, /folder, /image, /emoji, /titre…
// Taille du texte réglable, emojis, et mode plein écran.
(() => {
  const PRESETS = ['#f4f4f5', '#e8772e', '#f5c46a', '#d9622b', '#b9773d', '#34d399', '#5b8cff', '#f472b6'];
  // 6 caractères hexadécimaux isolés. Sans « # » et sans chiffre, seulement les codes en paires
  // (FFFFFF, FFAACC…) : FACADE, DECADE ou EFFACE restent du texte.
  const HEX_RE = /(^|[^0-9A-Za-z#])(#?[0-9A-Fa-f]{6})(?![0-9A-Za-z])/g;
  const BLOCKS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE']);

  const st = { notes: [], current: null, dirty: false, timer: null, saving: null, range: null, bound: false, dir: '' };
  const editor = () => $('#notes-editor');
  const isHex = (raw) => raw.startsWith('#') || /\d/.test(raw) || /^([A-F])\1([A-F])\2([A-F])\3$/.test(raw);
  const hexOf = (raw) => raw.replace('#', '').toUpperCase();

  // ---------- Liens (projet, export, fichier, dossier) et images ----------
  const LINK_AT = /^\[([^\]]*)\]\(<(projet|fichier|dossier|export):([^>]*)>\)/;
  const IMG_AT = /^!\[[^\]]*\]\(<image:([^>]*)>\)/;
  const KINDS = {
    projet: { icon: 'clapper', what: 'Projet Premiere Pro' },
    fichier: { icon: 'file', what: 'Fichier' },
    dossier: { icon: 'folder', what: 'Dossier' },
    export: { icon: 'film', what: 'Export' }
  };
  const isAbs = (p) => /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(p);
  const imgPath = (src) => (isAbs(src) ? src : joinPath(st.dir, src.split('/').join(sep())));

  function linkHtml(kind, target, label) {
    const k = KINDS[kind];
    const tip = `${k.what} : ${target}\nClic : ouvrir · Ctrl+clic : afficher dans l'Explorateur`;
    return `<span class="link-chip k-${kind}" contenteditable="false" data-kind="${kind}" data-target="${esc(target)}" data-label="${esc(label)}" title="${esc(tip)}">${icon(k.icon)}<span>${esc(label)}</span></span>`;
  }

  function imgHtml(src) {
    return `<img class="note-img" data-src="${esc(src)}" src="${mediaUrl(imgPath(src))}" alt="" draggable="false" />`;
  }

  // ---------- Texte enregistré -> éditeur ----------
  function parseInline(src) {
    let html = '';
    const stack = []; // balises ouvertes : { tag, attr }
    const open = (tag, attr = '') => {
      stack.push({ tag, attr });
      html += `<${tag}${attr}>`;
    };
    // Ferme une balise même si d'autres ont été ouvertes après (elles sont rouvertes ensuite).
    const close = (tag) => {
      let i = stack.length - 1;
      while (i >= 0 && stack[i].tag !== tag) i--;
      if (i < 0) return;
      const popped = stack.splice(i);
      for (let k = popped.length - 1; k >= 0; k--) html += `</${popped[k].tag}>`;
      popped.slice(1).forEach((t) => open(t.tag, t.attr));
    };
    for (let i = 0; i < src.length; ) {
      if (src[i] === '\\' && i + 1 < src.length) {
        html += esc(src[i + 1]);
        i += 2;
      } else if ((src[i] === '[' || src[i] === '!') && (LINK_AT.test(src.slice(i)) || IMG_AT.test(src.slice(i)))) {
        const rest = src.slice(i);
        const im = IMG_AT.exec(rest);
        const lm = im ? null : LINK_AT.exec(rest);
        html += im ? imgHtml(im[1]) : linkHtml(lm[2], lm[3], lm[1]);
        i += (im || lm)[0].length;
      } else if (src.startsWith('**', i)) {
        stack.some((t) => t.tag === 'b') ? close('b') : open('b');
        i += 2;
      } else if (/^\{#[0-9a-fA-F]{6}\}/.test(src.slice(i, i + 9))) {
        open('font', ` color="#${src.slice(i + 2, i + 8).toLowerCase()}"`);
        i += 9;
      } else if (src.startsWith('{/}', i)) {
        close('font');
        i += 3;
      } else {
        html += esc(src[i]);
        i++;
      }
    }
    for (let k = stack.length - 1; k >= 0; k--) html += `</${stack[k].tag}>`;
    return html;
  }

  function parse(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return lines
      .map((line) => {
        const m = line.match(/^(#{1,2}) (.*)$/);
        const tag = m ? (m[1].length === 1 ? 'h1' : 'h2') : 'div';
        const inner = parseInline(m ? m[2] : line);
        return `<${tag}>${inner || '<br>'}</${tag}>`;
      })
      .join('');
  }

  // ---------- Éditeur -> texte enregistré ----------
  const escText = (t) =>
    t
      .replace(/\\/g, '\\\\')
      .replace(/\*\*/g, '\\*\\*')
      .replace(/\{(#[0-9a-fA-F]{6}\}|\/\})/g, '\\{$1');

  function colorOfEl(el) {
    let c = el.tagName === 'FONT' ? el.getAttribute('color') : el.style && el.style.color;
    if (!c) return null;
    const m = c.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) c = '#' + m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    return /^#[0-9a-fA-F]{6}$/.test(c) ? c.toUpperCase() : null;
  }
  const isBold = (el) => el.tagName === 'B' || el.tagName === 'STRONG' || (el.style && /^(bold|[6-9]00)$/.test(el.style.fontWeight));

  function serialize(root) {
    const lines = [{ prefix: '', text: '' }];
    const stack = []; // marqueurs ouverts : '**' ou '{#xxxxxx}'
    let started = false;
    let pending = false; // du texte qui suit un bloc commence une nouvelle ligne
    const cur = () => lines[lines.length - 1];
    const closer = (m) => (m === '**' ? '**' : '{/}');
    const newLine = (prefix) => {
      for (let k = stack.length - 1; k >= 0; k--) cur().text += closer(stack[k]);
      lines.push({ prefix, text: stack.join('') });
    };
    const startBlock = (prefix) => {
      if (started) newLine(prefix);
      else cur().prefix = prefix;
      started = true;
      pending = false;
    };
    const inlineStart = (prefix) => {
      if (pending) newLine(prefix);
      pending = false;
      started = true;
    };
    const walk = (node, prefix) => {
      if (node.nodeType === 3) {
        if (!node.data) return;
        inlineStart(prefix);
        node.data.split('\n').forEach((p, i) => {
          if (i) newLine(prefix);
          cur().text += escText(p.replace(/\u00a0/g, ' '));
        });
        return;
      }
      if (node.nodeType !== 1) return;
      const el = node;
      if (el.classList.contains('hex-chip')) {
        inlineStart(prefix);
        cur().text += el.dataset.raw || '';
        return;
      }
      if (el.classList.contains('link-chip')) {
        inlineStart(prefix);
        cur().text += `[${(el.dataset.label || '').replace(/[[\]]/g, '')}](<${el.dataset.kind}:${el.dataset.target}>)`;
        return;
      }
      if (el.tagName === 'IMG') {
        if (el.dataset.src) {
          inlineStart(prefix);
          cur().text += `![](<image:${el.dataset.src}>)`;
        }
        return;
      }
      if (el.tagName === 'BR') {
        // Le <br> seul d'une ligne vide n'est pas un saut de ligne de plus.
        if (el.parentNode !== root && BLOCKS.has(el.parentNode.tagName) && !el.nextSibling) return;
        inlineStart(prefix);
        newLine(prefix);
        return;
      }
      let blockPrefix = prefix;
      const isBlock = BLOCKS.has(el.tagName) && el !== root;
      if (isBlock) {
        blockPrefix = el.tagName === 'H1' ? '# ' : el.tagName === 'H2' || el.tagName === 'H3' ? '## ' : '';
        if (el.tagName !== 'UL' && el.tagName !== 'OL') startBlock(blockPrefix);
      }
      const marks = [];
      if (isBold(el)) marks.push('**');
      const color = colorOfEl(el);
      if (color) marks.push(`{${color}}`);
      for (const m of marks) {
        cur().text += m;
        stack.push(m);
      }
      for (const child of el.childNodes) walk(child, blockPrefix);
      for (const m of marks.reverse()) {
        stack.pop();
        cur().text += closer(m);
      }
      if (isBlock) pending = true;
    };
    walk(root, '');
    return lines
      .map((l) => {
        const text = l.text.replace(/\*\*\*\*/g, '').replace(/\{#[0-9A-Fa-f]{6}\}\{\/\}/g, '');
        if (l.prefix) return l.prefix + text;
        return /^#{1,2} /.test(text) ? '\\' + text : text;
      })
      .join('\n');
  }

  // ---------- Codes couleur ----------
  function chip(raw) {
    const hex = hexOf(raw);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const el = document.createElement('span');
    el.className = `hex-chip${lum < 0.28 ? ' dark' : ''}`;
    el.contentEditable = 'false';
    el.dataset.raw = raw;
    el.title = `Cliquer pour copier ${hex}`;
    el.style.setProperty('--hc', `#${hex}`);
    el.innerHTML = '<i></i>';
    el.appendChild(document.createTextNode(raw));
    return el;
  }

  // Transforme les codes complets en pastilles, sauf celui qu'on est en train d'écrire.
  function decorate(root, keepCaret) {
    const sel = window.getSelection();
    const caret = keepCaret && sel.rangeCount && sel.isCollapsed ? { node: sel.anchorNode, offset: sel.anchorOffset } : null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest('.hex-chip') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let moved = null;
    for (let node of nodes) {
      HEX_RE.lastIndex = 0;
      let m;
      const found = [];
      while ((m = HEX_RE.exec(node.data))) {
        const start = m.index + m[1].length;
        const end = start + m[2].length;
        if (!isHex(m[2])) continue;
        if (caret && caret.node === node && caret.offset >= start && caret.offset <= end) continue;
        found.push({ start, end, raw: m[2] });
      }
      // De la fin vers le début : les positions restent justes.
      for (const f of found.reverse()) {
        const after = node.splitText(f.end);
        const mid = node.splitText(f.start);
        mid.replaceWith(chip(f.raw));
        if (caret && caret.node === node && caret.offset >= f.end) {
          caret.node = after;
          caret.offset -= f.end;
          moved = caret;
        }
      }
    }
    if (moved) {
      const r = document.createRange();
      r.setStart(moved.node, Math.min(moved.offset, moved.node.length));
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }

  async function copyChip(el) {
    const hex = hexOf(el.dataset.raw);
    await api.copyText(hex);
    el.classList.remove('copied');
    void el.offsetWidth;
    el.classList.add('copied');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('copied'), 1400);
    toast(`Couleur copiée : ${hex}`);
  }

  // ---------- Commandes ----------
  function inEditor(range) {
    return range && editor().contains(range.commonAncestorContainer);
  }

  function currentBlock() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    let n = sel.anchorNode;
    while (n && n !== editor()) {
      if (n.nodeType === 1 && BLOCKS.has(n.tagName)) return n;
      n = n.parentNode;
    }
    return null;
  }

  // MAJUSCULES sur la sélection (un 2e clic remet en minuscules), sans perdre gras ni couleurs.
  function toggleUpper() {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed || !inEditor(sel.getRangeAt(0))) {
      toast('Sélectionne le texte à mettre en majuscules.', 'err');
      return;
    }
    const range = sel.getRangeAt(0);
    const text = range.toString();
    const toUpper = text !== text.toUpperCase();
    const walker = document.createTreeWalker(editor(), NodeFilter.SHOW_TEXT);
    const { startContainer: sc, startOffset: so, endContainer: ec, endOffset: eo } = range;
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!range.intersectsNode(n) || n.parentElement.closest('.hex-chip')) continue;
      const a = n === sc ? so : 0;
      const b = n === ec ? eo : n.length;
      const mid = n.data.slice(a, b);
      const conv = toUpper ? mid.toUpperCase() : mid.toLowerCase();
      if (conv.length === mid.length) n.data = n.data.slice(0, a) + conv + n.data.slice(b);
    }
    const r = document.createRange();
    r.setStart(sc, Math.min(so, sc.length != null ? sc.length : so));
    r.setEnd(ec, Math.min(eo, ec.length != null ? ec.length : eo));
    sel.removeAllRanges();
    sel.addRange(r);
    changed();
  }

  function run(cmd, value) {
    editor().focus();
    document.execCommand('styleWithCSS', false, false);
    if (cmd === 'bold') document.execCommand('bold');
    else if (cmd === 'upper') return toggleUpper();
    else if (cmd === 'h1' || cmd === 'h2') {
      const b = currentBlock();
      document.execCommand('formatBlock', false, b && b.tagName === cmd.toUpperCase() ? 'div' : cmd);
    } else if (cmd === 'p') document.execCommand('formatBlock', false, 'div');
    else if (cmd === 'color') document.execCommand('foreColor', false, value);
    else if (cmd === 'clear') document.execCommand('removeFormat');
    else if (cmd === 'smaller' || cmd === 'bigger') return setSize(readSize() + (cmd === 'bigger' ? 1 : -1));
    else if (cmd === 'emoji') {
      const b = $('#notes-toolbar [data-cmd="emoji"]').getBoundingClientRect();
      return openEmoji(b.left, b.bottom + 6, caretRange());
    }
    changed();
  }

  // ---------- Insertion ----------
  function caretRange() {
    const sel = window.getSelection();
    if (sel.rangeCount && inEditor(sel.getRangeAt(0))) return sel.getRangeAt(0).cloneRange();
    // Pas de curseur dans la note : à la fin.
    const r = document.createRange();
    r.selectNodeContents(editor().lastElementChild || editor());
    r.collapse(false);
    return r;
  }

  function placeCaret(range) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function rangeRect(range) {
    const rects = range.getClientRects();
    const r = rects.length ? rects[0] : range.getBoundingClientRect();
    if (r && (r.left || r.top)) return r;
    const box = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement).getBoundingClientRect();
    return { left: box.left, top: box.top, bottom: box.top + 20 };
  }

  // Insère du HTML (lien, image) à l'endroit voulu, suivi d'un espace, curseur après.
  function insertAt(range, html) {
    const ed = editor();
    if (!range || !ed.contains(range.startContainer)) range = caretRange();
    range.collapse(false);
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const space = document.createTextNode(' ');
    tpl.content.appendChild(space);
    range.insertNode(tpl.content);
    const after = document.createRange();
    after.setStartAfter(space);
    after.collapse(true);
    ed.focus();
    placeCaret(after);
    changed();
  }

  async function markMissing() {
    const chips = $$('.link-chip', editor());
    if (!chips.length) return;
    const ok = await api.notesExists(chips.map((c) => c.dataset.target));
    chips.forEach((c, i) => {
      c.classList.toggle('missing', !ok[i]);
      if (!ok[i]) c.title = `Introuvable : ${c.dataset.target}`;
    });
  }

  function openLink(chip, reveal) {
    const target = chip.dataset.target;
    if (chip.classList.contains('missing')) return toast(`Introuvable : ${target}`, 'err');
    if (reveal && chip.dataset.kind !== 'dossier') api.reveal(target);
    else api.open(target);
  }

  // ---------- Commandes « / » ----------
  const COMMANDS = [
    { id: 'projet', keys: ['projet', 'projets', 'premiere', 'prproj'], icon: 'clapper', hint: 'Lier un projet Premiere Pro' },
    { id: 'export', keys: ['export', 'exports', 'video'], icon: 'film', hint: 'Lier une vidéo exportée' },
    { id: 'file', keys: ['file', 'fichier'], icon: 'file', hint: 'Lier un fichier du PC' },
    { id: 'folder', keys: ['folder', 'dossier'], icon: 'folder', hint: 'Lier un dossier du PC' },
    { id: 'image', keys: ['image', 'photo', 'img'], icon: 'image', hint: 'Ajouter une image' },
    { id: 'emoji', keys: ['emoji', 'smiley'], icon: 'smile', hint: 'Ajouter un emoji' },
    { id: 'titre', keys: ['titre', 'h1'], icon: 'heading', hint: 'Transformer la ligne en titre' },
    { id: 'soustitre', keys: ['soustitre', 'sous-titre', 'h2'], icon: 'heading2', hint: 'Transformer la ligne en sous-titre' }
  ];
  const menu = { open: false, items: [], index: 0, mode: null, range: null, slash: null };

  function matchCommands(q) {
    const query = q.toLowerCase();
    return COMMANDS.filter((c) => !query || c.keys.some((k) => k.startsWith(query)));
  }

  function showMenu(items, x, y, mode) {
    const el = $('#cmd-menu');
    Object.assign(menu, { open: true, items, index: 0, mode });
    el.innerHTML =
      `<div class="cm-head">${mode === 'context' ? 'Insérer ici' : 'Commandes'}</div>` +
      items.map((c, i) => `<button class="cm-item ${i === 0 ? 'active' : ''}" data-i="${i}">${icon(c.icon)}<b>/${c.id}</b><span>${c.hint}</span></button>`).join('');
    el.classList.remove('hidden');
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(x, innerWidth - w - 8))}px`;
    el.style.top = `${y + h > innerHeight - 8 ? Math.max(8, y - h - 28) : y}px`;
  }

  function hideMenu() {
    menu.open = false;
    menu.slash = null;
    $('#cmd-menu').classList.add('hidden');
  }

  function moveMenu(d) {
    menu.index = (menu.index + d + menu.items.length) % menu.items.length;
    $$('#cmd-menu .cm-item').forEach((b, i) => b.classList.toggle('active', i === menu.index));
  }

  function chooseMenu(i) {
    const c = menu.items[i];
    if (!c) return;
    let range = menu.range;
    if (menu.mode === 'slash' && menu.slash) {
      // Le « /commande » tapé est remplacé par le résultat.
      const { node, start, end } = menu.slash;
      range = document.createRange();
      range.setStart(node, Math.max(0, start));
      range.setEnd(node, Math.min(end, node.length));
      range.deleteContents();
    }
    hideMenu();
    runCommand(c.id, range);
  }

  // Ouvre le menu quand on tape « / » au début d'un mot.
  function checkSlash() {
    const sel = window.getSelection();
    const node = sel.anchorNode;
    if (!sel.rangeCount || !sel.isCollapsed || !node || node.nodeType !== 3 || !editor().contains(node)) {
      if (menu.mode === 'slash') hideMenu();
      return;
    }
    const before = node.data.slice(0, sel.anchorOffset);
    const m = /(?:^|\s)\/([a-zA-ZÀ-ÿ-]{0,12})$/.exec(before);
    const items = m ? matchCommands(m[1]) : [];
    if (!items.length) {
      if (menu.mode === 'slash') hideMenu();
      return;
    }
    menu.slash = { node, start: sel.anchorOffset - m[1].length - 1, end: sel.anchorOffset };
    const rect = rangeRect(sel.getRangeAt(0));
    showMenu(items, rect.left, rect.bottom + 6, 'slash');
  }

  async function runCommand(id, range) {
    const ed = editor();
    if (!st.current) return;
    if (!range || !ed.contains(range.startContainer)) range = caretRange();
    ed.focus();
    placeCaret(range);
    if (id === 'titre') return run('h1');
    if (id === 'soustitre') return run('h2');
    if (id === 'emoji') {
      const r = rangeRect(range);
      return openEmoji(r.left, r.bottom + 6, range);
    }
    if (id === 'projet' || id === 'export') return openPicker(id, range);
    const r = await api.notesPick(id);
    if (!r.ok) return toast(r.error, 'err');
    if (r.canceled) return;
    insertAt(range, id === 'image' ? imgHtml(r.rel) : linkHtml(id === 'file' ? 'fichier' : 'dossier', r.path, r.name));
    markMissing();
  }

  function renderCmdBar() {
    $('#notes-cmds').innerHTML =
      `<span class="nc-label">${icon('command')}Commandes</span>` +
      COMMANDS.slice(0, 6).map((c) => `<button data-run="${c.id}" title="${c.hint}">${icon(c.icon)}/${c.id}</button>`).join('') +
      '<span class="nc-tip">Tape « / » dans la note ou fais un clic droit</span>';
  }

  // ---------- Choix d'un projet Premiere ou d'un export ----------
  const picker = { kind: null, range: null, all: [], shown: [], index: 0 };

  async function openPicker(kind, range) {
    Object.assign(picker, { kind, range, all: [], shown: [], index: 0 });
    $('#np-title').textContent = kind === 'projet' ? 'Choisir un projet Premiere Pro' : 'Choisir un export';
    $('#np-search').value = '';
    $('#np-list').innerHTML = '<div class="list-loading"><span class="spinner"></span>Recherche dans tes projets…</div>';
    $('#note-picker').classList.remove('hidden');
    setTimeout(() => $('#np-search').focus(), 30);
    const items = [];
    if (kind === 'projet') {
      if (!state.library) state.library = await api.scanLibrary();
      for (const p of state.library || []) {
        const meta = (state.settings.projects || {})[p.dir] || {};
        for (const f of p.prproj || []) items.push({ path: f.path, label: f.name.replace(/\.prproj$/i, ''), sub: p.name, date: f.mtime, color: meta.color || colorOf(p.name) });
      }
    } else {
      if (!state.exports) state.exports = await api.scanExports();
      for (const e of state.exports || []) {
        const bits = [e.project, e.version, e.aspect !== 'Inconnu' ? e.aspect : '', e.ext].filter(Boolean);
        items.push({ path: e.path, label: e.name, sub: bits.join(' · '), date: e.mtime, color: colorOf(e.project || e.name) });
      }
    }
    if (picker.kind !== kind) return;
    picker.all = items.sort((a, b) => b.date - a.date);
    renderPicker();
  }

  function renderPicker() {
    const words = $('#np-search').value.toLowerCase().split(/\s+/).filter(Boolean);
    picker.shown = picker.all.filter((it) => words.every((w) => `${it.label} ${it.sub}`.toLowerCase().includes(w)));
    picker.index = Math.min(picker.index, Math.max(0, picker.shown.length - 1));
    const kindIcon = picker.kind === 'projet' ? 'clapper' : 'film';
    $('#np-list').innerHTML = picker.shown.length
      ? picker.shown
          .slice(0, 200)
          .map(
            (it, i) => `<button class="np-item ${i === picker.index ? 'active' : ''}" data-i="${i}">
              <span class="np-ico" style="--pc:${it.color}">${icon(kindIcon)}</span>
              <span class="np-text"><b>${esc(it.label)}</b><span>${esc(it.sub)}</span></span>
              <span class="np-date">${shortDate(it.date)}</span>
            </button>`
          )
          .join('')
      : `<div class="empty">${picker.all.length ? 'Aucun résultat.' : picker.kind === 'projet' ? 'Aucun projet Premiere trouvé dans le dossier des projets.' : 'Aucun export trouvé dans tes projets.'}</div>`;
  }

  function closePicker() {
    $('#note-picker').classList.add('hidden');
    picker.kind = null;
  }

  function choosePicker(i) {
    const it = picker.shown[i];
    if (!it) return;
    const kind = picker.kind;
    const range = picker.range;
    closePicker();
    insertAt(range, linkHtml(kind, it.path, it.label));
    markMissing();
  }

  // ---------- Emojis ----------
  const EMOJI_GROUPS = [
    ['Smileys', '😀 😃 😄 😁 😆 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😎 🤩 🥳 🤔 🤨 😐 😴 😅 😬 🙄 😮 😱 😭 😢 😡 🤯 🤗 🤫 🤝'],
    ['Montage', '🎬 🎥 📹 🎞️ 📽️ 📺 🎧 🎵 🎶 🎙️ 🎤 🔊 🔇 📷 📸 🖼️ 🎨 🖌️ ✂️ 💻 🖥️ ⌨️ 🖱️ 💾 💿 🎚️ 🎛️ 🔦 💡'],
    ['Travail', '✅ ☑️ ❌ ⚠️ ❗ ❓ 📌 📍 📎 📁 📂 🗂️ 📝 ✏️ 🖊️ 📅 📆 ⏰ ⏳ ⌛ 🚀 🎯 📈 📉 💰 💸 📧 📞 🔗 🔒 🔑 🏁 🔁'],
    ['Cœurs', '❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 💔 💯 ✨ ⭐ 🌟 💫 🔥 ⚡ 💥 🎉 🎊 🏆 🥇 👑'],
    ['Gestes', '👍 👎 👏 🙌 🙏 💪 👋 🤙 👌 ✌️ 🤞 👉 👈 👆 👇 ✋ 🫶 🤌 👀 🧠'],
    ['Café', '☕ 🍵 🥐 🍩 🍪 🍫 🍰 🧁 🍕 🍔 🍟 🌮 🥗 🍎 🍓 🍉 🍺 🍷 🥂'],
    ['Nature', '☀️ 🌙 🌈 ☁️ ⛅ 🌧️ ❄️ 🌊 🌴 🌵 🌸 🌻 🍁 🐶 🐱 🦊 🐻 🐼 🦁 🐸 🦖'],
    ['Couleurs', '🔴 🟠 🟡 🟢 🔵 🟣 🟤 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 ⬛ ⬜']
  ];
  const EMOJI_WORDS = {
    '😀': 'content sourire', '😂': 'rire mdr lol', '😍': 'amour adore', '😎': 'cool lunettes', '🥳': 'fete anniversaire', '🤔': 'reflechir hmm question',
    '😅': 'oups gene', '😱': 'peur choc', '😭': 'pleurer triste', '😡': 'colere enerve', '😴': 'dormir fatigue', '🤯': 'choc fou',
    '🎬': 'clap film tournage montage', '🎥': 'camera video', '📹': 'camescope video', '🎞️': 'pellicule film rush', '🎧': 'casque son audio', '🎵': 'musique note',
    '🎙️': 'micro voix podcast', '🔊': 'son volume', '📷': 'photo appareil', '🖼️': 'image cadre', '🎨': 'couleur etalonnage palette', '✂️': 'couper cut ciseaux',
    '💻': 'ordinateur pc', '💾': 'sauvegarde disquette', '💡': 'idee lampe', '✅': 'ok fait valide check', '❌': 'non faux annule', '⚠️': 'attention alerte',
    '❗': 'important', '❓': 'question', '📌': 'epingle important', '📎': 'piece jointe trombone', '📁': 'dossier', '📝': 'note ecrire',
    '📅': 'date calendrier deadline', '⏰': 'reveil heure deadline', '⏳': 'attente temps', '🚀': 'fusee lancement rapide', '🎯': 'objectif cible', '💰': 'argent paye facture',
    '📧': 'mail email', '📞': 'telephone appel', '🔗': 'lien', '🔒': 'cadenas prive', '❤️': 'coeur amour rouge', '💯': 'cent parfait',
    '✨': 'brillant magie', '⭐': 'etoile favori', '🔥': 'feu top chaud', '⚡': 'eclair rapide', '🎉': 'fete bravo', '🏆': 'trophee gagne',
    '👍': 'pouce ok bien', '👎': 'pouce bas nul', '👏': 'bravo applaudir', '🙏': 'merci svp', '💪': 'force muscle', '👋': 'salut bonjour',
    '👀': 'regarder yeux voir', '🧠': 'cerveau idee', '☕': 'cafe coffee', '🍕': 'pizza', '🍺': 'biere', '🦖': 'dino dinosaure',
    '🔴': 'rouge', '🟠': 'orange', '🟡': 'jaune', '🟢': 'vert', '🔵': 'bleu', '🟣': 'violet', '🟤': 'marron', '⚫': 'noir', '⚪': 'blanc'
  };
  const RECENT_KEY = 'coffile-notes-emojis';
  const emoji = { range: null };
  const plain = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  function recentEmojis() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
    } catch {
      return [];
    }
  }

  function renderEmoji() {
    const q = plain($('#emoji-search') ? $('#emoji-search').value.trim() : '');
    const groups = q
      ? [['Résultats', Object.keys(EMOJI_WORDS).filter((e) => plain(EMOJI_WORDS[e]).includes(q)).join(' ')]]
      : [['Récents', recentEmojis().join(' ')], ...EMOJI_GROUPS];
    $('#emoji-grid').innerHTML =
      groups
        .filter(([, list]) => list)
        .map(([name, list]) => `<div class="ep-group">${name}</div><div class="ep-row">${list.split(' ').map((e) => `<button data-emoji="${e}">${e}</button>`).join('')}</div>`)
        .join('') || '<div class="empty">Aucun emoji.</div>';
  }

  function openEmoji(x, y, range) {
    emoji.range = range;
    const pop = $('#emoji-pop');
    pop.innerHTML = `<div class="input-wrap search"><span class="input-ico">${icon('search')}</span><input id="emoji-search" placeholder="Chercher : café, ok, feu…" spellcheck="false" /></div><div class="ep-grid" id="emoji-grid"></div>`;
    renderEmoji();
    pop.classList.remove('hidden');
    pop.style.left = `${Math.max(8, Math.min(x, innerWidth - pop.offsetWidth - 8))}px`;
    pop.style.top = `${y + pop.offsetHeight > innerHeight - 8 ? Math.max(8, y - pop.offsetHeight - 30) : y}px`;
    $('#emoji-search').addEventListener('input', renderEmoji);
    $('#emoji-search').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeEmoji(true);
      }
      if (e.key === 'Enter') {
        // Sans ça, l'Entrée irait aussi dans la note (nouvelle ligne).
        e.preventDefault();
        const first = $('#emoji-grid [data-emoji]');
        if (first) pickEmoji(first.dataset.emoji);
      }
    });
    setTimeout(() => $('#emoji-search').focus(), 20);
  }

  function closeEmoji(refocus) {
    $('#emoji-pop').classList.add('hidden');
    if (refocus && emoji.range) {
      editor().focus();
      placeCaret(emoji.range);
    }
  }

  function pickEmoji(e) {
    const range = emoji.range && editor().contains(emoji.range.startContainer) ? emoji.range : caretRange();
    closeEmoji(false);
    editor().focus();
    placeCaret(range);
    document.execCommand('insertText', false, e);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...recentEmojis().filter((x) => x !== e)].slice(0, 16)));
    } catch {}
    changed();
  }

  // ---------- Taille du texte ----------
  const SIZE_KEY = 'coffile-notes-size';
  function setSize(v) {
    const size = Math.max(11, Math.min(32, v));
    editor().style.fontSize = `${size}px`;
    $('#notes-size').textContent = size;
    try {
      localStorage.setItem(SIZE_KEY, String(size));
    } catch {}
  }
  function readSize() {
    try {
      return Number(localStorage.getItem(SIZE_KEY)) || 15;
    } catch {
      return 15;
    }
  }

  // ---------- Plein écran ----------
  function setFull(on) {
    document.body.classList.toggle('notes-focus', on);
    $('#notes-full').innerHTML = `${icon(on ? 'shrink' : 'expand')}<span>${on ? 'Quitter le plein écran' : 'Plein écran'}</span>`;
    if (on) editor().focus();
  }

  // ---------- Enregistrement ----------
  function setStatus(text, cls = '') {
    const el = $('#notes-status');
    el.textContent = text;
    el.className = `notes-status ${cls}`;
  }

  function changed() {
    if (!st.current) return;
    st.dirty = true;
    setStatus('Modifié…');
    clearTimeout(st.timer);
    st.timer = setTimeout(save, 500);
  }

  async function save() {
    clearTimeout(st.timer);
    if (!st.current || !st.dirty) return st.saving;
    const name = st.current;
    const content = serialize(editor());
    st.dirty = false;
    setStatus('Enregistrement…');
    st.saving = api.notesSave(name, content).then((r) => {
      if (!r.ok) {
        st.dirty = true;
        setStatus('Erreur d\'enregistrement', 'err');
        toast(r.error, 'err');
        return;
      }
      const n = st.notes.find((x) => x.name === name);
      if (n) {
        n.mtime = r.mtime;
        n.preview = content
          .replace(/!\[[^\]]*\]\(<image:[^>]*>\)/g, '🖼')
          .replace(/\[([^\]]*)\]\(<(?:projet|fichier|dossier|export):[^>]*>\)/g, '$1')
          .replace(/\{#[0-9a-fA-F]{6}\}|\{\/\}|\*\*/g, '').replace(/^#{1,2} /gm, '').replace(/\s+/g, ' ').trim().slice(0, 140);
      }
      if (st.current === name && !st.dirty) setStatus('Enregistré', 'ok');
      renderList();
    });
    return st.saving;
  }

  // ---------- Feuilles ----------
  function renderList() {
    const list = $('#notes-list');
    if (!st.notes.length) {
      list.innerHTML = '<div class="notes-empty">Aucune feuille pour l\'instant.</div>';
      return;
    }
    const sorted = st.notes.slice().sort((a, b) => b.mtime - a.mtime);
    list.innerHTML = sorted
      .map(
        (n) => `<button class="note-item ${n.name === st.current ? 'active' : ''}" data-note="${esc(n.name)}">
          <span class="note-name">${icon('note')}<b>${esc(n.name)}</b></span>
          <span class="note-prev">${esc(n.preview || 'Vide')}</span>
          <span class="note-date">${shortDate(n.mtime)}</span>
        </button>`
      )
      .join('');
    $('#notes-dir').innerHTML = `${icon('folder')}<span title="${esc(st.dir)}">${esc(st.dir)}</span>`;
  }

  function renderMain() {
    const has = !!st.current;
    $('#notes-main').classList.toggle('empty', !has);
    $('#notes-title').disabled = !has;
    $('#notes-delete').disabled = !has;
    editor().contentEditable = has ? 'true' : 'false';
    if (!has) {
      $('#notes-title').value = '';
      editor().innerHTML = '';
      setStatus('');
    }
  }

  async function select(name) {
    await save();
    await st.saving;
    st.current = name;
    renderList();
    renderMain();
    const r = await api.notesRead(name);
    if (st.current !== name) return;
    $('#notes-title').value = name;
    editor().innerHTML = r.ok ? parse(r.content) : '';
    decorate(editor(), false);
    markMissing();
    st.dirty = false;
    setStatus(r.ok ? 'Enregistré' : r.error, r.ok ? 'ok' : 'err');
  }

  async function refresh() {
    const r = await api.notesList();
    if (!r.ok) {
      toast(r.error, 'err');
      return;
    }
    st.dir = r.dir;
    // Garde les aperçus à jour, sans perdre une feuille en cours d'écriture.
    st.notes = r.notes;
    if (st.current && !st.notes.some((n) => n.name === st.current)) st.current = null;
    renderList();
    if (!st.current && st.notes.length) await select(st.notes[0].name);
    else renderMain();
  }

  async function createNote() {
    await save();
    const r = await api.notesCreate('Nouvelle note');
    if (!r.ok) return toast(r.error, 'err');
    st.notes.unshift({ name: r.name, mtime: Date.now(), preview: '' });
    await select(r.name);
    const t = $('#notes-title');
    t.focus();
    t.select();
  }

  async function renameCurrent() {
    const t = $('#notes-title');
    const to = t.value.trim();
    const from = st.current;
    if (!from || !to || to === from) {
      t.value = from || '';
      return;
    }
    await save();
    await st.saving;
    const r = await api.notesRename(from, to);
    if (!r.ok) {
      toast(r.error, 'err');
      t.value = from;
      return;
    }
    const n = st.notes.find((x) => x.name === from);
    if (n) n.name = r.name;
    st.current = r.name;
    t.value = r.name;
    renderList();
    if (r.name !== to) toast(`Une feuille porte déjà ce nom : renommée « ${r.name} ».`);
  }

  async function deleteCurrent() {
    const name = st.current;
    if (!name || !confirm(`Mettre la feuille « ${name} » à la corbeille ?`)) return;
    clearTimeout(st.timer);
    st.dirty = false;
    const r = await api.notesDelete(name);
    if (!r.ok) return toast(r.error, 'err');
    st.notes = st.notes.filter((n) => n.name !== name);
    st.current = null;
    toast(`« ${name} » est dans la corbeille.`);
    if (st.notes.length) await select(st.notes.slice().sort((a, b) => b.mtime - a.mtime)[0].name);
    else {
      renderList();
      renderMain();
    }
  }

  // ---------- Branchements ----------
  function bind() {
    const ed = editor();
    document.execCommand('defaultParagraphSeparator', false, 'div');
    $('#notes-colors').innerHTML = PRESETS.map((c) => `<button class="tb-color" data-color="${c}" style="--c:${c}" title="${c.slice(1).toUpperCase()}"></button>`).join('');
    // Les boutons ne prennent pas le focus : la sélection du texte reste en place.
    $('#notes-toolbar').addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) e.preventDefault();
      if (e.target.closest('.tb-custom')) {
        const sel = window.getSelection();
        st.range = sel.rangeCount && inEditor(sel.getRangeAt(0)) ? sel.getRangeAt(0).cloneRange() : null;
      }
    });
    $('#notes-toolbar').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !st.current) return;
      if (b.dataset.color) run('color', b.dataset.color);
      else if (b.dataset.cmd) run(b.dataset.cmd);
    });
    $('#notes-color-input').addEventListener('change', (e) => {
      if (!st.current) return;
      if (st.range) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(st.range);
      }
      run('color', e.target.value);
    });
    ed.addEventListener('input', () => {
      decorate(ed, true);
      checkSlash();
      changed();
    });
    ed.addEventListener('blur', () => {
      decorate(ed, false);
      save();
      setTimeout(() => {
        if (menu.mode === 'slash' && document.activeElement !== ed) hideMenu();
      }, 150);
    });
    // Clic droit : le menu des commandes, inséré à l'endroit du clic.
    ed.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!st.current) return;
      const sel = window.getSelection();
      let range = null;
      if (sel.rangeCount && !sel.isCollapsed && inEditor(sel.getRangeAt(0))) {
        const inside = [...sel.getRangeAt(0).getClientRects()].some((r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
        if (inside) range = sel.getRangeAt(0).cloneRange();
      }
      if (!range) {
        const r = document.caretRangeFromPoint(e.clientX, e.clientY);
        range = r && ed.contains(r.startContainer) && !r.startContainer.parentElement.closest('.hex-chip, .link-chip') ? r : caretRange();
        ed.focus();
        placeCaret(range);
      }
      menu.range = range;
      showMenu(COMMANDS, e.clientX, e.clientY, 'context');
    });
    $('#cmd-menu').addEventListener('mousedown', (e) => e.preventDefault());
    $('#cmd-menu').addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) chooseMenu(Number(b.dataset.i));
    });
    $('#cmd-menu').addEventListener('mousemove', (e) => {
      const b = e.target.closest('[data-i]');
      if (b && Number(b.dataset.i) !== menu.index) moveMenu(Number(b.dataset.i) - menu.index);
    });
    document.addEventListener('mousedown', (e) => {
      if (menu.open && !e.target.closest('#cmd-menu')) hideMenu();
      if (!$('#emoji-pop').classList.contains('hidden') && !e.target.closest('#emoji-pop') && !e.target.closest('[data-cmd="emoji"], [data-run="emoji"]')) closeEmoji(false);
    });
    $('#emoji-pop').addEventListener('mousedown', (e) => {
      if (e.target.closest('[data-emoji]')) e.preventDefault();
    });
    $('#emoji-pop').addEventListener('click', (e) => {
      const b = e.target.closest('[data-emoji]');
      if (b) pickEmoji(b.dataset.emoji);
    });
    renderCmdBar();
    $('#notes-cmds').addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) e.preventDefault();
    });
    $('#notes-cmds').addEventListener('click', (e) => {
      const b = e.target.closest('[data-run]');
      if (b) runCommand(b.dataset.run, caretRange());
    });
    $('#np-search').addEventListener('input', () => {
      picker.index = 0;
      renderPicker();
    });
    $('#np-search').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!picker.shown.length) return;
        picker.index = (picker.index + (e.key === 'ArrowDown' ? 1 : -1) + picker.shown.length) % picker.shown.length;
        renderPicker();
        const act = $('#np-list .np-item.active');
        if (act) act.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        choosePicker(picker.index);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        closePicker();
        editor().focus();
      }
    });
    $('#note-picker').addEventListener('click', (e) => {
      const it = e.target.closest('.np-item');
      if (it) choosePicker(Number(it.dataset.i));
      else if (e.target.id === 'note-picker' || e.target.closest('[data-np-close]')) closePicker();
    });
    $('#notes-full').onclick = () => setFull(!document.body.classList.contains('notes-focus'));
    // Échap : ferme d'abord les menus, puis quitte le plein écran.
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape') return;
        if (menu.open) hideMenu();
        else if (!$('#emoji-pop').classList.contains('hidden')) closeEmoji(true);
        else if (!$('#note-picker').classList.contains('hidden')) closePicker();
        else if (document.body.classList.contains('notes-focus')) setFull(false);
        else return;
        e.stopPropagation();
        e.preventDefault();
      },
      true
    );
    setSize(readSize());
    // Collage en texte simple (pas de mise en forme venue d'ailleurs).
    ed.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
      document.execCommand('insertText', false, text);
    });
    ed.addEventListener('click', (e) => {
      const c = e.target.closest('.hex-chip');
      if (c) return copyChip(c);
      const l = e.target.closest('.link-chip');
      if (l) return openLink(l, e.ctrlKey || e.metaKey);
      if (e.target.tagName === 'IMG') {
        // Image sélectionnée : Suppr ou Retour arrière l'enlève.
        const r = document.createRange();
        r.selectNode(e.target);
        placeCaret(r);
      }
    });
    ed.addEventListener('keydown', (e) => {
      if (menu.open) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          return moveMenu(e.key === 'ArrowDown' ? 1 : -1);
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          return chooseMenu(menu.index);
        }
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        decorate(ed, true);
        st.dirty = true;
        save();
      } else if (e.shiftKey && k === 'u') {
        e.preventDefault();
        run('upper');
      } else if (k === '1' || k === '2') {
        e.preventDefault();
        run(`h${k}`);
      } else if (k === '0') {
        e.preventDefault();
        run('p');
      } else if (k === 'b') setTimeout(changed);
    });
    $('#notes-new').onclick = createNote;
    $('#notes-delete').onclick = deleteCurrent;
    $('#notes-folder').onclick = () => api.notesOpenDir();
    $('#notes-choose').onclick = async () => {
      await save();
      const r = await api.notesChooseDir();
      if (!r.ok) return;
      st.current = null;
      toast(`Dossier des notes : ${r.dir}`);
      refresh();
    };
    const title = $('#notes-title');
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        ed.focus();
      } else if (e.key === 'Escape') {
        title.value = st.current || '';
        ed.focus();
      }
    });
    title.addEventListener('change', renameCurrent);
    $('#notes-list').addEventListener('click', (e) => {
      const it = e.target.closest('[data-note]');
      if (it && it.dataset.note !== st.current) select(it.dataset.note);
    });
    window.addEventListener('beforeunload', () => save());
  }

  async function open() {
    if (!st.bound) {
      st.bound = true;
      bind();
    }
    await refresh();
  }

  window.Notes = { open, parse, serialize, decorate, save, state: st };
})();
