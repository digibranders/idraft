import type { IssueCheck, Severity } from './types';
import { tabOfApi, type IssuesState, type IssuesTab } from './url-state';

export const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { error: 0, warning: 1, notice: 2 };

export interface VisibleOptions {
  /** The translated name of a check, for the search. */
  nameOf: (check: IssueCheck) => string;
  /** The translated name of the category of a check, for the search. */
  categoryNameOf: (check: IssueCheck) => string;
}

/** Most pages first; a check that did not run (`pages` null) after every check that ran. */
const byPages = (first: IssueCheck, second: IssueCheck): number =>
  first.pages === null || second.pages === null
    ? Number(first.pages === null) - Number(second.pages === null)
    : second.pages - first.pages;

/**
 * The checks of one tab that pass the filters, a category kept together in catalogue order (the order of
 * `checks`); inside a category the most severe first, then the most pages, then the checks that did not run.
 * "Show passed checks" off hides the checks that ran and found no page; a check that did not run stays.
 */
export function visibleChecks(
  checks: readonly IssueCheck[],
  state: IssuesState,
  { nameOf, categoryNameOf }: VisibleOptions,
): IssueCheck[] {
  const needle = state.q.trim().toLowerCase();
  const rank = new Map<string, number>();
  for (const check of checks) if (!rank.has(check.category)) rank.set(check.category, rank.size);
  return checks
    .filter(
      (check) =>
        tabOfApi(check.tab) === state.tab &&
        (state.severity === 'all' || check.severity === state.severity) &&
        (state.by === 'all' || check.found_by === state.by) &&
        (state.showPassed || check.pages !== 0) &&
        (needle === '' || `${nameOf(check)} ${categoryNameOf(check)}`.toLowerCase().includes(needle)),
    )
    .sort(
      (first, second) =>
        (rank.get(first.category) ?? 0) - (rank.get(second.category) ?? 0) ||
        SEVERITY_ORDER[first.severity] - SEVERITY_ORDER[second.severity] ||
        byPages(first, second),
    );
}

/** The checks in runs of one category, in the order the categories first appear. */
export function groupByCategory(checks: readonly IssueCheck[]): { category: string; checks: IssueCheck[] }[] {
  const groups = new Map<string, IssueCheck[]>();
  for (const check of checks) groups.set(check.category, [...(groups.get(check.category) ?? []), check]);
  return [...groups].map(([category, grouped]) => ({ category, checks: grouped }));
}

/** Per tab, how many checks ran and found at least one page. */
export function tabCounts(checks: readonly IssueCheck[]): Record<IssuesTab, number> {
  const counts: Record<IssuesTab, number> = { technical: 0, 'on-page': 0 };
  for (const check of checks) if (check.state === 'ran' && (check.pages ?? 0) > 0) counts[tabOfApi(check.tab)] += 1;
  return counts;
}
