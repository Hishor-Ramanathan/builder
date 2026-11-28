import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// fake herdr: one blocked agent in w9:p1, logs every call
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'builder-'));
const log = path.join(tmp, 'calls.log');
const fake = path.join(tmp, 'herdr');
await fs.writeFile(fake, `#!/bin/sh
echo "$@" >> ${log}
case "$1 $2" in
  "agent list") echo '{"result":{"agents":[{"pane_id":"w9:p1","terminal_id":"t1","agent_status":"blocked","state_change_seq":7,"cwd":"/x/Thamarai","terminal_title_stripped":"Book import"}]}}';;
  "pane read") echo "Proceed with import? (y/n)";;
esac
`, { mode: 0o755 });
Object.assign(process.env, { HERDR: fake, OWNER: 'me@x', REQ_DIR: path.join(tmp, 'req'), DATA_DIR: tmp, PORT: '0' });
const { server, formatAnswer, checkPane } = await import('./server.js');
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = (p, user, body) => fetch(base + p, {
  method: body ? 'POST' : 'GET', headers: { 'tailscale-user-login': user, 'content-type': 'application/json' }, body: body && JSON.stringify(body),
}).then(async r => ({ status: r.status, json: await r.json() }));
test.after(() => server.close());

test('formatAnswer: pick lists every option, review approve goes to dev', () => {
  const pick = { kind: 'pick', title: 'Event block', options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] };
  assert.match(formatAnswer(pick, { verdicts: [true, false, true], notes: ['bigger dates', '', ''] }), /A: keep \(bigger dates\); B: skip; C: keep\. Build/);
  assert.match(formatAnswer(pick, { verdicts: [false, false, false], notes: [] }), /Nothing kept/);
  assert.equal(formatAnswer({ kind: 'review', id: 'x' }, { approve: true }), '[Builder] review x: APPROVED. Merge into dev (not main) and clean up the worktree.');
  assert.match(formatAnswer({ kind: 'review', id: 'x', approve: 'upload to kDrive' }, { approve: true, text: 'Logo größer' }), /APPROVED\. Go ahead: upload to kDrive\. \| Notiz: Logo größer$/);
});

test('checkPane refuses stale or busy panes', () => {
  const a = [{ pane_id: 'w1:p1', terminal_id: 't', agent_status: 'blocked', state_change_seq: 3 }];
  assert.equal(checkPane(a, 'w1:p1', 't', 3), null);
  assert.match(checkPane(a, 'w1:p1', 't', 2), /moved on/);
  assert.match(checkPane(a, 'w1:p1', 'other', 3), /different agent/);
  assert.match(checkPane(a, 'w2:p1'), /gone/);
  assert.match(checkPane([{ ...a[0], agent_status: 'working' }], 'w1:p1'), /busy/);
});

test('inbox shows blocked agent; viewer cannot answer, owner can', async () => {
  const anon = await fetch(base + '/api/inbox');
  assert.equal(anon.status, 401);
  const { json } = await call('/api/inbox', 'me@x');
  assert.equal(json.me.role, 'owner');
  assert.equal(json.items[0].pane, 'w9:p1');
  assert.match(json.items[0].tail, /Proceed/);

  assert.equal((await call('/api/answer', 'friend@x', { pane: 'w9:p1', text: 'y' })).status, 403);
  assert.equal((await call('/api/answer', 'me@x', { pane: 'w9:p1', terminal_id: 't1', seq: 6, text: 'y' })).status, 409);
  assert.equal((await call('/api/answer', 'me@x', { pane: 'w9:p1', terminal_id: 't1', seq: 7, text: 'y' })).status, 200);
  const calls = await fs.readFile(log, 'utf8');
  assert.match(calls, /pane send-text w9:p1 y\nagent send-keys w9:p1 enter/);
});

test('viewer can comment; pick request answer is written once', async () => {
  assert.equal((await call('/api/comment', 'friend@x', { item: 'pane:w9:p1:7', text: 'nice' })).status, 200);
  await fs.mkdir(process.env.REQ_DIR, { recursive: true });
  await fs.writeFile(path.join(process.env.REQ_DIR, 'evt.json'), JSON.stringify({ kind: 'pick', pane: 'w9:p1', title: 'Event block', options: [{ label: 'A' }, { label: 'B' }] }));
  const { json } = await call('/api/inbox', 'me@x');
  assert.ok(json.items.some(i => i.id === 'req:evt'));
  assert.ok(!json.items.some(i => i.type === 'agent'), 'raw pane card hidden while it has a request');
  assert.equal((await call('/api/answer', 'me@x', { request: 'evt', verdicts: [true, false], notes: ['', ''] })).status, 200);
  assert.equal((await call('/api/answer', 'me@x', { request: 'evt', verdicts: [true, false], notes: ['', ''] })).status, 409);
  assert.equal((await fetch(base + '/files/../server.js', { headers: { 'tailscale-user-login': 'me@x' } })).status, 404);
});

test('files: videos are served with byte ranges (Safari needs them)', async () => {
  const dir = path.join(tmp, 'req', 'clip');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'v.mp4'), '0123456789');
  const get = (range) => fetch(base + '/files/clip/v.mp4', { headers: { 'tailscale-user-login': 'me@x', ...(range && { range }) } });
  const full = await get();
  assert.equal(full.status, 200); assert.equal(full.headers.get('content-type'), 'video/mp4'); assert.equal(await full.text(), '0123456789');
  const part = await get('bytes=2-4');
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), 'bytes 2-4/10'); assert.equal(await part.text(), '234');
  assert.equal(await (await get('bytes=7-')).text(), '789');
  assert.equal(await (await get('bytes=-3')).text(), '789');
  assert.equal((await get('bytes=20-')).status, 416);
  assert.equal((await fetch(base + '/files/../server.js', { headers: { 'tailscale-user-login': 'me@x' } })).status, 404);
});

test('media: picks come back in his order with in/out and notes', async () => {
  await fs.writeFile(path.join(process.env.REQ_DIR, 'shots.json'), JSON.stringify({ kind: 'media', pane: 'w9:p1', title: 'Shots',
    items: [{ label: 'V12', video: 'g/V12.mp4' }, { label: 'P61', image: 'g/P61.jpg' }, { label: 'V16', video: 'g/V16.mp4' }] }));
  const picks = [{ label: 'V12', in: 1, out: 2.64 }, { label: 'P61' }, { label: 'V16', in: 3, out: 1.5, note: 'nur der Jubel' },
    { label: 'NOPE' }, { label: 'P61' }];
  const r = await call('/api/answer', 'me@x', { request: 'shots', picks, note: 'Gewinner zuletzt' });
  assert.equal(r.status, 200);
  assert.equal(r.json.sent, '[Builder] media shots: 1. V12 1.0–2.6 s | 2. P61 | 3. V16 1.5–3.0 s "nur der Jubel" | Notiz: Gewinner zuletzt');
  assert.match(await fs.readFile(log, 'utf8'), /pane send-text w9:p1 \[Builder\] media shots: 1\. V12/);
  const saved = JSON.parse(await fs.readFile(path.join(process.env.REQ_DIR, 'shots.answer.json'), 'utf8'));
  assert.deepEqual(saved.picks.map(p => [p.label, p.in, p.out]), [['V12', 1, 2.6], ['P61', null, null], ['V16', 1.5, 3]]);
  assert.equal(formatAnswer({ kind: 'media', id: 'x', items: [] }, {}), '[Builder] media x: nichts gewählt');
});

test('review: markers come back sorted, as text and JSON', async () => {
  await fs.writeFile(path.join(process.env.REQ_DIR, 'reel.json'), JSON.stringify({ kind: 'review', pane: 'w9:p1', title: 'Reel', video: 'g/r.mp4',
    shots: [{ at: 0, dur: 4, label: 'Intro' }] }));
  const markers = [{ in: 9.62, note: 'falscher Gewinner' }, { in: 5.3, out: 3.1, note: 'Text zu klein' }, { note: 'no time' }, { in: 2, out: 2 }];
  const r = await call('/api/answer', 'me@x', { request: 'reel', approve: false, markers, text: 'sonst gut' });
  assert.equal(r.status, 200);
  assert.equal(r.json.sent, '[Builder] review reel: denied | 2.0 s (keine Notiz) | 3.1–5.3 s Text zu klein | 9.6 s falscher Gewinner | Notiz: sonst gut | Fix this and send a new review request (new id).');
  const saved = JSON.parse(await fs.readFile(path.join(process.env.REQ_DIR, 'reel.answer.json'), 'utf8'));
  assert.deepEqual(saved.markers, [{ in: 2, out: null, note: '' }, { in: 3.1, out: 5.3, note: 'Text zu klein' }, { in: 9.6, out: null, note: 'falscher Gewinner' }]);
});

test('dismiss: request leaves the inbox, idle agent is told, only once', async () => {
  await fs.writeFile(path.join(process.env.REQ_DIR, 'old.json'), JSON.stringify({ kind: 'review', pane: 'w9:p1', title: 'Old' }));
  assert.equal((await call('/api/dismiss', 'friend@x', { request: 'old' })).status, 403);
  assert.equal((await call('/api/dismiss', 'me@x', { request: 'old' })).status, 200);
  assert.equal((await call('/api/dismiss', 'me@x', { request: 'old' })).status, 409);
  const { json } = await call('/api/inbox', 'me@x');
  assert.ok(!json.items.some(i => i.id === 'req:old'));
  assert.match(await fs.readFile(log, 'utf8'), /pane send-text w9:p1 \[Builder\] review old: dismissed/);
});
