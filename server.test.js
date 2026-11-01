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
  assert.match(formatAnswer({ kind: 'review', title: 'X' }, { approve: true }), /APPROVED\. Merge into dev \(not main\)/);
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
