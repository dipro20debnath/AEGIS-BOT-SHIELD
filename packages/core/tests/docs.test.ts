/**
 * Keeps the security whitepaper honest: the OWASP OATs it marks "Labelled"
 * must be exactly the OATs classifyThreats() can assign.
 */
import { readFileSync } from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../..');

describe('docs/security-whitepaper.md', () => {
  it('lists as "Labelled" exactly the OATs the engine assigns', () => {
    const engine = readFileSync(path.join(root, 'packages/core/src/engine/DetectionEngine.ts'), 'utf8');
    const fn = engine.slice(engine.indexOf('export function classifyThreats'));
    const assigned = new Set([...fn.slice(0, fn.indexOf('\n}\n')).matchAll(/OAT_(\d{3})/g)].map(m => m[1]));

    const doc = readFileSync(path.join(root, 'docs/security-whitepaper.md'), 'utf8');
    const rows = [...doc.matchAll(/^\| (\d{3}) \| [^|]+ \| ([^|]+) \|/gm)];
    expect(rows).toHaveLength(21);
    const labelled = new Set(rows.filter(r => r[2].includes('Labelled')).map(r => r[1]));

    expect([...labelled].sort()).toEqual([...assigned].sort());
  });
});

/** Every option of the public option types must be documented in docs/configuration.md. */
describe('docs/configuration.md', () => {
  const doc = readFileSync(path.join(root, 'docs/configuration.md'), 'utf8');
  const keysOf = (file: string, iface: string) => {
    const src = readFileSync(path.join(root, file), 'utf8');
    const start = src.indexOf(`export interface ${iface}`);
    const body = src.slice(src.indexOf('{', start) + 1, src.indexOf('\n}', start));
    // top-level members only (two-space indent)
    return [...body.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\??:/gm)].map(m => m[1]);
  };

  it.each([
    ['packages/server-node/src/AegisNode.ts', 'AegisNodeOptions'],
    ['packages/js-sdk/src/types.ts', 'AegisClientConfig'],
    ['packages/edge-cloudflare/src/worker.ts', 'Env'],
    ['packages/server-node/src/live.ts', 'LiveFeedOptions'],
  ])('%s %s', (file, iface) => {
    const keys = keysOf(file, iface);
    expect(keys.length).toBeGreaterThan(3);
    const missing = keys.filter(k => !doc.includes(`\`${k}\``));
    expect(missing).toEqual([]);
  });
});

/** Relative links and #anchors in the README and docs/ must resolve (GitHub heading slugs). */
describe('documentation links', () => {
  const slug = (heading: string) => heading.trim().toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
  const anchors = (file: string) => {
    const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
    return new Set([...text.matchAll(/^#{1,6} (.+)$/gm)].map(m => slug(m[1])));
  };
  const files = [path.join(root, 'README.md'),
    ...['getting-started', 'configuration', 'INTEGRATION_GUIDE', 'API_REFERENCE', 'architecture', 'ML_MODEL_GUIDE', 'security-whitepaper']
      .map(f => path.join(root, 'docs', `${f}.md`))];

  it.each(files.map(f => [path.relative(root, f), f]))('%s', (_name, file) => {
    const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
    const broken: string[] = [];
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [rel, anchor] = target.split('#');
      const dest = rel ? path.resolve(path.dirname(file), rel) : file;
      let exists = true;
      try { readFileSync(dest); } catch (e) { exists = (e as NodeJS.ErrnoException).code === 'EISDIR'; }
      if (!exists) { broken.push(target); continue; }
      if (anchor && dest.endsWith('.md') && !anchors(dest).has(anchor)) broken.push(target);
    }
    expect(broken).toEqual([]);
  });
});
