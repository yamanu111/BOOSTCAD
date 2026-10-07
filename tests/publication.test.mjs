import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('browser runtime has no upload, library fetch or local server dependency', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  for (const file of await readdir(path.join(root, 'src'))) {
    const code = await readFile(path.join(root, 'src', file), 'utf8');
    assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|local-libraries|local-sample|LP_XMLConverter|C:\\RIKCAD|起動\.cmd/, file);
  }
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /(?:src|href)=["']https?:|["']\/src\//);
  assert.match(html, /href="\.\/"/);
  assert.match(html, /data-layer="product"[^>]*disabled/);
});
