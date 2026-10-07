import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const prefix = '/BOOSTCAD/';
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.md': 'text/plain' };
http.createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/BOOSTCAD' || pathname === '/') { response.writeHead(302, { Location: prefix }); response.end(); return; }
    if (!pathname.startsWith(prefix)) throw Error('Not found');
    const target = path.resolve(root, pathname.slice(prefix.length) || 'index.html');
    if (!target.startsWith(path.resolve(root) + path.sep)) throw Error('Not found');
    const body = await readFile(target);
    response.writeHead(200, { 'Content-Type': `${types[path.extname(target)] || 'text/plain'}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(4174, '127.0.0.1', () => console.log(`BOOSTCAD preview: http://127.0.0.1:4174${prefix}`));
