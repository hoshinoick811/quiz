'use strict';
/* 运维面试题库 · 本地服务
 * - 托管 public/ 静态页面
 * - 提供事件同步接口（手机与电脑在同一网段时自动合并）
 * 无第三方依赖，只用 Node 内置模块。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PORT = Number(process.env.PORT || 8765);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const MAX_BODY = 32 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

/* ---------- 事件存储 ---------- */

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(EVENTS_FILE)) {
    fs.writeFileSync(EVENTS_FILE, JSON.stringify({ version: 1, events: [] }), 'utf8');
  }
}

function readEvents() {
  ensureData();
  try {
    const raw = fs.readFileSync(EVENTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch (err) {
    console.error('[warn] events.json 读取失败，按空库处理：', err.message);
    return [];
  }
}

function writeEvents(events) {
  ensureData();
  const tmp = EVENTS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, events }, null, 0), 'utf8');
  fs.renameSync(tmp, EVENTS_FILE);
}

const VALID_KINDS = new Set(['again', 'half', 'good', 'verify', 'skip']);

function normalizeEvent(e) {
  if (!e || typeof e !== 'object') return null;
  const id = typeof e.id === 'string' && e.id.length > 0 && e.id.length <= 80 ? e.id : null;
  const item = typeof e.item === 'string' && e.item.length > 0 && e.item.length <= 80 ? e.item : null;
  const ts = Number(e.ts);
  const k = VALID_KINDS.has(e.k) ? e.k : null;
  if (!id || !item || !k || !Number.isFinite(ts)) return null;
  return {
    id,
    item,
    ts: Math.floor(ts),
    k,
    dev: typeof e.dev === 'string' ? e.dev.slice(0, 16) : 'unknown'
  };
}

function mergeEvents(incoming) {
  const current = readEvents();
  const byId = new Map();
  for (const e of current) {
    const n = normalizeEvent(e);
    if (n) byId.set(n.id, n);
  }
  let added = 0;
  for (const raw of incoming) {
    const n = normalizeEvent(raw);
    if (!n) continue;
    if (!byId.has(n.id)) {
      byId.set(n.id, n);
      added += 1;
    }
  }
  if (added > 0) writeEvents([...byId.values()]);
  return { events: [...byId.values()], added, total: byId.size };
}

/* ---------- HTTP 辅助 ---------- */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  }, CORS));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family === 'IPv4' && !info.internal) {
        out.push({ iface: name, address: info.address });
      }
    }
  }
  return out;
}

/* 从一堆网卡里挑出「手机该用的那个」：排除虚拟网卡，优先无线/以太网 */
const VIRTUAL_RE = /vmware|virtualbox|vethernet|hyper-v|wsl|loopback|bluetooth|tap|tun|docker/i;

function pickPrimary(addrs) {
  const real = addrs.filter((a) => !VIRTUAL_RE.test(a.iface));
  const pref = real.filter((a) => /wlan|wi-?fi|wireless|无线|以太网|ethernet|en\d|wlp/i.test(a.iface));
  const pool = pref.length ? pref : real.length ? real : addrs;
  const privatePref = pool.filter((a) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address));
  return (privatePref[0] || pool[0] || null);
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';

  // index.html 里给静态资源加上 ?v=<文件改动时间>，彻底断掉旧缓存
  if (rel === '/index.html') return serveIndex(res);

  const full = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 not found');
      return;
    }
    const ext = path.extname(full).toLowerCase();
    const revalidate = ['.html', '.js', '.css', '.json', '.webmanifest'].includes(ext);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': revalidate ? 'no-cache, must-revalidate' : 'public, max-age=86400'
    });
    fs.createReadStream(full).pipe(res);
  });
}

/* 静态资源的版本号：取几个关键文件里最新的 mtime */
function assetTag() {
  const files = ['public/styles.css', 'public/app.js', 'public/srs.js'];
  // 题库按章拆分，加一章就多一个文件，直接扫目录，免得漏了新章
  try {
    const dir = path.join(ROOT, 'public', 'data');
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.json')) files.push('public/data/' + f);
    }
  } catch (_) {}
  let t = 0;
  for (const f of files) {
    try { t = Math.max(t, fs.statSync(path.join(ROOT, f)).mtimeMs); } catch (_) {}
  }
  return Math.round(t).toString(36);
}

function serveIndex(res) {
  fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8', (err, html) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('index.html 读取失败');
      return;
    }
    const tag = assetTag();
    const out = html
      .replace(/(href|src)="\.\/(styles\.css|app\.js|srs\.js)"/g, `$1="./$2?v=${tag}"`)
      .replace('</head>', `<meta name="build" content="${tag}" /></head>`);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(out),
      'Cache-Control': 'no-cache, must-revalidate'
    });
    res.end(out);
  });
}

/* ---------- 路由 ---------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (p === '/api/ping') {
    return json(res, 200, { ok: true, ts: Date.now(), host: os.hostname(), port: PORT });
  }

  if (p === '/api/info') {
    const addrs = lanAddresses();
    const primary = pickPrimary(addrs);
    return json(res, 200, {
      ok: true,
      port: PORT,
      host: os.hostname(),
      primary: primary ? `http://${primary.address}:${PORT}` : null,
      primaryIface: primary ? primary.iface : null,
      urls: addrs.map((a) => `http://${a.address}:${PORT}`),
      addresses: addrs
    });
  }

  if (p === '/api/sync') {
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body || '{}');
      const incoming = Array.isArray(parsed.events) ? parsed.events : [];
      const result = mergeEvents(incoming);
      return json(res, 200, { ok: true, ...result, serverTs: Date.now() });
    } catch (err) {
      return json(res, 400, { ok: false, error: String(err.message || err) });
    }
  }

  if (p.startsWith('/api/')) return json(res, 404, { ok: false, error: 'unknown api' });

  return serveStatic(req, res, p);
});

ensureData();

server.listen(PORT, '0.0.0.0', () => {
  const urls = lanAddresses().map((a) => `  http://${a.address}:${PORT}`);
  console.log('');
  console.log('  运维面试题库 已启动');
  console.log('  ────────────────────────────────');
  console.log(`  本机打开：http://localhost:${PORT}`);
  if (urls.length) {
    console.log('  手机打开（同一 WiFi）：');
    urls.forEach((u) => console.log(u));
  } else {
    console.log('  [提示] 未检测到局域网地址，手机可能连不上');
  }
  console.log(`  数据文件：${EVENTS_FILE}`);
  console.log('  停止服务：Ctrl + C');
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\n  已停止。');
  process.exit(0);
});
