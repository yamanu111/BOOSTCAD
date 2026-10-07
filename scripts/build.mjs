import { cp, mkdir, rm, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.resolve(root, 'dist');
if (path.dirname(destination) !== path.resolve(root) || path.basename(destination) !== 'dist') throw Error('Invalid build destination');
// Only this verified output directory is replaced. No plan or library files are copied.
await rm(destination, { recursive: true, force: true });
await mkdir(destination);
export const publishedFiles = [
  'index.html', 'styles.css', '.nojekyll', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
  ...['app', 'worker', 'browser-model', 'demo-model', 'native-pln', 'rof', 'odb', 'elements', 'solid',
    'measurement', 'measurement-session', 'measurement-overlay', 'elevation-session', 'elevation-overlay', 'view-camera'].map(n => `src/${n}.mjs`),
  ...['three.module.js', 'three.core.js', 'OrbitControls.js', 'earcut.js', 'LICENSE', 'EARCUT-LICENSE'].map(n => `vendor/${n}`)
];
for (const file of publishedFiles) {
  const source = path.resolve(root, file), target = path.resolve(destination, file);
  if (!(await lstat(source)).isFile()) throw Error(`Expected a regular file: ${file}`);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target);
}
console.log(`Built ${publishedFiles.length} public files in dist/`);
