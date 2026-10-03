#!/usr/bin/env node
/**
 * Pre-publish checks (publishes nothing): npm run release:check
 *
 * npm: `npm pack --dry-run` for each public package; every tarball must have
 * README.md, LICENSE, package.json and its built entry points, and no tests
 * or sources. All versions (npm, PyPI, __version__, OpenAPI) must agree.
 * PyPI: build sdist + wheel of each Python package and run `twine check`
 * (needs `pip install build twine`; skipped with a message otherwise).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NPM = ['core', 'server-node', 'js-sdk'];
const PY = ['server-python', 'ml-engine'];
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
let failed = false;
const fail = (msg) => { failed = true; console.error(`  ✗ ${msg}`); };

console.log('npm packages');
const versions = new Set();
for (const pkg of NPM) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'packages', pkg, 'package.json'), 'utf8'));
  versions.add(manifest.version);
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '-w', manifest.name], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  const files = JSON.parse(out)[0].files.map(f => f.path);
  for (const required of ['README.md', 'LICENSE', 'package.json', manifest.main, manifest.types].filter(Boolean)) {
    if (!files.includes(required)) fail(`${manifest.name}: ${required} missing (run npm run build?)`);
  }
  const unwanted = files.filter(f => /(^|\/)(tests?|src)\//.test(f) || /\.test\.|tsbuildinfo$/.test(f));
  if (unwanted.length) fail(`${manifest.name}: unexpected files ${unwanted.slice(0, 5).join(', ')}`);
  for (const key of ['license', 'repository', 'description']) if (!manifest[key]) fail(`${manifest.name}: no "${key}"`);
  console.log(`  ${manifest.name}@${manifest.version}: ${files.length} files`);
}
const pyVersions = PY.map(pkg => /^version = "([^"]+)"/m.exec(readFileSync(path.join(root, 'packages', pkg, 'pyproject.toml'), 'utf8'))?.[1]);
const others = [
  ...pyVersions,
  /__version__ = "([^"]+)"/.exec(readFileSync(path.join(root, 'packages/server-python/aegis_shield/__init__.py'), 'utf8'))?.[1],
  JSON.parse(readFileSync(path.join(root, 'contracts/openapi.json'), 'utf8')).info.version,
];
for (const v of others) versions.add(v);
if (versions.size > 1) fail(`versions differ (package.json, pyproject.toml, __version__, openapi info.version): ${[...versions].join(', ')}`);

console.log('Python packages');
let hasTools = true;
try { execFileSync(python, ['-c', 'import build, twine'], { stdio: 'ignore' }); } catch { hasTools = false; }
if (!hasTools) {
  console.log(`  skipped: ${python} -m pip install build twine`);
} else {
  const out = mkdtempSync(path.join(tmpdir(), 'aegis-dist-'));
  try {
    for (const pkg of PY) {
      execFileSync(python, ['-m', 'build', path.join(root, 'packages', pkg), '--outdir', out], { stdio: 'ignore' });
    }
    const dists = readdirSync(out).map(f => path.join(out, f));
    execFileSync(python, ['-m', 'twine', 'check', '--strict', ...dists], { stdio: 'inherit' });
  } catch (e) {
    fail(`Python build or twine check failed: ${e.message}`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

if (failed) { console.error('\nrelease check FAILED'); process.exit(1); }
console.log('\nrelease check passed (nothing was published)');
