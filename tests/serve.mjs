// Serveur local de test : sert l'application + un faux Supabase sous /mock (données fictives).
// Lancer : node tests/serve.mjs   puis ouvrir http://localhost:8766/index.html?mock
// Pour simuler une coupure réseau : http://localhost:8766/__mock/offline?on=1 (et on=0 pour rétablir)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMock } from './mock-supabase.mjs';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const PORT = Number(process.env.PORT || 8766);
const mock = createMock();
let offline = false;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__mock/offline') { offline = url.searchParams.get('on') === '1'; res.end(`offline=${offline}`); return; }
  if (url.pathname.startsWith('/mock/')) {
    if (offline) { req.socket.destroy(); return; }
    let body = '';
    for await (const c of req) body += c;
    const h = {}; for (const [k, v] of Object.entries(req.headers)) h[k] = v;
    const r = mock.handle(req.method, req.url, h, body ? JSON.parse(body) : null);
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    res.end(r.body == null ? '' : JSON.stringify(r.body));
    return;
  }
  const p = normalize(join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try {
    const data = await readFile(p);
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end('404'); }
}).listen(PORT, '127.0.0.1', () => console.log(`Journal (test) : http://localhost:${PORT}/index.html?mock`));
