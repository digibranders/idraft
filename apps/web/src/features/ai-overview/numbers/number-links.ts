import type { Route } from 'next';

import type { NumberReading } from '../data/number-sources';
import { drillHref, type DrillExtra, type DrillKind, type DrillProject } from '../drilldown/drill-links';
import type { OverviewScope } from '../scope/scope-model';
import type { EngineCode } from '@/lib/api/types';
import type { NumberItem } from '@/lib/layouts/types';

/**
 * Where a number of the strip leads (WP-33 plan T10): the Prompts page for the counts and the engine rates, the
 * Citations page for the citation share, and nowhere for the numbers that no destination has a column or a filter
 * for (mentioned and cited, fan-out presence), which stay plain text. Pure: `drillHref` writes the scope into the
 * link, this file only chooses the destination and says when there must be none.
 */

interface Destination {
  kind: DrillKind;
  /** The rate column the Prompts page shows for the number; `mention` is its default. */
  metric?: DrillExtra['metric'];
  /** Whether the destination is of the one engine the number names, or of the engines of the scope. */
  engine: boolean;
}

const DESTINATIONS: Readonly<Record<string, Destination>> = {
  'ai.prompts_in_scope': { kind: 'prompts', engine: false },
  'ai.valid_answers': { kind: 'prompts', engine: true },
  'ai.mention_rate': { kind: 'prompts', metric: 'mention', engine: true },
  'ai.citation_rate': { kind: 'prompts', metric: 'citation', engine: true },
  'ai.share_of_voice': { kind: 'prompts', metric: 'sov', engine: true },
  'ai.citation_share': { kind: 'citations', engine: true },
};

/**
 * The link of a number, or `null` when it is plain text: it was not read (off, outside the filter, not exposed,
 * unread, no source), no destination takes it, the scope holds an engine that is off in the project (the helper
 * cannot know that), or the destination cannot show the scope (branded prompts only, a window of more than 91
 * days, a country on Citations).
 */
export function numberHref(
  item: NumberItem,
  reading: NumberReading | null,
  scope: OverviewScope,
  project: DrillProject,
  enabledEngines: readonly EngineCode[],
): Route | null {
  if (reading?.status !== 'read') return null;
  const destination = DESTINATIONS[item.metric];
  if (destination === undefined) return null;
  const enabled: ReadonlySet<string> = new Set(enabledEngines);
  if (scope.engines?.some((engine) => !enabled.has(engine)) === true) return null;
  if (destination.engine && (item.engine === undefined || !enabled.has(item.engine))) return null;
  const extra: DrillExtra = destination.engine ? { engine: item.engine, metric: destination.metric } : {};
  return drillHref(destination.kind, scope, extra, project);
}
