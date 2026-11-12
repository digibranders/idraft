import { ScatterChart } from 'echarts/charts';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const echarts = vi.hoisted(() => ({ use: vi.fn<(modules: readonly unknown[]) => void>() }));
vi.mock('echarts/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('echarts/core')>()),
  use: echarts.use,
}));

const SRC_ROOT = path.join(import.meta.dirname, '../../..');
const THIS_DIRECTORY = import.meta.dirname;
const SCATTER_FILES = new Set(['echart-scatter.tsx', 'echart-scatter.test.ts']);
/** The only two ways other code may name the module: a dynamic import, or a test mocking that import. */
const ALLOWED_REFERENCE = /(?:\bimport\(|\bvi\.mock\()\s*['"][^'"]*echart-scatter['"]/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.tsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

/** Source files outside the scatter module and this test whose text names the scatter module any other way. */
function staticReferences(): string[] {
  return sourceFiles(SRC_ROOT)
    .filter((file) => !(path.dirname(file) === THIS_DIRECTORY && SCATTER_FILES.has(path.basename(file))))
    .filter((file) => readFileSync(file, 'utf8').replace(ALLOWED_REFERENCE, '').includes('echart-scatter'))
    .map((file) => path.relative(SRC_ROOT, file));
}

describe('echart-scatter', () => {
  it('registers ScatterChart', async () => {
    await import('./echart-scatter');
    const registered = echarts.use.mock.calls.flatMap(([modules]) => modules);
    expect(registered).toContain(ScatterChart);
  });

  it('exports the shared EChart under the scatter name', async () => {
    const [scatter, base] = await Promise.all([import('./echart-scatter'), import('./echart')]);
    expect(scatter.ScatterEChart).toBe(base.EChart);
  });

  it('the base wrapper stays scatter free', () => {
    const text = readFileSync(path.join(THIS_DIRECTORY, 'echart.tsx'), 'utf8');
    expect(text).not.toContain('ScatterChart');
    expect(text).not.toContain('echart-scatter');
  });

  it('nothing imports the scatter module statically', () => {
    expect(sourceFiles(SRC_ROOT).some((file) => path.basename(file) === 'echart-scatter.tsx')).toBe(true);
    expect(staticReferences()).toEqual([]);
  });
});
