'use strict';
// Lecture de Gmail et Google Chat dans le Chrome piloté par Coffile (sans clé API).
// Gmail : liste lue dans la page de la boîte de réception, contenu des mails récupéré via la
// « version imprimable » de Gmail (HTML simple, chargé avec la session de l'utilisateur).
// Chat : lecture de la page web Google Chat (expérimental : la page change souvent).
const { analyze, analyzeChat, htmlToText, cleanPrintView } = require('./detect');
const { InboxError } = require('./inbox');

const MONTHS = {
  janv: 0, jan: 0, 'févr': 1, fevr: 1, feb: 1, mars: 2, mar: 2, avr: 3, apr: 3, mai: 4, may: 4, juin: 5, jun: 5,
  juil: 6, jul: 6, 'août': 7, aout: 7, aug: 7, sept: 8, sep: 8, oct: 9, nov: 10, 'déc': 11, dec: 11
};

// Dates affichées par Gmail : « lun. 27 oct. 2026, 10:12 » ou « Mon, Oct 27, 2026, 10:12 AM ».
function parseGmailDate(str) {
  const s = String(str || '').toLowerCase();
  let day = null;
  let month = null;
  const monthOf = (w) => {
    const key = Object.keys(MONTHS).find((k) => w.startsWith(k));
    return key ? MONTHS[key] : null;
  };
  // « 27 oct. » (français) puis « Oct 27 » (anglais)
  for (const m of s.matchAll(/(\d{1,2})\s+([a-zéû]{3,9})/g)) {
    if (monthOf(m[2]) != null) {
      day = Number(m[1]);
      month = monthOf(m[2]);
      break;
    }
  }
  if (month == null) {
    for (const m of s.matchAll(/([a-zéû]{3,9})\.?\s+(\d{1,2})(?!\d)/g)) {
      if (monthOf(m[1]) != null) {
        month = monthOf(m[1]);
        day = Number(m[2]);
        break;
      }
    }
  }
  const year = Number((s.match(/\b(20\d{2})\b/) || [])[1]) || new Date().getFullYear();
  const t = s.match(/(\d{1,2})[:h](\d{2})\s*(am|pm)?/);
  let hh = t ? Number(t[1]) : 0;
  if (t && t[3] === 'pm' && hh < 12) hh += 12;
  if (t && t[3] === 'am' && hh === 12) hh = 0;
  if (month == null) {
    // Seulement l'heure (mail du jour)
    if (t) {
      const d = new Date();
      d.setHours(hh, Number(t[2]), 0, 0);
      return d.getTime();
    }
    return NaN;
  }
  return new Date(year, month, day, hh, t ? Number(t[2]) : 0).getTime();
}

function loginError() {
  return new InboxError('Connecte-toi à Google dans le Chrome de Coffile.', 'LOGIN');
}

const isLoginUrl = (url) => /accounts\.google\.com|ServiceLogin/.test(url);

class ChromeInbox {
  constructor({ session, gmailBase = 'https://mail.google.com', chatBase = 'https://chat.google.com' }) {
    this.session = session;
    this.gmail = gmailBase;
    this.chat = chatBase;
    this.bodies = new Map(); // fil -> { html, text } : les mails déjà lus ne sont pas rechargés
  }

  // ---------- Gmail ----------
  // Ouvre une vue Gmail dans l'onglet « gmail ». Si Gmail est déjà chargé pour ce compte,
  // on change seulement de vue (bien plus rapide qu'un rechargement complet).
  async openGmail(u, hash, force) {
    const prefix = `${this.gmail}/mail/u/${u}/`;
    let page = await this.session.page('gmail');
    if (!force && page.url().startsWith(prefix) && !isLoginUrl(page.url())) {
      const before = await page.evaluate(() => {
        const r = document.querySelector('[role="main"] tr.zA [data-legacy-thread-id]');
        return { first: r ? r.getAttribute('data-legacy-thread-id') : null, hash: location.hash };
      });
      if (before.hash !== `#${hash}`) {
        await page.evaluate((h) => (location.hash = h), hash);
        // Attend que la nouvelle liste remplace l'ancienne (ou un court délai si elle est identique).
        await page
          .waitForFunction(
            (prev) => {
              const main = document.querySelector('[role="main"]');
              const r = main && main.querySelector('tr.zA [data-legacy-thread-id]');
              const empty = document.querySelector('td.TC');
              return (r && r.getAttribute('data-legacy-thread-id') !== prev) || (empty && empty.offsetParent);
            },
            before.first,
            { timeout: 6000 }
          )
          .catch(() => {});
      }
    } else {
      ({ page } = await this.session.goto(`${prefix}#${hash}`, {}, 'gmail'));
      if (isLoginUrl(page.url())) throw loginError();
    }
    await page
      .waitForFunction(
        () => {
          const main = document.querySelector('[role="main"]');
          return (main && main.querySelector('tr.zA')) || document.querySelector('td.TC') || (main && main.querySelector('.a3s'));
        },
        null,
        { timeout: 45000 }
      )
      .catch(() => {});
    if (isLoginUrl(page.url())) throw loginError();
    return page;
  }

  // Liste des mails (50 par page, comme Gmail). Rapide : seuls les mails déjà lus sont analysés
  // en entier ; les autres sont listés dans « pending » et analysés ensuite (voir bodiesFor).
  async listMail({ u = 0, q = '', page: pageNum = 1, force = false } = {}) {
    return this.session.exclusive(async () => {
      const hash = (q ? `search/${encodeURIComponent(q)}` : 'inbox') + (pageNum > 1 ? `/p${pageNum}` : '');
      const page = await this.openGmail(u, hash, force);
      const rows = await page.evaluate(() => {
        const main = document.querySelector('[role="main"]') || document;
        return [...main.querySelectorAll('tr.zA')]
          .filter((tr) => tr.offsetParent !== null)
          .map((tr) => {
            const idEl = tr.querySelector('[data-legacy-thread-id]');
            const thEl = tr.querySelector('[data-thread-id]');
            const from = tr.querySelector('.yW [email]') || tr.querySelector('[email]');
            const dateEl = tr.querySelector('.xW span[title]') || tr.querySelector('td.xW span') || tr.querySelector('[title*=":"]');
            return {
              legacy: idEl ? idEl.getAttribute('data-legacy-thread-id') : null,
              thread: thEl ? (thEl.getAttribute('data-thread-id') || '').replace(/^#/, '') : null,
              name: from ? from.getAttribute('name') || from.innerText : '',
              email: from ? from.getAttribute('email') : '',
              subject: (tr.querySelector('.bog') || {}).innerText || '',
              snippet: ((tr.querySelector('.y2') || {}).innerText || '').replace(/^\s*[-–]\s*/, ''),
              date: dateEl ? dateEl.getAttribute('title') || dateEl.innerText : '',
              unread: tr.classList.contains('zE')
            };
          })
          .filter((r) => r.legacy || r.thread);
      });
      const now = Date.now();
      const pending = [];
      const messages = rows.map((r, i) => {
        const id = r.legacy || r.thread;
        const body = this.bodies.get(id);
        if (!body) pending.push({ id, threadId: r.thread });
        const text = body ? body.text : r.snippet;
        const date = parseGmailDate(r.date);
        return {
          id,
          threadId: r.thread,
          from: { name: r.name || r.email, email: r.email },
          subject: r.subject || '(sans objet)',
          date: Number.isNaN(date) ? now - i * 60000 : date,
          snippet: r.snippet,
          unread: r.unread,
          text: text.slice(0, 6000),
          attachments: [],
          analysis: analyze({ subject: r.subject, text, html: body ? body.html : '', sender: r.name, senderEmail: r.email, date: Number.isNaN(date) ? null : date })
        };
      });
      return { messages, pending, nextPageToken: rows.length >= 50 ? String(pageNum + 1) : null };
    });
  }

  async ik(page) {
    return page
      .evaluate(() => {
        try {
          if (window.GLOBALS && window.GLOBALS[9]) return window.GLOBALS[9];
        } catch {}
        const m = document.documentElement.innerHTML.match(/"ik"\s*:\s*"([0-9a-f]{6,})"/);
        return m ? m[1] : null;
      })
      .catch(() => null);
  }

  printUrl(u, ik, r) {
    const base = `${this.gmail}/mail/u/${u}/?view=pt&search=all`;
    if (r.threadId && ik) return `${base}&ik=${ik}&permthid=${encodeURIComponent(r.threadId)}`;
    return `${base}${ik ? `&ik=${ik}` : ''}&th=${r.id}`;
  }

  // Charge les versions imprimables dans la page Gmail (même origine, cookies de la session).
  async fetchPrintViews(page, u, items) {
    const ik = await this.ik(page);
    const urls = items.map((r) => this.printUrl(u, ik, r));
    return page.evaluate(async (list) => {
      const out = new Array(list.length).fill('');
      let i = 0;
      const worker = async () => {
        while (i < list.length) {
          const k = i++;
          try {
            const res = await fetch(list[k], { credentials: 'include' });
            const html = await res.text();
            if (res.ok && /class="?message|class="?maincontent/i.test(html)) out[k] = html;
          } catch {}
        }
      };
      await Promise.all(Array.from({ length: 10 }, worker));
      return out;
    }, urls);
  }

  // Garde seulement le texte des messages de la page imprimable (pas le titre, ton compte, « À : »…).
  remember(id, raw) {
    const html = cleanPrintView(raw);
    const text = htmlToText(html);
    this.bodies.set(id, { html, text });
    if (this.bodies.size > 800) this.bodies.delete(this.bodies.keys().next().value);
    return { html, text };
  }

  // Contenu complet de plusieurs mails : [{ id, text, analysis }] (pour compléter la liste).
  async bodiesFor({ u = 0, items = [] } = {}) {
    return this.session.exclusive(async () => {
      let page = await this.session.page('gmail');
      if (!page.url().startsWith(`${this.gmail}/mail/u/${u}/`)) page = await this.openGmail(u, 'inbox');
      const htmls = await this.fetchPrintViews(page, u, items);
      return items.map((it, k) => {
        if (!htmls[k]) return { id: it.id, missing: true };
        const { text, html } = this.remember(it.id, htmls[k]);
        return { id: it.id, text: text.slice(0, 6000), html };
      });
    });
  }

  async getMail({ u = 0, id, threadId, date = null, subject = '', sender = '', senderEmail = '' } = {}) {
    const meta = { date, subject, sender, senderEmail };
    const cached = this.bodies.get(id);
    if (cached) return { id, html: cached.html, text: cached.text, analysis: analyze({ text: cached.text, html: cached.html, ...meta }) };
    return this.session.exclusive(async () => {
      let page = await this.session.page('gmail');
      if (!page.url().startsWith(`${this.gmail}/mail/u/${u}/`)) page = await this.openGmail(u, 'inbox');
      let [html] = await this.fetchPrintViews(page, u, [{ id, threadId }]);
      if (!html) {
        // Repli : ouverture du fil dans Gmail.
        page = await this.openGmail(u, `all/${id}`);
        html = await page.evaluate(() => [...document.querySelectorAll('.a3s')].map((e) => e.innerHTML).join('<hr>'));
      }
      const body = html ? this.remember(id, html) : { html: '', text: '' };
      return { id, html: body.html, text: body.text, analysis: analyze({ text: body.text, html: body.html, ...meta }) };
    });
  }

  // ---------- Google Chat (expérimental) ----------
  async chatFrames(page) {
    return [page.mainFrame(), ...page.frames()].filter((f, i, a) => a.indexOf(f) === i);
  }

  // Ouvre Google Chat dans l'onglet « chat » (gardé chargé entre deux lectures).
  async openChat(u, force) {
    let page = await this.session.page('chat');
    if (force || !page.url().startsWith(`${this.chat}/u/${u}/`)) {
      ({ page } = await this.session.goto(`${this.chat}/u/${u}/`, {}, 'chat'));
      if (isLoginUrl(page.url())) throw loginError();
    }
    return page;
  }

  async readSpaces(page) {
    let spaces = [];
    for (const f of await this.chatFrames(page)) {
      const found = await f
        .evaluate(() =>
          [...document.querySelectorAll('[data-group-id]')].map((el) => ({
            name: el.getAttribute('data-group-id'),
            title: (el.getAttribute('aria-label') || el.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || 'Conversation',
            type: /^dm\//.test(el.getAttribute('data-group-id')) ? 'DIRECT_MESSAGE' : 'SPACE'
          }))
        )
        .catch(() => []);
      spaces = spaces.concat(found);
    }
    return [...new Map(spaces.filter((s) => s.name).map((s) => [s.name, s])).values()];
  }

  async listSpaces({ u = 0, force = false } = {}) {
    return this.session.exclusive(async () => {
      const page = await this.openChat(u, force);
      let spaces = [];
      // Interroge la page toutes les 300 ms (au lieu d'attendre une durée fixe).
      for (let t = 0; t < 70 && !spaces.length; t++) {
        spaces = await this.readSpaces(page);
        if (!spaces.length) await page.waitForTimeout(300);
      }
      if (!spaces.length) throw new InboxError("Coffile n'a pas réussi à lire Google Chat dans Chrome (la page a peut-être changé).", 'CHAT_SCRAPE');
      return spaces.map((s, i) => ({ ...s, lastActive: -i }));
    });
  }

  // Lit les messages affichés. Pour chaque identifiant de message, on remonte jusqu'au plus grand
  // bloc qui ne contient que ce message (Google place l'identifiant tantôt sur le bloc entier,
  // tantôt sur une petite partie comme le nom) ; expéditeur, heure et texte sont ensuite séparés
  // à partir des lignes du bloc.
  async readMessages(page) {
    let raw = [];
    for (const f of await this.chatFrames(page)) {
      const found = await f
        .evaluate(() => {
          const attr = document.querySelector('[data-message-id]') ? 'data-message-id' : document.querySelector('[data-topic-id]') ? 'data-topic-id' : null;
          if (!attr) return [];
          const firstById = new Map();
          for (const n of document.querySelectorAll(`[${attr}]`)) {
            const id = n.getAttribute(attr);
            if (id && !firstById.has(id)) firstById.set(id, n);
          }
          const containerFor = (id, n) => {
            let c = n;
            while (c.parentElement && c.parentElement !== document.body) {
              const p = c.parentElement;
              const other = [...p.querySelectorAll(`[${attr}]`)].some((x) => x.getAttribute(attr) !== id);
              if (other) break;
              c = p;
            }
            return c;
          };
          return [...firstById.entries()].map(([id, n]) => {
            const box = containerFor(id, n);
            const nameEl = box.querySelector('[data-hovercard-id], [data-name]');
            const timeEl = box.querySelector('[data-absolute-timestamp]');
            const textEl = box.querySelector('[jsname="bgckF"]');
            return {
              id,
              name: nameEl ? (nameEl.getAttribute('data-name') || nameEl.innerText || '').split('\n')[0].trim() : '',
              ts: timeEl ? Number(timeEl.getAttribute('data-absolute-timestamp')) : 0,
              text: textEl ? textEl.innerText : '',
              lines: (box.innerText || '').split('\n').map((x) => x.trim()).filter(Boolean),
              labels: [...box.querySelectorAll('[aria-label], [title]')].map((e) => e.getAttribute('aria-label') || e.getAttribute('title')).filter(Boolean).slice(0, 12),
              links: [...box.querySelectorAll('a[href]')].map((a) => a.href)
            };
          });
        })
        .catch(() => []);
      raw = raw.concat(found);
    }
    return [...new Map(raw.filter((m) => m.id).map((m) => [m.id, m])).values()];
  }

  // Diagnostic anonyme de la page Chat : structure des blocs autour des messages (balises,
  // noms d'attributs, longueurs de texte), sans aucun texte, nom ni adresse.
  async chatDiagnostic({ u = 0, space } = {}) {
    return this.session.exclusive(async () => {
      const page = await this.openChat(u);
      if (space) {
        for (const f of await this.chatFrames(page)) {
          const el = await f.$(`[data-group-id="${String(space).replace(/"/g, '')}"]`).catch(() => null);
          if (el) {
            await el.click().catch(() => {});
            break;
          }
        }
        await page.waitForTimeout(2500);
      }
      const frames = [];
      for (const f of await this.chatFrames(page)) {
        const info = await f
          .evaluate(() => {
            const SAFE = /^(data-message-id|data-topic-id|data-id|jsname|jscontroller|jsaction|role|dir|data-group-id)$/;
            const attrs = (el) =>
              [...el.attributes]
                .filter((a) => a.name !== 'class' && a.name !== 'style')
                .map((a) => (SAFE.test(a.name) ? `${a.name}=${String(a.value).replace(/[^\w:/-]/g, '').slice(0, 20)}` : a.name));
            const texts = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim().length).filter(Boolean);
            const outline = (el, depth) => ({
              tag: el.tagName.toLowerCase(),
              attrs: attrs(el),
              classes: el.classList.length,
              text: texts(el),
              lines: (el.innerText || '').split('\n').filter((x) => x.trim()).length,
              kids: depth > 0 ? [...el.children].slice(0, 15).map((c) => outline(c, depth - 1)) : el.children.length
            });
            const count = (sel) => document.querySelectorAll(sel).length;
            const sample = [...document.querySelectorAll('[data-message-id], [data-topic-id]')].slice(0, 3).map((n) => {
              const chain = [];
              let c = n;
              for (let i = 0; i < 8 && c && c !== document.body; i++, c = c.parentElement) chain.push({ tag: c.tagName.toLowerCase(), attrs: attrs(c), lines: (c.innerText || '').split('\n').filter((x) => x.trim()).length });
              let top = n;
              for (let i = 0; i < 4 && top.parentElement && top.parentElement !== document.body; i++) top = top.parentElement;
              return { ancestors: chain, outline: outline(top, 6) };
            });
            return {
              url: location.origin + location.pathname.replace(/[^/]+$/, '…'),
              counts: {
                'data-message-id': count('[data-message-id]'),
                'data-topic-id': count('[data-topic-id]'),
                'data-group-id': count('[data-group-id]'),
                'role=listitem': count('[role="listitem"]'),
                'role=article': count('[role="article"]'),
                'dir=auto': count('[dir="auto"]'),
                'data-absolute-timestamp': count('[data-absolute-timestamp]'),
                'jsname=bgckF': count('[jsname="bgckF"]')
              },
              sample
            };
          })
          .catch((e) => ({ error: String(e && e.message) }));
        frames.push(info);
      }
      return { app: 'Coffile', date: new Date().toISOString(), frames };
    });
  }

  async listChat({ u = 0, space } = {}) {
    return this.session.exclusive(async () => {
      const page = await this.openChat(u);
      const before = new Set((await this.readMessages(page)).map((m) => m.id));
      let clicked = false;
      for (let t = 0; t < 30 && !clicked; t++) {
        for (const f of await this.chatFrames(page)) {
          const el = await f.$(`[data-group-id="${String(space).replace(/"/g, '')}"]`).catch(() => null);
          if (el) {
            await el.click().catch(() => {});
            clicked = true;
            break;
          }
        }
        if (!clicked) await page.waitForTimeout(300);
      }
      // Attend que les messages de cette conversation s'affichent et ne bougent plus.
      let raw = [];
      let stable = 0;
      let lastKey = '';
      const t0 = Date.now();
      while (Date.now() - t0 < 9000) {
        await page.waitForTimeout(350);
        raw = await this.readMessages(page);
        const fresh = raw.some((m) => !before.has(m.id)) || (before.size === 0 && raw.length > 0) || Date.now() - t0 > 2500;
        const key = raw.map((m) => m.id).join('|');
        stable = key === lastKey ? stable + 1 : 0;
        lastKey = key;
        if (raw.length && fresh && stable >= 2) break;
      }
      return { messages: toChatMessages(raw, space), nextPageToken: null };
    });
  }
}

const TIME_RE = /^((hier|yesterday|aujourd'hui|today)\b.*|[a-zéû]{3,9}\.?\s+\d{1,2}:\d{2}.*|\d{1,2}\s+[a-zéû]{3,9}\.?(\s+\d{4})?,?\s+(à\s+)?\d{1,2}[:h]\d{2}.*|\d{1,2}[:h]\d{2}(\s?[ap]\.?m\.?)?)$/i;
const META_RE = /^(modifié|edited|modifiée|lu|vu|read|seen|répondre|reply|répondre dans le fil|reply in thread|\d+\s+(réponses?|replies|reply)|afficher plus|show more|nouveau|new|envoi…|sending…|•)$/i;

function chatTime(lines, labels) {
  let cand = [...lines, ...labels].find((l) => TIME_RE.test(l.trim()));
  // Heure collée au nom dans l'en-tête (« Vous10:43 »).
  if (!cand && lines.length) {
    const g = lines[0].match(/(\d{1,2}[:h]\d{2}(\s?[ap]\.?m\.?)?)$/i);
    if (g) cand = g[1];
  }
  if (!cand) return 0;
  let t = parseGmailDate(cand);
  if (!Number.isNaN(t) && /hier|yesterday/i.test(cand)) t -= 86400000;
  return Number.isNaN(t) ? 0 : t;
}

// Liens de l'interface de Chat (profils, avatars, aide, réactions…) : pas des liens envoyés.
function chatUiLink(url) {
  if (!/^https?:\/\//i.test(url)) return true;
  try {
    const u = new URL(url);
    if (/^(chat|mail|accounts|contacts|myaccount|support|meet|lh\d+|ssl|www\.gstatic|fonts)\.(google|googleusercontent|gstatic)\.com$/.test(u.hostname)) return true;
    if (/googleusercontent\.com$|gstatic\.com$/.test(u.hostname)) return true;
    if (/^(www\.)?google\.com$/.test(u.hostname) && u.pathname !== '/url') return true;
  } catch {
    return true;
  }
  return false;
}

// Transforme les messages lus dans la page : expéditeur (repris du message précédent quand
// Chat ne le répète pas), texte sans le nom ni l'heure, liens ajoutés.
function toChatMessages(raw, space) {
  const now = Date.now();
  let lastSender = '';
  const out = raw.map((m, i) => {
    let sender = m.name;
    let lines = m.lines.filter((l) => !TIME_RE.test(l) && !META_RE.test(l));
    // Sans élément « nom » repérable : un en-tête « Nom » suivi de l'heure (ou « Nom10:42 ») est l'expéditeur.
    if (!sender && !m.text && m.lines.length >= 2) {
      const glued = m.lines[0].match(/^(.+?)\s*(\d{1,2}[:h]\d{2}(\s?[ap]\.?m\.?)?)$/i);
      if (TIME_RE.test(m.lines[1]) && !TIME_RE.test(m.lines[0])) sender = m.lines[0];
      else if (glued && !/^\d/.test(glued[1])) sender = glued[1].trim();
    }
    if (m.text) {
      lines = [m.text.trim()];
      if (sender === lines[0]) sender = '';
    } else if (sender && lines.length <= 1 && (!lines.length || lines[0] === sender)) {
      // Bloc qui ne contient que le nom (étiquette d'expéditeur) : pas un message.
      lastSender = sender;
      return null;
    } else if (sender && lines.length && lines[0].startsWith(sender)) {
      // Nom en tête du message, parfois collé à l'heure (« Stella Augusto10:31 »).
      const rest = lines[0].slice(sender.length).trim();
      lines = rest && !TIME_RE.test(rest) ? [rest, ...lines.slice(1)] : lines.slice(1);
    }
    if (!sender) sender = lastSender || 'Contact';
    lastSender = sender;
    const body = lines.join('\n').trim();
    if (!body && !m.links.length) return null;
    const text = [body, ...m.links.filter((l) => !body.includes(l) && !chatUiLink(l))].join('\n').trim();
    const date = m.ts || chatTime(m.lines, m.labels) || now - (raw.length - i) * 60000;
    return { id: `${space}/${m.id}`, space, sender, date, text, attachments: [] };
  });
  return analyzeChat(out.filter(Boolean)).reverse();
}

module.exports = { ChromeInbox, parseGmailDate, toChatMessages, chatUiLink };
