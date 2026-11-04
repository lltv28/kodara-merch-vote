const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ITEMS = [
  ['lulu-smooth-spacer', 'Hoodies', 'Lululemon Smooth Spacer'],
  ['lulu-steady-state', 'Hoodies', 'Lululemon Steady State'],
  ['asc-heavy-zip', 'Hoodies', 'AS Colour Heavy Zip Hood'],
  ['asc-box-minus', 'Hoodies', 'AS Colour Box Minus'],
  ['bb13-perfect-hoodie', 'Hoodies', 'Blanks by 13 Perfect Hoodie'],
  ['lulu-fundamental', 'T-shirts', 'Lululemon The Fundamental'],
  ['lulu-everyday-classic', 'T-shirts', 'Lululemon Everyday Classic'],
  ['asc-classic-minus', 'T-shirts', 'AS Colour Classic Minus'],
  ['asc-heavy-faded', 'T-shirts', 'AS Colour Heavy Faded'],
  ['fellow-carter', 'Tumblers', 'Fellow Carter Move Mug'],
  ['stanley-transit', 'Tumblers', 'Stanley Transit Flip Top'],
  ['yeti-rambler', 'Tumblers', 'Yeti Rambler 20oz'],
  ['richardson-gramps', 'Hats', 'Richardson 256 Gramps'],
  ['47-clean-up', 'Hats', "'47 Brand Clean Up Cap"],
].map(([id, category, name]) => ({ id, category, name }));
const BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
const CATEGORIES = [...new Set(ITEMS.map((i) => i.category))];
const SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const HOODIE = 'AS Colour Box Minus Hood';
const HOODIE_COUNT = 20;
// The vote is closed: these won and are what we're ordering. Display names match the vendor order.
const WINNERS = [
  ['asc-box-minus', HOODIE, 'hood_color', 'e.g. Black', 'Black, Shadow, Ink Blue, Athletic Heather or Ecru'],
  ['47-clean-up', "'47 Brand Clean Up Cap", 'cap_color', 'e.g. Navy', "Any '47 Clean Up color"],
];
// Shipping + color fields kept in votes.info (admin only, never echoed publicly): [key, label, max, required, autocomplete].
const INFO = [
  ['street', 'Street address', 200, true, 'address-line1'],
  ['apt', 'Apt / suite (optional)', 100, false, 'address-line2'],
  ['city', 'City', 100, true, 'address-level2'],
  ['state', 'State', 100, true, 'address-level1'],
  ['zip', 'ZIP', 20, true, 'postal-code'],
  ['country', 'Country', 100, true, 'country-name'],
  ['phone', 'Phone (optional, for the carrier)', 40, false, 'tel'],
  ['hood_color', 'Hoodie color', 60, false],
  ['cap_color', 'Cap color', 60, false],
];
const SHIP = INFO.slice(0, 7);

// Storage: Postgres when DATABASE_URL is set, else a local JSON file (dev only).
// Each store exposes upsert(key, name, items, size, info), remove(key) and all() -> [{name_key, name, items, size, info, created_at}].
// upsert with items, size or info null keeps the stored value; a size-only record starts with no picks.
async function makeStore() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const local = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false } });
    await pool.query(`CREATE TABLE IF NOT EXISTS votes (
      name_key TEXT PRIMARY KEY, name TEXT NOT NULL, items TEXT[] NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await pool.query('ALTER TABLE votes ADD COLUMN IF NOT EXISTS size TEXT');
    await pool.query('ALTER TABLE votes ADD COLUMN IF NOT EXISTS info JSONB');
    return {
      upsert: (key, name, items, size, info) => pool.query(
        `INSERT INTO votes (name_key, name, items, size, info) VALUES ($1, $2, COALESCE($3::text[], '{}'), $4, $5)
         ON CONFLICT (name_key) DO UPDATE SET name = $2, items = COALESCE($3::text[], votes.items), size = COALESCE($4, votes.size),
           info = COALESCE($5, votes.info), created_at = CASE WHEN $3::text[] IS NULL THEN votes.created_at ELSE now() END`, [key, name, items, size, info]),
      remove: (key) => pool.query('DELETE FROM votes WHERE name_key = $1', [key]),
      all: async () => (await pool.query('SELECT name_key, name, items, size, info, created_at FROM votes ORDER BY created_at DESC')).rows,
    };
  }
  const file = process.env.VOTES_FILE || path.join(__dirname, 'votes.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  return {
    upsert: async (key, name, items, size, info) => {
      const db = read();
      const old = db[key];
      db[key] = { name, items: items ?? old?.items ?? [], size: size ?? old?.size ?? null, info: info ?? old?.info ?? null, created_at: items || !old ? new Date().toISOString() : old.created_at };
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
  const cards = WINNERS.map(([id, name, key, eg, hint]) => `
<div class="item"><div class="card"><span class="media"><img src="/img/${id}.jpg" alt="${esc(name)}"><button type="button" class="zoom" aria-label="View larger">${ZOOM_ICON}</button></span><span class="name">${esc(name)}</span></div>
<label class="field color">Color preference (optional)<input name="${key}" maxlength="60" placeholder="${esc(eg)}" autocomplete="off"><span class="hint">${esc(hint)}</span></label></div>`).join('');
  const ship = SHIP.map(([key, label, max, req, ac]) => `
<label class="field${key === 'state' || key === 'zip' ? ' half' : ''}">${esc(label)}<input name="${key}" maxlength="${max}" autocomplete="${ac}"${req ? ' required' : ''}${key === 'country' ? ' value="United States"' : ''}${key === 'phone' ? ' type="tel"' : ''}${key === 'zip' ? ' inputmode="numeric"' : ''}></label>`).join('');
  return page('Kodara merch', `<main id="vote">
<h1>Pick your hoodie size</h1>
<p class="sub">The vote is in. Enter your name, where to ship it, and your hoodie size.</p>
<form id="f"><label class="field">Your name<input id="name" name="name" required maxlength="100" autocomplete="name"></label>
<fieldset class="ship"><legend>Shipping address</legend><div class="ship-grid">${ship}</div>
<p class="note">Only used to ship your merch.</p></fieldset>
<fieldset class="sizes"><legend>${esc(HOODIE)} size</legend><div class="size-grid">${SIZES.map((s) => `
<label class="size"><input type="radio" name="size" value="${s}"><span>${s}</span></label>`).join('')}</div>
<p class="note">The '47 Brand Clean Up Cap is one size, adjustable.</p></fieldset>
<h2 class="vote-head">What we're getting</h2>
<div class="grid winners">${cards}</div>
<div class="bar"><span id="count">Pick a size</span><button id="go" disabled>Submit</button></div>
<p id="err" class="err" hidden></p></form></main>
<main id="thanks" hidden><h1>Thanks, you're all set.</h1><p class="sub">You can close this page.</p></main>
<dialog id="lightbox" aria-label="Product image"><img alt=""><button type="button" class="close" aria-label="Close">&times;</button></dialog>
<script src="/app.js?v=${V}"></script>`);
}

async function adminPage(store, token) {
  const votes = await store.all();
  const totals = Object.fromEntries(ITEMS.map((i) => [i.id, 0]));
  for (const v of votes) for (const id of v.items) if (id in totals) totals[id]++;
  const voters = votes.filter((v) => v.items.length).length;
  const groups = CATEGORIES.map((c) => `<h2>${esc(c)}</h2><table>${ITEMS.filter((i) => i.category === c)
    .sort((a, b) => totals[b.id] - totals[a.id]).map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${totals[i.id]}</td></tr>`).join('')}</table>`).join('');
  const sized = votes.filter((v) => v.size);
  const sizeRows = SIZES.map((s) => {
    const who = sized.filter((v) => v.size === s);
    return `<tr><td>${s}</td><td class="num">${who.length}</td><td>${who.map((v) => esc(v.name)).join(', ')}</td></tr>`;
  }).join('');
  const noSize = votes.filter((v) => !v.size).map((v) => esc(v.name)).join(', ') || 'Everyone has picked a size.';
  const sizeSheet = `<h2>${esc(HOODIE)} size sheet</h2><table class="sizesheet"><tr><th>Size</th><th class="num">Count</th><th>Who</th></tr>${sizeRows}
<tr class="total"><td>Total</td><td class="num">${sized.length}</td><td>of ${HOODIE_COUNT} hoodies</td></tr></table>
<p class="sub">No size yet: ${noSize}</p>`;
  const inf = (v) => v.info || {};
  const addr = (i) => [i.street, i.apt, [i.city, i.state].filter(Boolean).join(', ') + (i.zip ? ' ' + i.zip : ''), i.country].filter((x) => x && x.trim()).map(esc).join('<br>');
  const colors = WINNERS.map(([, name, key]) => {
    const tally = new Map();
    for (const v of votes) {
      const c = (inf(v)[key] || '').trim();
      if (!c) continue;
      const k = c.toLowerCase();
      tally.set(k, { label: tally.get(k)?.label ?? c, n: (tally.get(k)?.n ?? 0) + 1 });
    }
    const rows = [...tally.values()].sort((a, b) => b.n - a.n).map((t) => `<tr><td>${esc(t.label)}</td><td class="num">${t.n}</td></tr>`).join('');
    return `<h3>${esc(name)}</h3><table class="colors">${rows || '<tr><td class="sub">No color preferences yet</td></tr>'}</table>`;
  }).join('');
  const rows = votes.map((v) => `<tr><td>${esc(v.name)}</td><td>${v.items.map((id) => esc(BY_ID[id]?.name ?? id)).join('<br>') || '<span class="sub">No vote</span>'}</td><td>${esc(v.size || '')}</td><td>${esc(inf(v).hood_color || '')}</td><td>${esc(inf(v).cap_color || '')}</td><td>${addr(inf(v))}</td><td>${esc(inf(v).phone || '')}</td><td>${esc(new Date(v.created_at).toISOString().replace('T', ' ').slice(0, 16))} UTC</td><td><form method="post" action="/admin/${encodeURIComponent(token)}/delete" onsubmit="return confirm('Remove this person?')"><input type="hidden" name="name_key" value="${esc(v.name_key)}"><button class="remove">Remove</button></form></td></tr>`).join('');
  return page('Kodara merch results', `<main class="admin"><h1>Results</h1>
<p class="sub">${voters} ${voters === 1 ? 'voter' : 'voters'}. <a href="/admin/${encodeURIComponent(token)}/votes.csv">Download CSV</a></p>
${sizeSheet}<h2>Winners</h2><table>${WINNERS.map(([id, name]) => `<tr><td>${esc(name)}</td><td class="num">${totals[id]}</td></tr>`).join('')}</table>
<h2>Color preferences</h2>${colors}
<details class="final"><summary>Final vote, all items</summary>${groups}</details><h2>People</h2><div class="scroll"><table><tr><th>Name</th><th>Picks</th><th>Size</th><th>Hood color</th><th>Cap color</th><th>Ship to</th><th>Phone</th><th>Time</th><th></th></tr>${rows}</table></div></main>`);
}

async function csv(store) {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const votes = await store.all();
  return [['name,pick_1,pick_2,hoodie_size', ...INFO.map(([k]) => k), 'voted_at'].join(','), ...votes.map((v) => {
    const [a = '', b = ''] = v.items.map((id) => BY_ID[id]?.name ?? id);
    return [v.name, a, b, v.size || '', ...INFO.map(([k]) => v.info?.[k] || ''), new Date(v.created_at).toISOString()].map(q).join(',');
  })].join('\n') + '\n';
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
        const items = Array.isArray(b.items) && b.items.length ? [...new Set(b.items)] : null;
        const size = b.size == null || b.size === '' ? null : b.size;
        if (!name || name.length > 100) return send(res, 400, '{"error":"Please enter your name."}', 'application/json');
        if (size !== null && !SIZES.includes(size)) return send(res, 400, '{"error":"Pick a hoodie size."}', 'application/json');
        if (items ? items.length !== 2 || !items.every((id) => id in BY_ID) : !size) return send(res, 400, '{"error":"Pick exactly 2 items."}', 'application/json');
        // info is replaced as a whole when the page sends it; callers without it (older page) keep what's stored
        let info = null;
        if (INFO.some(([k]) => k in b)) {
          info = {};
          for (const [k, label, max, req] of INFO) {
            const val = typeof b[k] === 'string' ? b[k].trim().replace(/\s+/g, ' ') : '';
            if (val.length > max) return send(res, 400, JSON.stringify({ error: `${label} is too long.` }), 'application/json');
            if (req && !val) return send(res, 400, JSON.stringify({ error: `Please enter your ${label.toLowerCase()}.` }), 'application/json');
            info[k] = val;
          }
        }
        await store.upsert(nameKey(name), name, items, size, info);
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
