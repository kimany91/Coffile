'use strict';
// Lecture des mails (Gmail API) et des messages Google Chat (Chat API), en lecture seule,
// avec le compte Google connecté. Chaque message est analysé pour repérer les montages.
const { analyze, analyzeChat } = require('./detect');

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CHAT = 'https://chat.googleapis.com/v1';

class InboxError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// Traduit les erreurs Google en messages compréhensibles (et en code pour l'interface).
function apiError(status, body, service) {
  const msg = (body && body.error && body.error.message) || `HTTP ${status}`;
  if (status === 401) return new InboxError('Connexion expirée : reconnecte le compte.', 'AUTH');
  if (status === 403 && /insufficient|scope/i.test(msg)) return new InboxError(`Accès à ${service} non autorisé pour ce compte.`, 'SCOPE');
  if (status === 403 && /has not been used|is disabled|not enabled|SERVICE_DISABLED/i.test(msg + JSON.stringify(body || {})))
    return new InboxError(`L'API ${service} n'est pas activée dans ton projet Google Cloud.`, 'API_DISABLED');
  if (service === 'Google Chat' && /workspace|not available|chat app not found|no chat app/i.test(msg))
    return new InboxError(msg, /chat app/i.test(msg) ? 'CHAT_APP' : 'WORKSPACE_ONLY');
  return new InboxError(msg, 'OTHER');
}

function b64urlDecode(data) {
  return Buffer.from(String(data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function parseAddress(v) {
  const m = String(v || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2], email: m[2].trim() };
  return { name: String(v || '').trim(), email: String(v || '').trim() };
}

// Parcourt l'arbre MIME : texte, HTML et pièces jointes.
function walkPayload(part, out = { text: '', html: '', attachments: [] }) {
  if (!part) return out;
  const type = part.mimeType || '';
  if (part.filename && (part.body?.attachmentId || part.body?.size)) {
    out.attachments.push({ filename: part.filename, mimeType: type, size: part.body.size || 0 });
  } else if (type === 'text/plain' && part.body?.data && !out.text) out.text = b64urlDecode(part.body.data);
  else if (type === 'text/html' && part.body?.data && !out.html) out.html = b64urlDecode(part.body.data);
  for (const p of part.parts || []) walkPayload(p, out);
  return out;
}

class InboxClient {
  constructor({ fetch, getToken }) {
    this.fetch = fetch;
    this.getToken = getToken;
  }

  async get(url, service) {
    const res = await this.fetch(url, { headers: { Authorization: `Bearer ${await this.getToken()}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw apiError(res.status, body, service);
    return body;
  }

  // ---------- Gmail ----------
  parseMessage(m) {
    const headers = Object.fromEntries((m.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
    const from = parseAddress(headers.from);
    const { text, html, attachments } = walkPayload(m.payload);
    const subject = headers.subject || '(sans objet)';
    const date = Number(m.internalDate) || Date.parse(headers.date) || Date.now();
    return {
      id: m.id,
      threadId: m.threadId,
      from,
      to: headers.to || '',
      subject,
      date,
      snippet: (m.snippet || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
      unread: (m.labelIds || []).includes('UNREAD'),
      text,
      html,
      attachments,
      analysis: analyze({ subject, text, html, attachments, sender: from.name, senderEmail: from.email, date })
    };
  }

  async listMail({ q = 'in:inbox', pageToken = '', max = 25 } = {}) {
    const u = new URL(`${GMAIL}/messages`);
    u.searchParams.set('maxResults', String(max));
    if (q) u.searchParams.set('q', q);
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const list = await this.get(u.toString(), 'Gmail');
    const ids = (list.messages || []).map((m) => m.id);
    const out = new Array(ids.length);
    let i = 0;
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        while (i < ids.length) {
          const k = i++;
          out[k] = this.parseMessage(await this.get(`${GMAIL}/messages/${ids[k]}?format=full`, 'Gmail'));
        }
      })
    );
    return { messages: out.filter(Boolean), nextPageToken: list.nextPageToken || null };
  }

  async getMail(id) {
    return this.parseMessage(await this.get(`${GMAIL}/messages/${encodeURIComponent(id)}?format=full`, 'Gmail'));
  }

  // ---------- Google Chat ----------
  async listSpaces() {
    const out = [];
    let pageToken = '';
    do {
      const u = new URL(`${CHAT}/spaces`);
      u.searchParams.set('pageSize', '100');
      if (pageToken) u.searchParams.set('pageToken', pageToken);
      const body = await this.get(u.toString(), 'Google Chat');
      for (const s of body.spaces || []) {
        out.push({
          name: s.name,
          title: s.displayName || (s.spaceType === 'DIRECT_MESSAGE' || s.singleUserBotDm ? 'Message direct' : 'Conversation de groupe'),
          type: s.spaceType || s.type || 'SPACE',
          lastActive: Date.parse(s.lastActiveTime || '') || 0
        });
      }
      pageToken = body.nextPageToken || '';
    } while (pageToken && out.length < 300);
    return out.sort((a, b) => b.lastActive - a.lastActive);
  }

  async listChat(space, { pageToken = '', max = 50 } = {}) {
    const u = new URL(`${CHAT}/${space}/messages`);
    u.searchParams.set('pageSize', String(max));
    u.searchParams.set('orderBy', 'createTime desc');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const body = await this.get(u.toString(), 'Google Chat');
    const messages = (body.messages || []).map((m) => {
      const text = [m.text || '', m.matchedUrl?.url || ''].join('\n').trim();
      const attachments = (m.attachment || []).map((a) => ({ filename: a.contentName || '', mimeType: a.contentType || '' }));
      const sender = m.sender?.displayName || (m.sender?.type === 'BOT' ? 'Application' : 'Contact');
      return {
        id: m.name,
        space,
        sender,
        date: Date.parse(m.createTime || '') || Date.now(),
        text,
        attachments
      };
    });
    // Dans le Chat, l'expéditeur est souvent un collègue : le nom proposé vient du texte seul.
    return { messages: analyzeChat(messages), nextPageToken: body.nextPageToken || null };
  }
}

module.exports = { InboxClient, InboxError, walkPayload, parseAddress };
