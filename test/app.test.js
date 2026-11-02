const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3999 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'test-admin-token';
const votesFile = path.join(os.tmpdir(), `votes-${PORT}.json`);
let srv;

before(async () => {
  const env = { ...process.env, PORT, ADMIN_TOKEN: TOKEN, VOTES_FILE: votesFile };
  if (!process.env.TEST_DATABASE_URL) delete env.DATABASE_URL; else env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  srv = spawn('node', [path.join(__dirname, '..', 'server.js')], { env, stdio: 'inherit' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/healthz')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => { srv.kill(); fs.rmSync(votesFile, { force: true }); });

const vote = (name, items) => fetch(BASE + '/api/vote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, items }) });

test('healthz', async () => assert.equal(await (await fetch(BASE + '/healthz')).text(), 'ok'));

test('exactly 2 picks and a name are required', async () => {
  assert.equal((await vote('A', ['lulu-fundamental'])).status, 400);
  assert.equal((await vote('A', ['lulu-fundamental', 'yeti-rambler', 'fellow-carter'])).status, 400);
  assert.equal((await vote('A', ['lulu-fundamental', 'lulu-fundamental'])).status, 400);
  assert.equal((await vote('A', ['lulu-fundamental', 'nope'])).status, 400);
  assert.equal((await vote('   ', ['lulu-fundamental', 'yeti-rambler'])).status, 400);
  const ok = await vote('A', ['lulu-fundamental', 'yeti-rambler']);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true });
});

test('re-vote replaces, admin totals correct, csv', async () => {
  await vote('Jane Doe', ['lulu-smooth-spacer', 'asc-box-minus']);
  await vote('  jane DOE ', ['yeti-rambler', '47-clean-up']);
  await vote('Bob', ['yeti-rambler', 'lulu-smooth-spacer']);
  const html = await (await fetch(`${BASE}/admin/${TOKEN}`)).text();
  const total = (name) => Number(html.match(new RegExp(`${name.replace(/'/g, '&#39;')}</td><td class="num">(\\d+)`))[1]);
  assert.equal(total('Yeti Rambler 20oz'), 3); // A, jane, Bob
  assert.equal(total('Lululemon Smooth Spacer'), 1); // jane's old vote replaced
  assert.equal(total('AS Colour Box Minus'), 0);
  assert.equal(total("'47 Brand Clean Up Cap"), 1);
  assert.match(html, /3 voters/);
  // grouped and sorted high to low within Tumblers
  assert.ok(html.indexOf('Yeti Rambler 20oz') < html.indexOf('Fellow Carter Move Mug'));
  const csv = await (await fetch(`${BASE}/admin/${TOKEN}/votes.csv`)).text();
  assert.equal(csv.trim().split('\n').length, 4);
  assert.match(csv, /"jane DOE","Yeti Rambler 20oz","'47 Brand Clean Up Cap"/);
});

test('wrong token is 404', async () => {
  for (const p of ['/admin/wrong', '/admin/wrong/votes.csv', `/admin/${TOKEN}x`, '/admin/', '/admin/%E0%A4%A']) {
    assert.equal((await fetch(BASE + p)).status, 404, p);
  }
});

test('no tally leak on public routes', async () => {
  const home = await (await fetch(BASE + '/')).text();
  assert.doesNotMatch(home, /Jane|Bob|voters/);
  for (const p of ['/api/vote', '/api/results', '/results', '/votes.json', '/../votes.json', '/admin']) {
    const r = await fetch(BASE + p);
    assert.equal(r.status, 404, p);
  }
});

test('admin can remove a vote; wrong token or GET is 404', async () => {
  const del = (token, key) => fetch(`${BASE}/admin/${token}/delete`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ name_key: key }) });
  await vote('Del Me', ['asc-heavy-faded', 'asc-heavy-zip']);
  let html = await (await fetch(`${BASE}/admin/${TOKEN}`)).text();
  assert.match(html, /name="name_key" value="del me"/);
  assert.match(html, /confirm\(/);
  assert.equal((await del('wrong', 'del me')).status, 404);
  assert.equal((await fetch(`${BASE}/admin/${TOKEN}/delete`)).status, 404);
  const r = await del(TOKEN, 'del me');
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), `/admin/${TOKEN}`);
  html = await (await fetch(`${BASE}/admin/${TOKEN}`)).text();
  assert.doesNotMatch(html, /Del Me/);
  assert.match(html, /AS Colour Heavy Faded<\/td><td class="num">0/);
  assert.match(html, /3 voters/);
  // removing an unknown key is a no-op
  assert.equal((await del(TOKEN, 'nobody')).status, 303);
  assert.match(await (await fetch(`${BASE}/admin/${TOKEN}`)).text(), /3 voters/);
});

test('vote page busts asset cache and is not cached itself', async () => {
  const r = await fetch(BASE + '/');
  assert.equal(r.headers.get('cache-control'), 'no-cache');
  const html = await r.text();
  assert.match(html, /\/app\.js\?v=[0-9a-f]{10}"/);
  assert.match(html, /\/style\.css\?v=[0-9a-f]{10}"/);
  const v = html.match(/app\.js\?v=([0-9a-f]+)/)[1];
  assert.equal((await fetch(`${BASE}/app.js?v=${v}`)).status, 200);
});

test('no prices on the vote page', async () => {
  assert.doesNotMatch(await (await fetch(BASE + '/')).text(), /\$\d|class="price"/);
});
