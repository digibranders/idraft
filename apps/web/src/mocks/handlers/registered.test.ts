import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

type ModuleLoader = () => Promise<Record<string, unknown>>;

/**
 * One slot per planned package module, as section 4 of the WP-02 plan lists them: the file slug, the export
 * name and a loader for the module. Each package fills its own module; this test pins that every slot exists
 * and is wired into `index.ts`.
 */
const SLOTS: ReadonlyArray<readonly [slug: string, name: string, load: ModuleLoader]> = [
  ['compare', 'compareHandlers', () => import('./compare')],
  ['fanout', 'fanoutHandlers', () => import('./fanout')],
  ['prompt-limits', 'promptLimitHandlers', () => import('./prompt-limits')],
  ['prompt-edits', 'promptEditHandlers', () => import('./prompt-edits')],
  ['retention', 'retentionHandlers', () => import('./retention')],
  ['notes', 'noteHandlers', () => import('./notes')],
  ['competitors', 'competitorHandlers', () => import('./competitors')],
  ['prompt-versions', 'promptVersionHandlers', () => import('./prompt-versions')],
  ['panels', 'panelHandlers', () => import('./panels')],
  ['prompt-links', 'promptLinkHandlers', () => import('./prompt-links')],
  ['candidates', 'candidateHandlers', () => import('./candidates')],
  ['alerts', 'alertHandlers', () => import('./alerts')],
  ['saved-views', 'savedViewHandlers', () => import('./saved-views')],
  ['exports', 'exportHandlers', () => import('./exports')],
  ['reports', 'reportHandlers', () => import('./reports')],
  ['prompt-timeline', 'promptTimelineHandlers', () => import('./prompt-timeline')],
  ['rederive', 'rederiveHandlers', () => import('./rederive')],
  ['retrieval', 'retrievalHandlers', () => import('./retrieval')],
  ['prompt-stats', 'promptStatHandlers', () => import('./prompt-stats')],
  ['sources', 'sourceHandlers', () => import('./sources')],
  ['cross-channel', 'crossChannelHandlers', () => import('./cross-channel')],
  ['llm-diagnostics', 'llmDiagnosticHandlers', () => import('./llm-diagnostics')],
  ['first-party', 'firstPartyHandlers', () => import('./first-party')],
  ['geo-readiness', 'geoReadinessHandlers', () => import('./geo-readiness')],
  ['prompt-import', 'promptImportHandlers', () => import('./prompt-import')],
  ['project-overview-ai', 'projectOverviewAiHandlers', () => import('./project-overview-ai')],
  ['command-palette', 'commandPaletteHandlers', () => import('./command-palette')],
  ['recommendations', 'recommendationHandlers', () => import('./recommendations')],
];

const INDEX_SOURCE = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const INDEX_LINES = INDEX_SOURCE.split('\n').map((line) => line.trim());

const countLine = (line: string): number => INDEX_LINES.filter((candidate) => candidate === line).length;

describe('registered package mock modules', () => {
  it.each(SLOTS)('%s.ts exports an empty HttpHandler array as %s', async (_slug, name, load) => {
    const mod = await load();
    expect(mod[name]).toEqual([]);
  });

  it.each(SLOTS)('index.ts imports %s once', (slug, name) => {
    expect(countLine(`import { ${name} } from './${slug}';`)).toBe(1);
  });

  it.each(SLOTS)('index.ts spreads %s once', (_slug, name) => {
    expect(countLine(`...${name},`)).toBe(1);
  });

  it('spreads the package modules after integrationHandlers and before pendingHandlers', () => {
    const start = INDEX_SOURCE.indexOf('...integrationHandlers,');
    const end = INDEX_SOURCE.indexOf('...pendingHandlers,');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = INDEX_SOURCE.slice(start, end);
    for (const [, name] of SLOTS) {
      expect(block).toContain(`...${name},`);
    }
  });
});
