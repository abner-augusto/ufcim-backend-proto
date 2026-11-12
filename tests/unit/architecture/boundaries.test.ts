import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

/**
 * Boundaries stated in docs/ARCHITECTURE.md, checked on the import graph of src/:
 * routes call services (never the reverse), and the production entry point keeps
 * the dev surface (dev auth, /dev/* routes, test keys) out of its bundle.
 */

const SRC = resolve(__dirname, '../../../src');
const IMPORT = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g;
const DEV_SURFACE = /^(index\.dev\.ts|middleware\/auth-dev\.ts|routes\/dev\.ts|dev\/)/;

function sourceFiles(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .map((name) => name.replaceAll('\\', '/'))
    .filter((name) => name.endsWith('.ts'));
}

function resolveImport(importer: string, specifier: string): string | undefined {
  const local = specifier.startsWith('@/') || specifier.startsWith('.');
  if (!local) return undefined;
  const base = specifier.startsWith('@/')
    ? resolve(SRC, specifier.slice(2))
    : resolve(SRC, dirname(importer), specifier);
  const file = [`${base}.ts`, resolve(base, 'index.ts'), base].find((candidate) => existsSync(candidate));
  if (!file) throw new Error(`${importer} imports ${specifier}, which resolves to no file under src/`);
  return relative(SRC, file).replaceAll('\\', '/');
}

function importsOf(file: string): string[] {
  const source = readFileSync(resolve(SRC, file), 'utf8');
  return [...source.matchAll(IMPORT)]
    .map((match) => resolveImport(file, match[1]))
    .filter((target): target is string => target !== undefined);
}

function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...importsOf(file));
  }
  return seen;
}

describe('architecture boundaries', () => {
  it('services never import routes', () => {
    const offenders = sourceFiles()
      .filter((file) => file.startsWith('services/'))
      .flatMap((file) => importsOf(file).filter((target) => target.startsWith('routes/')).map((target) => `${file} -> ${target}`));

    expect(offenders).toEqual([]);
  });

  it('the production entry point reaches no dev-only module', () => {
    const reached = reachableFrom('index.ts');

    expect(reached.size).toBeGreaterThan(50);
    expect([...reached].filter((file) => DEV_SURFACE.test(file))).toEqual([]);
  });

  it('the dev entry point is what wires the dev surface in', () => {
    const reached = [...reachableFrom('index.dev.ts')];

    expect(reached).toContain('middleware/auth-dev.ts');
    expect(reached).toContain('routes/dev.ts');
  });
});
