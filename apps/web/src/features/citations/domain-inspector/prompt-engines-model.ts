import { byEngineOrder } from '@/components/app/engine/order';
import type { CitationRow, DomainPrompt, EngineCode } from '@/lib/citations/types';

/**
 * The prompts of the domain inspector's Prompts tab (WB-DOM-08). The detail read counts a prompt's units and
 * answers but names no engine, so the engines come from the citation rows of the same domain. Pure.
 */

/**
 * The engines each prompt was cited on, once each and in the fixed engine order. A prompt that none of the rows
 * is for has no entry: its engines are not known, which is not the same as none.
 */
export function enginesByPrompt(
  rows: readonly Pick<CitationRow, 'prompt_id' | 'engine_code'>[],
): ReadonlyMap<string, readonly EngineCode[]> {
  const found = new Map<string, Set<EngineCode>>();
  for (const row of rows) {
    const engines = found.get(row.prompt_id) ?? new Set<EngineCode>();
    engines.add(row.engine_code);
    found.set(row.prompt_id, engines);
  }
  return new Map([...found].map(([id, engines]) => [id, byEngineOrder([...engines], (code) => code)]));
}

/** At most `limit` prompts, the most units first; a tie goes to the more answers, then to the lower id. */
export function topPrompts(prompts: readonly DomainPrompt[], limit: number): DomainPrompt[] {
  return [...prompts]
    .sort(
      (a, b) =>
        b.citation_units - a.citation_units ||
        b.observations - a.observations ||
        a.prompt_id.localeCompare(b.prompt_id),
    )
    .slice(0, limit);
}
