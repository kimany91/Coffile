'use strict';
// Google Drive : analyse des liens, listing des dossiers et téléchargement.
// Deux modes :
//  - sans clé API : page publique "embeddedfolderview" + drive.usercontent.google.com
//  - avec clé API ou compte Google connecté (OAuth) : Google Drive API v3.
//    Le compte connecté donne accès aux Drive privés.
const path = require('path');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const EXT = {
  video: ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'mxf', 'mts', 'm2ts', 'ts', 'webm', 'wmv', 'flv', 'mpg', 'mpeg', '3gp', 'r3d', 'braw', 'insv', 'lrv', 'hevc', 'h264', 'prores', 'dv', 'vob', 'ogv'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff', 'bmp', 'heic', 'heif', 'raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'raf', 'psd', 'svg', 'ai', 'eps', 'avif', 'jfif'],
  audio: ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'aif', 'aiff', 'wma', 'opus']
};

function categoryOf(name, mimeType) {
  const ext = path.extname(name || '').slice(1).toLowerCase();
  if (EXT.video.includes(ext)) return 'video';
  if (EXT.image.includes(ext)) return 'image';
  if (EXT.audio.includes(ext)) return 'audio';
  if (mimeType) {
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('audio/')) return 'audio';
  }
  return 'other';
}

// Accepte les formats de liens Drive courants.
function parseDriveUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    // ID collé directement
    if (/^[\w-]{20,}$/.test(raw)) return { id: raw, kind: 'unknown', resourceKey: null };
    return null;
  }
  // Seulement Drive / Docs : les autres adresses Google (Chat, profils, comptes…) ont aussi des « ?id= ».
  if (!/^(drive|docs|drive\.usercontent)\.google\.com$/.test(url.hostname)) return null;
  const resourceKey = url.searchParams.get('resourcekey');
  let m = url.pathname.match(/\/folders\/([\w-]+)/);
  if (m) return { id: m[1], kind: 'folder', resourceKey };
  m = url.pathname.match(/\/file\/(?:u\/\d+\/)?d\/([\w-]+)/);
  if (m) return { id: m[1], kind: 'file', resourceKey };
  m = url.pathname.match(/\/(?:document|spreadsheets|presentation)\/d\/([\w-]+)/);
  if (m) return { id: m[1], kind: 'native', resourceKey };
  const id = url.searchParams.get('id');
  if (id && /^\/(?:u\/\d+\/)?(open|uc|folderview|download|file)\b/.test(url.pathname)) {
    const kind = /folderview/.test(url.pathname) ? 'folder' : url.pathname.includes('/uc') ? 'file' : 'unknown';
    return { id, kind, resourceKey };
  }
  return null;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// Noms de fichiers valides sous Windows.
function sanitizeName(name) {
  let s = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s)) s = `_${s}`;
  return s.slice(0, 180) || 'sans_nom';
}

function parseEmbeddedFolderView(html) {
  const items = [];
  const re = /<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    const [, id, hrefRaw, titleRaw] = m;
    const href = decodeEntities(hrefRaw);
    const name = decodeEntities(titleRaw.replace(/<[^>]*>/g, '')).trim();
    let type = 'file';
    if (/\/drive\/(?:u\/\d+\/)?folders\/|folderview/.test(href)) type = 'folder';
    else if (/docs\.google\.com\/(document|spreadsheets|presentation|forms|drawings)/.test(href)) type = 'native';
    const rk = (href.match(/[?&]resourcekey=([\w-]+)/) || [])[1] || null;
    items.push({ id, name, type, resourceKey: rk });
  }
  return items;
}

// Page d'un dossier Drive (drive.google.com/drive/folders/ID) : la liste des fichiers est
// dans une chaîne JS « window['_DRIVE_ivd'] = '…' » (premiers éléments du dossier).
function unescapeJs(s) {
  return s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/g, (_, e) => {
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e[0] === 'u' && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' }[e] ?? e;
  });
}

function parseDriveIvd(html) {
  const at = String(html || '').indexOf('_DRIVE_ivd');
  if (at < 0) return null;
  const m = html.slice(at).match(/=\s*'((?:[^'\\]|\\.)*)'/);
  if (!m) return null;
  let data;
  try {
    data = JSON.parse(unescapeJs(m[1]));
  } catch {
    return null;
  }
  const rows = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];
  const items = [];
  for (const e of rows) {
    if (!Array.isArray(e) || typeof e[0] !== 'string' || typeof e[2] !== 'string') continue;
    const mime = typeof e[3] === 'string' ? e[3] : '';
    let type = 'file';
    if (mime === 'application/vnd.google-apps.folder') type = 'folder';
    else if (mime.startsWith('application/vnd.google-apps.')) type = 'native';
    items.push({ id: e[0], name: e[2], type, mimeType: mime || null, size: null, resourceKey: null });
  }
  return items;
}

// Formulaire "Impossible d'analyser ce fichier pour détecter les virus" sur les gros fichiers.
function parseConfirmForm(html, driveBase = 'https://drive.google.com') {
  const form = html.match(/<form[^>]*id="download-form"[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/);
  if (!form) {
    const m = html.match(/href="(\/uc\?export=download[^"]+)"/);
    if (m) return `${driveBase}${decodeEntities(m[1])}`;
    return null;
  }
  const action = decodeEntities(form[1]);
  const params = new URLSearchParams();
  const inputRe = /<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g;
  let m;
  while ((m = inputRe.exec(form[2]))) params.set(m[1], decodeEntities(m[2]));
  return `${action}${action.includes('?') ? '&' : '?'}${params.toString()}`;
}

function filenameFromDisposition(header) {
  if (!header) return null;
  let m = header.match(/filename\*=(?:UTF-8|utf-8)''([^;]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1].replace(/"/g, ''));
    } catch {}
  }
  m = header.match(/filename="([^"]+)"/) || header.match(/filename=([^;]+)/);
  return m ? m[1].trim() : null;
}

class DriveClient {
  // cookieFor(url) : en-tête Cookie de la session Google du Chrome piloté par Coffile (Drive privés sans clé)
  // authuser : numéro du compte dans cette session (u/0, u/1…).
  // browser : Chrome de Coffile lui-même ({ fetchText(url), download(url, dir, opts) }) ; les requêtes
  // partent alors de Chrome, avec sa vraie session Google (plus fiable que les cookies recopiés).
  constructor({ fetch, apiKey, getToken, cookieFor, authuser, browser = null, driveBase = 'https://drive.google.com', contentBase = 'https://drive.usercontent.google.com' }) {
    this.fetch = fetch;
    this.browser = browser;
    this.driveBase = driveBase;
    this.contentBase = contentBase;
    this.cookieFor = cookieFor || null;
    this.authuser = authuser != null ? String(authuser) : null;
    this.getToken = getToken || null;
    this.apiKey = this.getToken ? null : (apiKey || '').trim() || null;
    this.useApi = !!(this.apiKey || this.getToken);
  }

  // En-têtes d'authentification pour l'API Drive (jeton OAuth du compte choisi).
  async authHeaders(extra = {}) {
    const h = { 'User-Agent': UA, ...extra };
    if (this.getToken) h.Authorization = `Bearer ${await this.getToken()}`;
    return h;
  }

  apiUrl(u) {
    if (this.apiKey) u.searchParams.set('key', this.apiKey);
    return u.toString();
  }

  async sessionHeaders(url, extra = {}) {
    const h = { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9', ...extra };
    if (this.cookieFor) h.Cookie = await this.cookieFor(url);
    return h;
  }

  withUser(url) {
    return this.authuser != null ? `${url}${url.includes('?') ? '&' : '?'}authuser=${this.authuser}` : url;
  }

  async getText(url, signal) {
    if (this.browser) {
      const r = await this.browser.fetchText(url, { signal });
      if (r.status >= 400 || r.status === 0) {
        const err = new Error(r.status ? `HTTP ${r.status}` : 'Google a demandé une connexion (pas accès avec ce compte).');
        err.status = r.status || 401;
        throw err;
      }
      return r.text;
    }
    const res = await this.fetch(url, { headers: await this.sessionHeaders(url), signal });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.text();
  }

  async getJson(url, signal) {
    const res = await this.fetch(url, { headers: await this.authHeaders(), signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body && body.error && body.error.message;
      const err = new Error(msg || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  // --- Mode API ---
  async apiMeta(id, resourceKey, signal) {
    const u = new URL(`https://www.googleapis.com/drive/v3/files/${id}`);
    u.searchParams.set('fields', 'id,name,mimeType,size');
    u.searchParams.set('supportsAllDrives', 'true');
    const headers = await this.authHeaders(resourceKey ? { 'X-Goog-Drive-Resource-Keys': `${id}/${resourceKey}` } : {});
    const res = await this.fetch(this.apiUrl(u), { headers, signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(res.status === 404 ? "Ce compte Google n'a pas accès à ce lien." : (body.error && body.error.message) || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  async apiList(folderId, signal) {
    const out = [];
    let pageToken = '';
    do {
      const u = new URL('https://www.googleapis.com/drive/v3/files');
      u.searchParams.set('q', `'${folderId}' in parents and trashed = false`);
      u.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,size,resourceKey)');
      u.searchParams.set('pageSize', '1000');
      u.searchParams.set('supportsAllDrives', 'true');
      u.searchParams.set('includeItemsFromAllDrives', 'true');
      if (pageToken) u.searchParams.set('pageToken', pageToken);
      const body = await this.getJson(this.apiUrl(u), signal);
      for (const f of body.files || []) {
        let type = 'file';
        if (f.mimeType === 'application/vnd.google-apps.folder') type = 'folder';
        else if (f.mimeType && f.mimeType.startsWith('application/vnd.google-apps.')) type = 'native';
        out.push({ id: f.id, name: f.name, type, mimeType: f.mimeType, size: f.size ? Number(f.size) : null, resourceKey: f.resourceKey || null });
      }
      pageToken = body.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  // --- Mode public ---
  async publicList(folderId, resourceKey, signal) {
    const rk = resourceKey ? `&resourcekey=${encodeURIComponent(resourceKey)}` : '';
    let failure = null;
    try {
      const html = await this.getText(this.withUser(`${this.driveBase}/embeddedfolderview?id=${encodeURIComponent(folderId)}${rk}`), signal);
      if (/accounts\.google\.com\/(ServiceLogin|v3\/signin)/.test(html) && !html.includes('flip-entry')) {
        failure = new Error("Ce dossier est privé. Active le partage « Tous les utilisateurs disposant du lien ».");
      } else {
        const items = parseEmbeddedFolderView(html);
        if (items.length || /flip-entries|flip-entry/.test(html)) return items;
      }
    } catch (e) {
      if (e.name === 'AbortError' || (signal && signal.aborted)) throw e;
      failure = e.status === 404 || e.status === 403 || e.status === 401
        ? new Error("Dossier introuvable ou privé. Vérifie que le partage est sur « Tous les utilisateurs disposant du lien ».")
        : e;
    }
    // Deuxième méthode : la page normale du dossier (liste intégrée _DRIVE_ivd).
    try {
      const html = await this.getText(this.withUser(`${this.driveBase}/drive/folders/${encodeURIComponent(folderId)}?usp=sharing${rk}`), signal);
      const items = parseDriveIvd(html);
      if (items) return items;
    } catch (e) {
      if (e.name === 'AbortError' || (signal && signal.aborted)) throw e;
      if (!failure) failure = e;
    }
    if (failure) throw failure;
    return [];
  }

  async list(folderId, resourceKey, signal) {
    return this.useApi ? this.apiList(folderId, signal) : this.publicList(folderId, resourceKey, signal);
  }

  // Parcourt récursivement un dossier et renvoie la liste à plat des fichiers.
  async walk(folderId, resourceKey, { signal, onProgress, maxDepth = 12 } = {}) {
    const files = [];
    const skipped = [];
    const seen = new Set();
    const visit = async (id, rk, rel, depth) => {
      if (seen.has(id) || depth > maxDepth) return;
      seen.add(id);
      const items = await this.list(id, rk, signal);
      for (const it of items) {
        if (signal && signal.aborted) throw abortError();
        if (it.type === 'folder') {
          await visit(it.id, it.resourceKey, rel.concat(sanitizeName(it.name)), depth + 1);
        } else if (it.type === 'native') {
          skipped.push({ name: it.name, reason: 'Fichier Google Docs/Sheets (non téléchargeable)' });
        } else {
          files.push({ id: it.id, name: it.name, rel, size: it.size || null, mimeType: it.mimeType || null, resourceKey: it.resourceKey || null, category: categoryOf(it.name, it.mimeType) });
        }
      }
      onProgress && onProgress(files.length);
    };
    await visit(folderId, resourceKey, [], 0);
    return { files, skipped };
  }

  // Résout un lien en liste de fichiers à télécharger.
  async resolve(input, opts = {}) {
    const parsed = parseDriveUrl(input);
    if (!parsed) throw new Error("Lien Google Drive invalide.");
    if (parsed.kind === 'native') throw new Error('Ce lien pointe vers un document Google Docs/Sheets/Slides, pas vers un dossier de fichiers.');

    if (this.getToken || (this.apiKey && parsed.kind !== 'file')) {
      const meta = await this.apiMeta(parsed.id, parsed.resourceKey, opts.signal);
      if (meta.mimeType === 'application/vnd.google-apps.folder') {
        const r = await this.walk(parsed.id, parsed.resourceKey, opts);
        return { kind: 'folder', title: meta.name, ...r };
      }
      return { kind: 'file', title: meta.name, skipped: [], files: [{ id: meta.id, name: meta.name, rel: [], size: meta.size ? Number(meta.size) : null, mimeType: meta.mimeType, category: categoryOf(meta.name, meta.mimeType) }] };
    }

    if (parsed.kind === 'folder' || parsed.kind === 'unknown') {
      try {
        const r = await this.walk(parsed.id, parsed.resourceKey, opts);
        if (parsed.kind === 'folder' || r.files.length || r.skipped.length) return { kind: 'folder', title: null, ...r };
      } catch (e) {
        if (parsed.kind === 'folder') throw e;
      }
    }
    // Fichier seul : le nom sera connu au téléchargement si on n'a pas de clé API.
    let meta = null;
    if (this.useApi) meta = await this.apiMeta(parsed.id, parsed.resourceKey, opts.signal).catch(() => null);
    return {
      kind: 'file',
      title: meta ? meta.name : null,
      skipped: [],
      files: [{ id: parsed.id, name: meta ? meta.name : null, rel: [], size: meta && meta.size ? Number(meta.size) : null, resourceKey: parsed.resourceKey, category: meta ? categoryOf(meta.name, meta.mimeType) : 'unknown' }]
    };
  }

  downloadUrl(file) {
    if (this.useApi) {
      return this.apiUrl(new URL(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`));
    }
    let u = `${this.contentBase}/download?id=${encodeURIComponent(file.id)}&export=download&confirm=t`;
    if (file.resourceKey) u += `&resourcekey=${encodeURIComponent(file.resourceKey)}`;
    return this.withUser(u);
  }

  // Téléchargement fait par Chrome lui-même (dernier recours pour un Drive privé).
  // Renvoie { path, name, size } : fichier temporaire dans dir.
  async browserDownload(file, dir, { signal, onProgress } = {}) {
    if (!this.browser) throw new Error('Chrome indisponible.');
    let u = `${this.contentBase}/download?id=${encodeURIComponent(file.id)}&export=download&confirm=t`;
    if (file.resourceKey) u += `&resourcekey=${encodeURIComponent(file.resourceKey)}`;
    return this.browser.download(this.withUser(u), dir, { signal, onProgress, nextUrl: (html) => parseConfirmForm(html, this.driveBase) });
  }

  // Ouvre la réponse de téléchargement en gérant la page de confirmation antivirus.
  async openDownload(file, signal) {
    let url = this.downloadUrl(file);
    for (let hop = 0; hop < 3; hop++) {
      const headers = this.useApi
        ? await this.authHeaders(file.resourceKey ? { 'X-Goog-Drive-Resource-Keys': `${file.id}/${file.resourceKey}` } : {})
        : await this.sessionHeaders(url);
      const res = await this.fetch(url, { headers, signal });
      const type = res.headers.get('content-type') || '';
      if (!res.ok) {
        const err = new Error(res.status === 403 ? 'Accès refusé (fichier privé ou quota Google dépassé)' : res.status === 404 ? 'Fichier introuvable' : `HTTP ${res.status}`);
        err.status = res.status;
        err.fatal = res.status === 404;
        throw err;
      }
      if (!type.includes('text/html')) return res;
      const html = await res.text();
      const next = parseConfirmForm(html);
      if (!next) {
        if (/quota|Too many users|trop d'utilisateurs/i.test(html)) {
          throw new Error('Quota de téléchargement Google dépassé pour ce fichier. Réessaie plus tard ou ajoute une clé API.');
        }
        throw new Error('Google Drive a renvoyé une page au lieu du fichier (fichier privé ?).');
      }
      url = next;
    }
    throw new Error('Trop de redirections de confirmation.');
  }
}

function abortError() {
  const e = new Error('Annulé');
  e.name = 'AbortError';
  return e;
}

module.exports = {
  DriveClient,
  parseDriveUrl,
  parseEmbeddedFolderView,
  parseDriveIvd,
  parseConfirmForm,
  filenameFromDisposition,
  categoryOf,
  sanitizeName,
  abortError
};
