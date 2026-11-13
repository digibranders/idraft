import type { useTranslations } from 'next-intl';
import { createElement, type ReactNode } from 'react';

import type { CitationRead } from './citation-reads';
import type { CitationScope, CitationScopeState, CitationTab, DateWindow } from './citation-scope';
import type { ExportSource } from './citations-export';
import { DomainsTab } from './domains-tab';
import { NewLostTab } from './new-lost';
import { PagesTab } from './pages-tab';
import type { FilterField, FilterValues } from '@/components/app/filters/types';
import type { SourceFilters } from '@/lib/citations/source-queries';
import type { EngineCode, SourceDomainPage, SourceScope } from '@/lib/citations/types';

/**
 * The tabs of the Citations page (plan F16). Each tab is one entry: Domains, Pages and New and lost are one line
 * each.
 */

/** The translator of `citations`, as `useTranslations('citations')` and `createTranslator` give it. */
export type CitationTabTranslate = ReturnType<typeof useTranslations<'citations'>>;

/** What a tab is handed: the page's scope, the reads every tab shares, and the way to write the address. */
export interface CitationTabContext {
  /** The workspace and project the reads are under. */
  source: SourceScope;
  workspaceSlug: string;
  projectSlug: string;
  timeZone: string;
  scope: CitationScope;
  /** The filters every read of the page shares (the window, the engines, the roles, the topic, branded). */
  filters: SourceFilters;
  range: DateWindow;
  /** The engines that are on, in the order the project lists them. */
  enabledEngines: readonly EngineCode[];
  labelOf: (code: EngineCode) => string;
  /** The scope read (`meta` of the whole scope) and the period before it. */
  meta: CitationRead<SourceDomainPage>;
  previousMeta: CitationRead<SourceDomainPage>;
  setSearch: CitationScopeState['setSearch'];
  /**
   * Hands the page's Export button the rows the tab lists (`null` while they are not loaded). Absent where nothing
   * exports; a tab calls it through `useRegisterExport`.
   */
  registerExport?: ((source: ExportSource | null) => void) | undefined;
  /** The filter bar's fields and values, so a tab that finds nothing can name the filters and clear them. */
  filterBar: {
    fields: readonly FilterField[];
    values: FilterValues;
    onClear: () => void;
  };
}

export interface CitationTabEntry {
  id: CitationTab;
  label: (t: CitationTabTranslate) => string;
  render: (context: CitationTabContext) => ReactNode;
}

/** The place of each tab: a record, so a tab added to `CitationTab` must be given one to compile. */
const ORDER: Readonly<Record<CitationTab, number>> = { domains: 0, pages: 1, 'new-lost': 2 };

/** The entries in the page's order. A repeated id is a mistake of the code that lists them, so it throws. */
export function defineCitationTabs(entries: readonly CitationTabEntry[]): readonly CitationTabEntry[] {
  const seen = new Set<CitationTab>();
  for (const { id } of entries) {
    if (seen.has(id)) throw new Error(`The citation tab "${id}" is listed twice`);
    seen.add(id);
  }
  return [...entries].sort((a, b) => ORDER[a.id] - ORDER[b.id]);
}

/** Domains, Pages and New and lost. */
export const CITATION_TABS: readonly CitationTabEntry[] = defineCitationTabs([
  { id: 'domains', label: (t) => t('tabs.domains'), render: (context) => createElement(DomainsTab, { context }) },
  { id: 'pages', label: (t) => t('tabs.pages'), render: (context) => createElement(PagesTab, { context }) },
  { id: 'new-lost', label: (t) => t('newLost.tab'), render: (context) => createElement(NewLostTab, { context }) },
]);

/** The tab asked for, or Domains when it is not listed (a link to Pages before that tab exists). */
export function activeCitationTab(tabs: readonly CitationTabEntry[], wanted: CitationTab): CitationTabEntry | null {
  return tabs.find((tab) => tab.id === wanted) ?? tabs.find((tab) => tab.id === 'domains') ?? null;
}
