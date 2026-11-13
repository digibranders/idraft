import { engineLabel, inCatalogOrder } from '../../engines/engine-role';
import type { Say } from '../../../numbers/number-model';
import type { EngineCode } from '@/lib/api/types';
import type { SourcesMeta } from '@/lib/citations/types';
import { formatDateRange, formatList } from '@/lib/format';

/**
 * The meta line and the footnote of the cards of the sources family, from the meta of a read (WP-37 plan D3). Pure:
 * the words come in through `say` (the `aiOverview.sources.common` messages). Engines are named in both, because the
 * API aggregates the engines in scope into one pool of citation units and a card must not hide that.
 */

/** The engines of a read, by name, in the order of the catalog, whatever order the read had them in. */
export function engineNames(codes: readonly EngineCode[]): string[] {
  return inCatalogOrder(codes).map((code) => engineLabel(code) ?? code);
}

type MetaFacts = Pick<SourcesMeta, 'window' | 'citation_units' | 'answers' | 'engine_codes' | 'include_branded'>;

/** "Oct 16 to Nov 12, 2026, 18,420 citation units in 6,210 answers, ChatGPT and Gemini, branded prompts left out". */
export function metaLine(meta: MetaFacts, say: Say): string {
  return say('meta', {
    window: formatDateRange(meta.window.from, meta.window.to),
    units: meta.citation_units,
    answers: meta.answers,
    engines: formatList(engineNames(meta.engine_codes)),
    branded: String(meta.include_branded),
  });
}

/** What the figures leave out and over what they are pooled, one sentence each. */
export function footnoteLines(meta: Pick<SourcesMeta, 'engine_codes'>, say: Say, minUnits: number): string[] {
  return [
    say('footnotePooled', { engines: formatList(engineNames(meta.engine_codes)) }),
    say('footnoteFlagged'),
    say('footnoteMinUnits', { min: minUnits }),
  ];
}
