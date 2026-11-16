import type { FactsRow, TrackedEntity } from '@/features/prompts/facts';
import { cellOf, engine, entityCells, rowOf } from '@/lib/prompt-facts/test-helpers';

/** What the tests of the list columns share: a project with its own brand and one competitor, and the answers of one prompt. */
export const PROJECT = { workspaceId: 'workspace-1', projectId: 'project-1' } as const;

export const TRACKED: readonly TrackedEntity[] = [
  { entity_id: 'own', name: 'Northwind', role: 'own' },
  { entity_id: 'rival', name: 'HubSpot', role: 'competitor' },
];

export const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  chatgpt_web: 'ChatGPT',
  gemini_web: 'Gemini',
};
export const platformName = (code: string): string => PLATFORM_NAMES[code] ?? code;

/** A row with 12 valid answers on ChatGPT: the own brand in 6, HubSpot in 4, and Copper (not tracked) in 2. */
export const chatgptRow = (over: Parameters<typeof engine>[1] = {}): FactsRow =>
  rowOf(
    engine('chatgpt_web', {
      valid: 12,
      entities: [entityCells('own', cellOf(6, 12)), entityCells('rival', cellOf(4, 12))],
      other_brands: [{ name: 'Copper', mentioned: cellOf(2, 12) }],
      ...over,
    }),
  );
