// Builder: one inbox for everything Hishor's agents are waiting on.
// Sources: herdr agents that are blocked/done, plus structured requests agents drop in requests/*.json.
// Auth: runs on 127.0.0.1 behind `tailscale serve`, which sets Tailscale-User-Login. OWNER answers; everyone else views + comments.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const run = promisify(execFile);
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const HERDR = process.env.HERDR || 'herdr';
const OWNER = process.env.OWNER || '';
const PORT = +process.env.PORT || 8740;
const REQ_DIR = process.env.REQ_DIR || path.join(ROOT, 'requests');
const COMMENTS = path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'comments.json');
const PANE_RE = /^w\d+:p\d+$/;
const WAITING = new Set(['blocked', 'done']);

async function herdr(...args) {
  const { stdout } = await run(HERDR, args, { timeout: 10000, maxBuffer: 4 << 20 });
  return stdout;
}
export async function listAgents() {
  return JSON.parse(await herdr('agent', 'list')).result.agents;
}
async function readPane(pane) {
  try { return (await herdr('pane', 'read', pane, '--source', 'recent', '--lines', '40')).trimEnd(); }
  catch { return ''; }
}
async function sendToPane(pane, text) {
  await herdr('pane', 'send-text', pane, text);
  await herdr('agent', 'send-keys', pane, 'enter');
}

// --- requests (pick / review) written by agents, see AGENT-PROTOCOL.md
async function loadRequests() {
  await fs.mkdir(REQ_DIR, { recursive: true });
  const out = [];
  for (const f of await fs.readdir(REQ_DIR)) {
    if (!f.endsWith('.json') || f.endsWith('.answer.json')) continue;
    try {
      const r = JSON.parse(await fs.readFile(path.join(REQ_DIR, f), 'utf8'));
      r.id = f.slice(0, -5);
      try { r.answer = JSON.parse(await fs.readFile(path.join(REQ_DIR, r.id + '.answer.json'), 'utf8')); } catch {}
      out.push(r);
    } catch {}
  }
  return out.sort((a, b) => (a.created || '').localeCompare(b.created || ''));
}

// Turns the owner's decision into one line the agent reads as its next prompt.
export function formatAnswer(req, body) {
  if (req.kind === 'pick') {
    const parts = (req.options || []).map((o, i) => {
      const v = body.verdicts?.[i]; const n = (body.notes?.[i] || '').trim();
      return `${o.label}: ${v ? 'keep' : 'skip'}${n ? ` (${n})` : ''}`;
    });
    const kept = (body.verdicts || []).some(Boolean);
    return `[Builder] ${req.title}: ${parts.join('; ')}. ${kept ? 'Build what I kept, merging them if several, then send a review request.' : 'Nothing kept: make 3 new options using my notes.'}`;
  }
  if (req.kind === 'review') {
    return body.approve
      ? `[Builder] ${req.title}: APPROVED. Merge into dev (not main) and clean up the worktree.`
      : `[Builder] ${req.title}: DENIED. Change this: ${(body.text || '').trim()}. Then send a new review request.`;
  }
  return `[Builder] ${req.title}: ${(body.text || '').trim()}`;
}

// Only type into a pane that is still the agent we showed and is not mid-work.
export function checkPane(agents, pane, terminalId, seq) {
  const a = agents.find(x => x.pane_id === pane);
  if (!a) return 'That agent is gone.';
  if (terminalId && a.terminal_id !== terminalId) return 'A different agent is in that pane now.';
  if (a.agent_status === 'working') return 'The agent is busy right now. Try again when it stops.';
  if (seq != null && a.state_change_seq !== seq) return 'The agent moved on since you looked. Refresh.';
  return null;
}

async function loadComments() { try { return JSON.parse(await fs.readFile(COMMENTS, 'utf8')); } catch { return []; } }

async function inbox() {
  const [agents, requests, comments] = await Promise.all([listAgents().catch(() => []), loadRequests(), loadComments()]);
  const open = requests.filter(r => !r.answer);
  const panesWithRequest = new Set(open.map(r => r.pane));
  // every herdr session is listed; blocked/done ones count as waiting on the owner and sort first
  const sessions = agents.filter(a => !panesWithRequest.has(a.pane_id))
    .sort((a, b) => WAITING.has(b.agent_status) - WAITING.has(a.agent_status));
  const items = [
    ...open.map(r => ({ ...r, type: r.kind, id: 'req:' + r.id, waiting: true })),
    ...await Promise.all(sessions.map(async a => ({
      waiting: WAITING.has(a.agent_status),
      type: 'agent', id: 'pane:' + a.pane_id + ':' + a.state_change_seq, pane: a.pane_id, terminal_id: a.terminal_id,
      seq: a.state_change_seq, status: a.agent_status, title: a.terminal_title_stripped || a.pane_id,
      project: path.basename(a.cwd || ''), tail: await readPane(a.pane_id),
    }))),
  ];
  for (const it of items) it.comments = comments.filter(c => c.item === it.id);
  return { items, recent: requests.filter(r => r.answer).slice(-10).reverse() };
}

// --- http
// Direct tailnet connections: ask Tailscale who owns the connecting device. Loopback: trust the header `tailscale serve` sets.
const whoisCache = new Map();
async function tailnetLogin(ip) {
  if (!whoisCache.has(ip)) {
    whoisCache.set(ip, run(process.env.TAILSCALE || 'tailscale', ['whois', '--json', ip], { timeout: 5000 })
      .then(r => JSON.parse(r.stdout).UserProfile.LoginName).catch(() => ''));
    setTimeout(() => whoisCache.delete(ip), 600000);
  }
  return whoisCache.get(ip);
}
async function who(req) {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const local = ip === '127.0.0.1' || ip === '::1';
  const login = local ? req.headers['tailscale-user-login'] || process.env.DEV_USER || '' : await tailnetLogin(ip);
  return login ? { login, name: (local && req.headers['tailscale-user-name']) || login, role: login === OWNER ? 'owner' : 'viewer' } : null;
}
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
async function readBody(req) {
  let s = ''; for await (const c of req) { s += c; if (s.length > 1e5) throw new Error('too big'); }
  return JSON.parse(s || '{}');
}
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
async function serveFile(res, base, rel, sandbox) {
  const p = path.resolve(base, '.' + path.sep + rel);
  if (!p.startsWith(base + path.sep)) return send(res, 404, { error: 'not found' });
  try {
    const data = await fs.readFile(p);
    // agent-made mockups run in an opaque origin so they can't call the API
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', ...(sandbox && { 'Content-Security-Policy': 'sandbox' }) });
    res.end(data);
  } catch { send(res, 404, { error: 'not found' }); }
}

export const server = http.createServer(async (req, res) => {
  try {
    const me = await who(req);
    if (!me) return send(res, 401, { error: 'Open Builder through Tailscale.' });
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/api/inbox') return send(res, 200, { me, ...await inbox() });
    if (req.method === 'GET' && url.pathname.startsWith('/files/')) return serveFile(res, REQ_DIR, decodeURIComponent(url.pathname.slice(7)), true);
    if (req.method === 'GET') return serveFile(res, path.join(ROOT, 'public'), url.pathname === '/' ? 'index.html' : url.pathname, false);
    if (req.method !== 'POST') return send(res, 405, { error: 'method' });

    const body = await readBody(req);
    if (url.pathname === '/api/comment') {
      const text = String(body.text || '').trim().slice(0, 2000);
      if (!text || !body.item) return send(res, 400, { error: 'Write something first.' });
      const all = await loadComments();
      all.push({ item: String(body.item), by: me.name, text, at: new Date().toISOString() });
      await fs.mkdir(path.dirname(COMMENTS), { recursive: true });
      await fs.writeFile(COMMENTS, JSON.stringify(all, null, 1));
      return send(res, 200, { ok: true });
    }
    if (me.role !== 'owner') return send(res, 403, { error: 'Only the owner can answer agents.' });

    if (url.pathname === '/api/answer') {
      let pane = body.pane, text, reqFile;
      if (body.request) {
        if (!/^[\w.-]+$/.test(body.request)) return send(res, 400, { error: 'bad request id' });
        const r = (await loadRequests()).find(x => x.id === body.request);
        if (!r || r.answer) return send(res, 409, { error: 'Already answered.' });
        pane = r.pane; text = formatAnswer(r, body); reqFile = path.join(REQ_DIR, r.id + '.answer.json');
      } else {
        text = `${String(body.text || '').trim()}`;
        if (!text) return send(res, 400, { error: 'Write an answer first.' });
      }
      if (pane) {
        if (!PANE_RE.test(pane)) return send(res, 400, { error: 'bad pane' });
        const problem = checkPane(await listAgents(), pane, body.terminal_id, body.seq);
        if (problem) return send(res, 409, { error: problem });
        await sendToPane(pane, text);
      }
      if (reqFile) await fs.writeFile(reqFile, JSON.stringify({ ...body, text, by: me.login, at: new Date().toISOString() }, null, 1));
      return send(res, 200, { ok: true, sent: text });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (!OWNER) console.warn('OWNER not set: nobody can answer agents.');
  server.listen(PORT, '127.0.0.1', () => console.log(`Builder on http://127.0.0.1:${PORT}`));
  // also listen on the Tailscale IP so phones reach it without `tailscale serve`; never 0.0.0.0 (LAN)
  if (process.env.TAILNET_IP) http.createServer(server.listeners('request')[0]).listen(PORT, process.env.TAILNET_IP, () => console.log(`Builder on http://${process.env.TAILNET_IP}:${PORT}`));
}
