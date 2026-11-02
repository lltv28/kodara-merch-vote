const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ITEMS = [
  ['lulu-smooth-spacer', 'Hoodies', 'Lululemon Smooth Spacer', 140],
  ['lulu-steady-state', 'Hoodies', 'Lululemon Steady State', 130],
  ['asc-heavy-zip', 'Hoodies', 'AS Colour Heavy Zip Hood', 45],
  ['asc-box-minus', 'Hoodies', 'AS Colour Box Minus', 45],
  ['bb13-perfect-hoodie', 'Hoodies', 'Blanks by 13 Perfect Hoodie', 65],
  ['lulu-fundamental', 'T-shirts', 'Lululemon The Fundamental', 60],
  ['lulu-everyday-classic', 'T-shirts', 'Lululemon Everyday Classic', 60],
  ['asc-classic-minus', 'T-shirts', 'AS Colour Classic Minus', 25],
  ['asc-heavy-faded', 'T-shirts', 'AS Colour Heavy Faded', 25],
  ['fellow-carter', 'Tumblers', 'Fellow Carter Move Mug', 50],
  ['stanley-transit', 'Tumblers', 'Stanley Transit Flip Top', 50],
  ['yeti-rambler', 'Tumblers', 'Yeti Rambler 20oz', 55],
  ['richardson-gramps', 'Hats', 'Richardson 256 Gramps', 25],
  ['47-clean-up', 'Hats', "'47 Brand Clean Up Cap", 20],
].map(([id, category, name, price]) => ({ id, category, name, price }));
const BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
const CATEGORIES = [...new Set(ITEMS.map((i) => i.category))];

// Storage: Postgres when DATABASE_URL is set, else a local JSON file (dev only).
// Each store exposes upsert(key, name, items), remove(key) and all() -> [{name_key, name, items, created_at}].
async function makeStore() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const local = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false } });
    await pool.query(`CREATE TABLE IF NOT EXISTS votes (
      name_key TEXT PRIMARY KEY, name TEXT NOT NULL, items TEXT[] NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    return {
      upsert: (key, name, items) => pool.query(
        `INSERT INTO votes (name_key, name, items) VALUES ($1, $2, $3)
         ON CONFLICT (name_key) DO UPDATE SET name = $2, items = $3, created_at = now()`, [key, name, items]),
      remove: (key) => pool.query('DELETE FROM votes WHERE name_key = $1', [key]),
      all: async () => (await pool.query('SELECT name_key, name, items, created_at FROM votes ORDER BY created_at DESC')).rows,
    };
  }
  const file = process.env.VOTES_FILE || path.join(__dirname, 'votes.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  return {
    upsert: async (key, name, items) => {
      const db = read();
      db[key] = { name, items, created_at: new Date().toISOString() };
      fs.writeFileSync(file, JSON.stringify(db, null, 2));
    },
    remove: async (key) => {
      const db = read();
      delete db[key];
      fs.writeFileSync(file, JSON.stringify(db, null, 2));
    },
    all: async () => Object.entries(read()).map(([name_key, v]) => ({ name_key, ...v })).sort((a, b) => b.created_at.localeCompare(a.created_at)),
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const nameKey = (n) => n.trim().replace(/\s+/g, ' ').toLowerCase();

function tokenOk(given) {
  const want = process.env.ADMIN_TOKEN;
  if (!want) return false;
  const h = (s) => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(h(given), h(want));
}

// Content hash for cache busting: browsers cache static files for an hour, so a deploy
// must change the asset URLs or old JS/CSS gets paired with new HTML.
const V = crypto.createHash('sha1').update(['app.js', 'style.css'].map((f) => fs.readFileSync(path.join(__dirname, 'public', f))).join('')).digest('hex').slice(0, 10);

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<link rel="icon" href="/kodara.svg"><link rel="stylesheet" href="/style.css?v=${V}"></head><body>
<header><img src="/kodara.svg" alt="Kodara" class="logo"></header>${body}</body></html>`;

const ZOOM_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21M10.5 7.5v6M7.5 10.5h6"/></svg>';

function votePage() {
  const cards = CATEGORIES.map((c) => `<h2>${esc(c)}</h2><div class="grid">${ITEMS.filter((i) => i.category === c).map((i) => `
<label class="card"><input type="checkbox" name="items" value="${i.id}">
<span class="media"><img src="/img/${i.id}.jpg" alt="${esc(i.name)}" loading="lazy"><button type="button" class="zoom" aria-label="View larger">${ZOOM_ICON}</button></span><span class="name">${esc(i.name)}</span><span class="price">$${i.price}</span></label>`).join('')}</div>`).join('');
  return page('Kodara merch vote', `<main id="vote">
<h1>Pick your top 2 Kodara merch items</h1>
<p class="sub">Choose exactly 2. If you vote again, your new picks replace the old ones.</p>
<form id="f"><label class="field">Your name<input id="name" name="name" required maxlength="100" autocomplete="name"></label>
${cards}
<div class="bar"><span id="count">0 of 2 picked</span><button id="go" disabled>Submit vote</button></div>
<p id="err" class="err" hidden></p></form></main>
<main id="thanks" hidden><h1>Thanks, your vote is in.</h1><p class="sub">You can close this page.</p></main>
<dialog id="lightbox" aria-label="Product image"><img alt=""><button type="button" class="close" aria-label="Close">&times;</button></dialog>
<script src="/app.js?v=${V}"></script>`);
}

async function adminPage(store, token) {
  const votes = await store.all();
  const totals = Object.fromEntries(ITEMS.map((i) => [i.id, 0]));
  for (const v of votes) for (const id of v.items) if (id in totals) totals[id]++;
  const groups = CATEGORIES.map((c) => `<h2>${esc(c)}</h2><table>${ITEMS.filter((i) => i.category === c)
    .sort((a, b) => totals[b.id] - totals[a.id]).map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${totals[i.id]}</td></tr>`).join('')}</table>`).join('');
  const rows = votes.map((v) => `<tr><td>${esc(v.name)}</td><td>${v.items.map((id) => esc(BY_ID[id]?.name ?? id)).join('<br>')}</td><td>${esc(new Date(v.created_at).toISOString().replace('T', ' ').slice(0, 16))} UTC</td><td><form method="post" action="/admin/${encodeURIComponent(token)}/delete" onsubmit="return confirm('Remove this vote?')"><input type="hidden" name="name_key" value="${esc(v.name_key)}"><button class="remove">Remove</button></form></td></tr>`).join('');
  return page('Kodara merch results', `<main class="admin"><h1>Results</h1>
<p class="sub">${votes.length} ${votes.length === 1 ? 'voter' : 'voters'}. <a href="/admin/${encodeURIComponent(token)}/votes.csv">Download CSV</a></p>
${groups}<h2>Votes</h2><table><tr><th>Name</th><th>Picks</th><th>Time</th><th></th></tr>${rows}</table></main>`);
}

async function csv(store) {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const votes = await store.all();
  return ['name,pick_1,pick_2,voted_at', ...votes.map((v) => [v.name, ...v.items.map((id) => BY_ID[id]?.name ?? id), new Date(v.created_at).toISOString()].map(q).join(','))].join('\n') + '\n';
}

const STATIC = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 10000) req.destroy(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function main() {
  const store = await makeStore();
  const send = (res, code, body, type = 'text/html; charset=utf-8', extra = {}) => {
    res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(body);
  };
  const notFound = (res) => send(res, 404, 'Not found', 'text/plain');

  http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      if (req.method === 'GET' && p === '/') return send(res, 200, votePage(), undefined, { 'Cache-Control': 'no-cache' });
      if (req.method === 'GET' && p === '/healthz') return send(res, 200, 'ok', 'text/plain');
      if (req.method === 'POST' && p === '/api/vote') {
        let b;
        try { b = JSON.parse(await readBody(req)); } catch { return send(res, 400, '{"error":"Bad request"}', 'application/json'); }
        const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
        const items = Array.isArray(b.items) ? [...new Set(b.items)] : [];
        if (!name || name.length > 100) return send(res, 400, '{"error":"Please enter your name."}', 'application/json');
        if (items.length !== 2 || !items.every((id) => id in BY_ID)) return send(res, 400, '{"error":"Pick exactly 2 items."}', 'application/json');
        await store.upsert(nameKey(name), name, items);
        return send(res, 200, '{"ok":true}', 'application/json');
      }
      const d = p.match(/^\/admin\/([^/]+)\/delete$/);
      if (req.method === 'POST' && d) {
        let token;
        try { token = decodeURIComponent(d[1]); } catch { return notFound(res); }
        if (!tokenOk(token)) return notFound(res);
        const key = new URLSearchParams(await readBody(req)).get('name_key');
        if (key) await store.remove(key);
        return send(res, 303, '', 'text/plain', { Location: `/admin/${encodeURIComponent(token)}` });
      }
      const m = p.match(/^\/admin\/([^/]+)(\/votes\.csv)?$/);
      if (req.method === 'GET' && m) {
        let token;
        try { token = decodeURIComponent(m[1]); } catch { return notFound(res); }
        if (!tokenOk(token)) return notFound(res);
        const noStore = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
        if (m[2]) return send(res, 200, await csv(store), 'text/csv; charset=utf-8', { ...noStore, 'Content-Disposition': 'attachment; filename="kodara-merch-votes.csv"' });
        return send(res, 200, await adminPage(store, token), undefined, noStore);
      }
      if (req.method === 'GET') {
        const file = path.join(__dirname, 'public', path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
        const type = STATIC[path.extname(file)];
        if (type && file.startsWith(path.join(__dirname, 'public') + path.sep) && fs.existsSync(file)) {
          return send(res, 200, fs.readFileSync(file), type, { 'Cache-Control': 'public, max-age=3600' });
        }
      }
      notFound(res);
    } catch (e) {
      console.error(e);
      send(res, 500, 'Server error', 'text/plain');
    }
  }).listen(process.env.PORT || 3000, () => console.log(`listening on ${process.env.PORT || 3000}`));
}

main();
