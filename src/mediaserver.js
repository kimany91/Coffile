'use strict';
// Protocole filedit-media:// : lecture des vidéos et images des projets dans l'interface
// (aperçus au survol, miniatures), avec prise en charge des requêtes partielles (Range).
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

const SCHEME = 'filedit-media';
const TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.bmp': 'image/bmp',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif'
};

function privileges() {
  return { scheme: SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } };
}

// isAllowed(path) : seuls les fichiers des projets et le cache de miniatures sont servis.
function register(protocol, isAllowed) {
  protocol.handle(SCHEME, async (request) => {
    let file;
    try {
      file = path.normalize(decodeURIComponent(new URL(request.url).pathname.slice(1)));
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    if (!isAllowed(file)) return new Response('Forbidden', { status: 403 });
    let st;
    try {
      st = await fsp.stat(file);
    } catch {
      return new Response('Not found', { status: 404 });
    }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
    if (range && st.size > 0) {
      let start = range[1] ? Number(range[1]) : 0;
      let end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (!range[1] && range[2]) {
        start = Math.max(0, st.size - Number(range[2]));
        end = st.size - 1;
      }
      if (start >= st.size || start > end) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
      }
      return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
        status: 206,
        headers: { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes' }
      });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)), {
      status: 200,
      headers: { 'Content-Type': type, 'Content-Length': String(st.size), 'Accept-Ranges': 'bytes' }
    });
  });
}

// ---------- Cache des miniatures ----------
class ThumbCache {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  key(file, size, mtime) {
    return crypto.createHash('sha1').update(`${file}|${size}|${Math.round(mtime)}`).digest('hex');
  }

  // Renvoie { key: chemin | 'fail' | null } pour chaque élément demandé.
  lookup(items) {
    const out = {};
    for (const it of items) {
      const k = this.key(it.path, it.size, it.mtime);
      const jpg = path.join(this.dir, `${k}.jpg`);
      if (fs.existsSync(jpg)) out[it.path] = { key: k, file: jpg };
      else if (fs.existsSync(path.join(this.dir, `${k}.fail`))) out[it.path] = { key: k, fail: true };
      else out[it.path] = { key: k };
    }
    return out;
  }

  async save(key, bytes) {
    if (!/^[0-9a-f]{40}$/.test(key)) throw new Error('clé invalide');
    if (!bytes) {
      await fsp.writeFile(path.join(this.dir, `${key}.fail`), '');
      return null;
    }
    const file = path.join(this.dir, `${key}.jpg`);
    await fsp.writeFile(file, Buffer.from(bytes));
    return file;
  }
}

module.exports = { SCHEME, privileges, register, ThumbCache };
