// @vitest-environment node
/**
 * Oracle test: validate RepoRank's hand-rolled structural analyzers against
 * dependency-cruiser (a mature OSS implementation) on a controlled fixture.
 *
 * RepoRank does not use dependency-cruiser at runtime — its structural pass is
 * deliberately dependency-free and works on in-memory `sourceFiles` for the API
 * path (see analyzers/import-graph.ts). dependency-cruiser is used here as an
 * independent oracle: if the two disagree on a trivial, unambiguous cycle, the
 * custom resolver/SCC has a bug.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildModuleGraph } from '../analyzers/import-graph.js';
import { findImportCycles } from '../analyzers/structural.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reporank-oracle-'));
const srcDir = path.join(root, 'src');
fs.mkdirSync(srcDir, { recursive: true });
fs.writeFileSync(path.join(srcDir, 'a.ts'), 'import { b } from "./b";\nexport const a = b;\n');
fs.writeFileSync(path.join(srcDir, 'b.ts'), 'import { a } from "./a";\nexport const b = a;\n');
fs.writeFileSync(path.join(srcDir, 'clean.ts'), 'import { b } from "./b";\nexport const c = b;\n');

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function sourceFiles() {
  return fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ path: `src/${f}`, content: fs.readFileSync(path.join(srcDir, f), 'utf8') }));
}

function customCycles() {
  return findImportCycles(buildModuleGraph(sourceFiles()));
}

describe('structural analyzer vs dependency-cruiser oracle', () => {
  it('custom SCC finds the a<->b cycle and excludes the clean importer', () => {
    const cycles = customCycles();
    expect(cycles).toHaveLength(1);
    const modules = cycles[0]!.modules.join(',');
    expect(modules).toContain('src/a.ts');
    expect(modules).toContain('src/b.ts');
    expect(modules).not.toContain('src/clean.ts');
  });

  it('agrees with dependency-cruiser on which modules are circular', async () => {
    const { cruise } = await import('dependency-cruiser');
    const result = (await cruise([root], { doNotFollow: { path: 'node_modules' } })) as unknown as {
      output: { modules: Array<{ source: string; dependencies: Array<{ circular?: boolean }> }> };
    };

    const circularSources = new Set<string>();
    for (const m of result.output.modules) {
      if (m.dependencies.some((d) => d.circular === true)) circularSources.add(m.source.replace(/\\/g, '/'));
    }

    // The oracle must see the cycle too (guards against the custom detector
    // being "right for the wrong reason" on this fixture).
    expect([...circularSources].some((s) => s.endsWith('a.ts'))).toBe(true);
    expect([...circularSources].some((s) => s.endsWith('b.ts'))).toBe(true);
    expect([...circularSources].some((s) => s.endsWith('clean.ts'))).toBe(false);

    // And the custom analyzer must agree on the cyclic module set. Compare
    // basenames: dependency-cruiser reports paths relative to its cwd, the
    // custom analyzer relative to the graph root.
    const base = (p: string) => p.replace(/\\/g, '/').split('/').pop();
    const oracleBasenames = [...circularSources].map(base).sort();
    const customBasenames = [...new Set(customCycles().flatMap((c) => c.modules))].map(base).sort();
    expect(oracleBasenames).toEqual(customBasenames);
    expect(oracleBasenames).toEqual(['a.ts', 'b.ts']);
  });
});
