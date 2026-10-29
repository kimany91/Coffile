'use strict';
// Comptes Google connectés (OAuth 2.0, flux « application de bureau »).
// La connexion se fait dans Chrome : Coffile ne voit jamais le mot de passe,
// il reçoit seulement un jeton d'accès en lecture seule (Drive, et sur demande Gmail / Google Chat).
// Les jetons sont chiffrés avec le coffre de Windows (safeStorage / DPAPI).
const http = require('http');
const crypto = require('crypto');

const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.readonly'];
// Accès supplémentaires, demandés seulement quand l'utilisateur ouvre l'onglet Messagerie.
const FEATURE_SCOPES = {
  gmail: ['https://www.googleapis.com/auth/gmail.readonly'],
  chat: ['https://www.googleapis.com/auth/chat.spaces.readonly', 'https://www.googleapis.com/auth/chat.messages.readonly']
};

function featuresOf(scopeStr) {
  const granted = String(scopeStr || '').split(/\s+/);
  return Object.fromEntries(Object.entries(FEATURE_SCOPES).map(([k, list]) => [k, list.every((sc) => granted.includes(sc))]));
}
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const LOGIN_TIMEOUT = 5 * 60 * 1000;

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function page(title, text, ok) {
  const color = ok ? '#34d399' : '#f87171';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Coffile</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#0d0d10;color:#f4f4f5;font:15px 'Segoe UI',system-ui,sans-serif}
.c{text-align:center;padding:40px;border:1px solid rgba(255,255,255,.08);border-radius:20px;background:#141418;max-width:420px}
.i{width:64px;height:64px;border-radius:18px;margin:0 auto 18px;display:grid;place-items:center;font-size:30px;background:${color}22;color:${color}}
h1{font-size:22px;margin:0 0 8px}p{color:#a1a1aa;margin:0}</style></head>
<body><div class="c"><div class="i">${ok ? '✓' : '!'}</div><h1>${title}</h1><p>${text}</p></div></body></html>`;
}

class GoogleAccounts {
  // store : { client() -> { id, secret }, accounts() -> [], setAccounts(list), save() }
  // vault : { encrypt(str) -> str, decrypt(str) -> str }
  constructor({ store, fetch, openUrl, vault }) {
    this.store = store;
    this.fetch = fetch;
    this.openUrl = openUrl;
    this.vault = vault;
    this.tokens = new Map(); // email -> { access, expires }
    this.pending = null;
  }

  client() {
    const c = this.store.client() || {};
    if (!c.id || !c.secret) {
      const err = new Error("Connexion Google non configurée : ajoute l'identifiant client OAuth dans Réglages › Comptes Google.");
      err.code = 'NO_CLIENT';
      throw err;
    }
    return c;
  }

  list() {
    return this.store.accounts().map(({ email, name, picture, invalid, scope }) => ({ email, name, picture, invalid: !!invalid, features: featuresOf(scope) }));
  }

  cancelLogin() {
    if (this.pending) this.pending.cancel();
  }

  // Ouvre la page Google (sélecteur de compte) dans Chrome et attend le retour.
  // features : accès supplémentaires à demander (['gmail'], ['chat']…) ; loginHint : compte présélectionné.
  async connect({ profile, features = [], loginHint } = {}) {
    const client = this.client();
    if (this.pending) this.pending.cancel();
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));

    const { code, redirectUri } = await new Promise((resolve, reject) => {
      let done = false;
      const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/') {
          res.writeHead(404).end();
          return;
        }
        const err = url.searchParams.get('error');
        const gotState = url.searchParams.get('state');
        const gotCode = url.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (err || gotState !== state || !gotCode) {
          res.end(page('Connexion annulée', 'Tu peux fermer cet onglet et réessayer depuis Coffile.', false));
          finish(new Error(err === 'access_denied' ? 'Connexion refusée.' : 'Connexion Google interrompue.'));
          return;
        }
        res.end(page('Compte connecté', 'Tu peux fermer cet onglet et retourner dans Coffile.', true));
        finish(null, gotCode);
      });
      const timer = setTimeout(() => finish(new Error('Délai de connexion dépassé.')), LOGIN_TIMEOUT);
      const finish = (e, c) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.pending = null;
        setTimeout(() => server.close(), 500);
        if (e) reject(e);
        else resolve({ code: c, redirectUri: `http://127.0.0.1:${server.address().port}` });
      };
      this.pending = { cancel: () => finish(Object.assign(new Error('Connexion annulée.'), { name: 'AbortError' })) };
      server.on('error', (e) => finish(e));
      server.listen(0, '127.0.0.1', () => {
        const u = new URL(AUTH_URL);
        u.searchParams.set('client_id', client.id);
        u.searchParams.set('redirect_uri', `http://127.0.0.1:${server.address().port}`);
        u.searchParams.set('response_type', 'code');
        u.searchParams.set('scope', SCOPES.concat(...features.map((f) => FEATURE_SCOPES[f] || [])).join(' '));
        u.searchParams.set('include_granted_scopes', 'true');
        if (loginHint) u.searchParams.set('login_hint', loginHint);
        u.searchParams.set('code_challenge', challenge);
        u.searchParams.set('code_challenge_method', 'S256');
        u.searchParams.set('state', state);
        u.searchParams.set('access_type', 'offline');
        u.searchParams.set('prompt', 'consent select_account');
        this.openUrl(u.toString(), profile).catch((e) => finish(e));
      });
    });

    const tok = await this.tokenRequest({
      code,
      client_id: client.id,
      client_secret: client.secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier
    });
    if (!tok.refresh_token) throw new Error("Google n'a pas renvoyé de jeton de rafraîchissement. Réessaie.");
    const info = await this.userInfo(tok.access_token);
    const picture = await this.pictureData(info.picture);
    const accounts = this.store.accounts().filter((a) => a.email !== info.email);
    accounts.push({ email: info.email, name: info.name || info.email, picture, refresh: this.vault.encrypt(tok.refresh_token), scope: tok.scope || '' });
    this.store.setAccounts(accounts);
    this.store.save();
    this.tokens.set(info.email, { access: tok.access_token, expires: Date.now() + (tok.expires_in - 60) * 1000 });
    return { email: info.email, name: info.name };
  }

  remove(email) {
    const acc = this.store.accounts().find((a) => a.email === email);
    this.store.setAccounts(this.store.accounts().filter((a) => a.email !== email));
    this.store.save();
    this.tokens.delete(email);
    // Révoque le jeton côté Google (au mieux).
    if (acc) {
      try {
        const refresh = this.vault.decrypt(acc.refresh);
        this.fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: 'POST' }).catch(() => {});
      } catch {}
    }
  }

  // Jeton d'accès valide pour un compte (rafraîchi automatiquement).
  async accessToken(email) {
    const cached = this.tokens.get(email);
    if (cached && cached.expires > Date.now()) return cached.access;
    const acc = this.store.accounts().find((a) => a.email === email);
    if (!acc) throw new Error(`Compte ${email} non connecté.`);
    const client = this.client();
    let tok;
    try {
      tok = await this.tokenRequest({
        client_id: client.id,
        client_secret: client.secret,
        refresh_token: this.vault.decrypt(acc.refresh),
        grant_type: 'refresh_token'
      });
    } catch (e) {
      if (e.code === 'invalid_grant') {
        acc.invalid = true;
        this.store.save();
        throw new Error(`La connexion du compte ${email} a expiré : reconnecte-le dans Réglages › Comptes Google.`);
      }
      throw e;
    }
    if (tok.scope && tok.scope !== acc.scope) {
      acc.scope = tok.scope;
      this.store.save();
    }
    if (acc.invalid) {
      delete acc.invalid;
      this.store.save();
    }
    this.tokens.set(email, { access: tok.access_token, expires: Date.now() + (tok.expires_in - 60) * 1000 });
    return tok.access_token;
  }

  tokenFn(email) {
    return () => this.accessToken(email);
  }

  async tokenRequest(params) {
    const res = await this.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString()
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error_description || body.error || `HTTP ${res.status}`);
      err.code = body.error;
      throw err;
    }
    return body;
  }

  async userInfo(access) {
    const res = await this.fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${access}` } });
    if (!res.ok) throw new Error('Impossible de lire le profil Google.');
    return res.json();
  }

  // Photo de profil en data: URL (la page de l'app n'affiche pas d'images distantes).
  async pictureData(url) {
    if (!url) return null;
    try {
      const res = await this.fetch(url.replace(/=s\d+-c$/, '=s96-c'));
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return `data:${res.headers.get('content-type') || 'image/jpeg'};base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  }
}

module.exports = { GoogleAccounts, SCOPES, FEATURE_SCOPES };
