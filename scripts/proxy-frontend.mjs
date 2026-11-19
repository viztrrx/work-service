// The Scramjet proxy (viztrrx/frontend) served by this Worker at /px/.
//
// Two parts, both from ONE pinned frontend commit (web/proxy/frontend.json):
//   web/proxy/*.js   the frontend's Worker code (frontendFetch and the saved-
//                    sessions API), copied in and committed, so worker.js and
//                    the tests always have it.
//   proxy-dist/px/   its static files (~520 MB, mostly games), built at deploy
//                    time and never committed: the Workers Builds build command
//                    runs `npm run build:proxy` before `npx wrangler deploy`.
//
//   npm run build:proxy                         clone the pinned commit, build
//   node scripts/proxy-frontend.mjs build --from ~/frontend   build a local checkout
//   node scripts/proxy-frontend.mjs sync --from ~/frontend    copy its Worker code in
//                                                             and pin its commit
// After `sync`, commit web/proxy/; the next deploy builds the same commit.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIN = path.join(ROOT, 'web/proxy/frontend.json');
const CODE = ['index.js', 'sessions.js', 'game-parts.js'];
const PROXY_BASE = '/px';
const OUT = path.join(ROOT, 'proxy-dist');
// proxy-dist/.assetsignore is committed so the folder always exists: without
// it, a deploy that didn't build the proxy (or the tests) would fail on a
// missing assets directory. It also keeps source maps out of the upload.
const ASSETS_IGNORE = '# Committed so proxy-dist/ always exists (scripts/proxy-frontend.mjs).\n# Files listed here are not uploaded as static assets.\n*.map\n';

const [command, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf('--' + name); return i >= 0 ? rest[i + 1] : undefined; };
const run = (cmd, args, cwd, env = {}) => execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function readPin() { return JSON.parse(fs.readFileSync(PIN, 'utf8')); }

// A checkout of the pinned commit: --from <dir> (must be at that commit, or
// --any to build whatever it has), or a fresh clone in build/frontend-src.
function checkout() {
  const pin = readPin();
  const from = opt('from');
  if (from) {
    const dir = path.resolve(from.replace(/^~(?=\/)/, process.env.HOME || '~'));
    const head = git(dir, 'rev-parse', 'HEAD');
    if (head !== pin.commit && !rest.includes('--any')) throw new Error(`${dir} is at ${head.slice(0, 7)}, but web/proxy is pinned to ${pin.commit.slice(0, 7)}. Check out that commit, run "sync" to pin this one, or pass --any.`);
    return dir;
  }
  const dir = path.join(ROOT, 'build/frontend-src');
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    run('git', ['clone', '--no-checkout', pin.repo, dir], ROOT);
  }
  run('git', ['fetch', '--quiet', 'origin', pin.commit], dir);
  run('git', ['checkout', '--quiet', '--force', pin.commit], dir);
  return dir;
}

if (command === 'sync') {
  const from = opt('from');
  if (!from) throw new Error('sync needs --from <frontend checkout>');
  const dir = path.resolve(from.replace(/^~(?=\/)/, process.env.HOME || '~'));
  if (git(dir, 'status', '--porcelain', '--', 'src')) throw new Error(`${dir}/src has uncommitted changes; commit them first so the pin means something.`);
  const commit = git(dir, 'rev-parse', 'HEAD');
  const repo = readPin().repo;
  for (const file of CODE) {
    const text = fs.readFileSync(path.join(dir, 'src', file), 'utf8');
    fs.writeFileSync(path.join(ROOT, 'web/proxy', file),
      `// Copied from ${repo.replace(/\.git$/, '')} src/${file} at ${commit}\n// by scripts/proxy-frontend.mjs sync. Don't edit here: change the frontend,\n// then sync again.\n` + text);
  }
  fs.writeFileSync(PIN, JSON.stringify({ repo, commit }, null, 2) + '\n');
  console.log(`Pinned the proxy to ${commit.slice(0, 7)} and copied ${CODE.join(', ')} into web/proxy/. Commit web/proxy/.`);
} else if (command === 'build') {
  const dir = checkout();
  if (!fs.existsSync(path.join(dir, 'node_modules'))) {
    // The frontend uses pnpm (its package.json "packageManager").
    const pnpm = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).packageManager || 'pnpm@10';
    run('npx', ['--yes', pnpm, 'install', '--frozen-lockfile'], dir);
  }
  run(process.execPath, ['scripts/build.mjs'], dir, { BASE: PROXY_BASE, OUT_DIR: OUT, SCRAMJET_ENGINE: '' });
  // The build empties proxy-dist/; keep its .assetsignore (see below).
  fs.writeFileSync(path.join(OUT, '.assetsignore'), ASSETS_IGNORE);
  const files = execFileSync('find', [OUT, '-type', 'f'], { encoding: 'utf8' }).trim().split('\n').length;
  console.log(`Proxy built into proxy-dist${PROXY_BASE}/ (${files} files) from ${git(dir, 'rev-parse', '--short', 'HEAD')}.`);
} else {
  console.error('Usage: node scripts/proxy-frontend.mjs build [--from <dir> [--any]] | sync --from <dir>');
  process.exit(1);
}
