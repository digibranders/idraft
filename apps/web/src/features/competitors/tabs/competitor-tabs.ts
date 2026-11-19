import { COMPETITOR_TAB_IDS, type CompetitorTab } from '../scope/scope-model';
import type { TabItem } from '@/components/ui/tabs';
import { formatInteger } from '@/lib/format';

/**
 * The tab list of the page, in order: Comparison, SEO, AI, Candidates. `candidatesCount` is `null` while the count is
 * unknown (it is, until WP-56 reads the candidates): the label then carries no number, since unknown is never 0.
 */
export function competitorTabItems(
  label: (id: CompetitorTab) => string,
  candidatesCount: number | null,
): TabItem<CompetitorTab>[] {
  return COMPETITOR_TAB_IDS.map((id) => ({
    value: id,
    label: label(id),
    ...(id === 'candidates' && candidatesCount !== null ? { count: formatInteger(candidatesCount) } : {}),
  }));
}
