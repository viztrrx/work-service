// Builds the offline console (see web/offline.js): ONE .html file with
// script.js inside it, opened straight from disk. The Worker builds the same
// file on request at its own address; this makes it locally.
//
//   npm run build:offline                      → build/saints-service.html
//   node scripts/build-offline.mjs --out x.html
//   node scripts/build-offline.mjs --worker http://127.0.0.1:8787   (tests)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { offlineHtml, pointAtWorker, OFFLINE_FILENAME } from '../web/offline.js';
import devtools from '../web/devtools.generated.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined; };
const out = path.resolve(arg('out') || path.join(ROOT, 'build', OFFLINE_FILENAME));
const worker = arg('worker');

const code = pointAtWorker(await readFile(path.join(ROOT, 'script.js'), 'utf8'), worker);
const iconBase64 = (await readFile(path.join(ROOT, 'web/console/public/icon-192.png'))).toString('base64');
const built = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const html = offlineHtml(code, { iconBase64, built, devtools });

await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, html);
console.log(`Wrote ${path.relative(process.cwd(), out) || out} (${(html.length / 1048576).toFixed(1)} MB${worker ? ', Worker ' + worker : ', live Worker'})`);
console.log('Open it from disk: double-click it, or drag it into a Chrome window.');
