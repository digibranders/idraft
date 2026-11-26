import { GSC_WINDOW, gscClicksOf, gscState, keywordsOf } from './internal-links-changes-world';
import { crawledPage, crawledPages, pageRow, type FixturePage, type RunView } from './internal-links-world';
import { textLength } from '@/lib/text/length';
import type { PageRow } from '@/lib/internal-links/types';
import type {
  ApiTab,
  CheckId,
  FoundBy,
  IssueCheck,
  IssueDetail,
  IssueGsc,
  IssueSummary,
  NotRunReason,
  Severity,
} from '@/lib/issues/types';

/**
 * The rules of the Issues checks for the mock crawl (spec section 4): one predicate and one detail per check, in
 * one place, so the list of checks and the pages of a check count the same pages. The backend writes each rule
 * as one SQL condition on the crawl's pages; here the rows are the 18 pages of `internal-links-world.ts`.
 */

const TITLE_MAX = 60;
const TITLE_MIN = 30;
const PATH_MAX = 115;
const DEPTH_MAX = 3;

/** A page of the crawl as a rule reads it. */
export interface Subject {
  page: FixturePage;
  row: PageRow;
}

/** What a check needs besides the crawl's pages; without it the check does not run. */
type Need = 'sitemap' | 'links' | 'gsc' | 'ranks' | 'ai';

interface Rule {
  id: CheckId;
  tab: ApiTab;
  category: string;
  severity: Severity;
  foundBy: FoundBy;
  need: Need | null;
  matches: (subject: Subject, all: readonly Subject[]) => boolean;
  detail?: (subject: Subject, all: readonly Subject[]) => Partial<IssueDetail>;
}

const subjects = (): Subject[] => crawledPages().map((page) => ({ page, row: pageRow(page, 'all') }));

const statusOf = (subject: Subject): number => subject.row.status_code ?? 0;
const isLive = (subject: Subject): boolean => statusOf(subject) === 200 && subject.row.resource_type === 'html';
const isRedirected = (subject: Subject): boolean => statusOf(subject) >= 300 && statusOf(subject) < 400;
const isBroken = (subject: Subject): boolean => {
  const status = statusOf(subject);
  return status >= 400 && status !== 401 && status !== 403 && status !== 429;
};
const isUnreachable = (subject: Subject): boolean => isRedirected(subject) || isBroken(subject);
const pathOf = (subject: Subject): string => subject.row.path;
const titleOf = (subject: Subject): string => (subject.row.title ?? '').trim();

/** The page a redirect leads to; none when the crawl did not fetch it. */
const redirectTarget = (subject: Subject, all: readonly Subject[]): Subject | undefined =>
  all.find((candidate) => candidate.page.id === subject.page.redirectTo);

const targetDetail = (subject: Subject, all: readonly Subject[]): Partial<IssueDetail> => {
  const target = redirectTarget(subject, all);
  return target === undefined ? {} : { target_path: pathOf(target), target_status: statusOf(target) };
};

/** The reason codes of the API (`non_indexable_reason`); the fixtures spell theirs as text. */
const reasonCode = (subject: Subject): string =>
  subject.row.non_indexable_reason === 'noindex meta tag' ? 'meta_tag' : 'other';

const titleKey = (subject: Subject): string => titleOf(subject).toLowerCase();
const sharesTitle = (subject: Subject, all: readonly Subject[]): Subject[] =>
  titleKey(subject) === ''
    ? []
    : all.filter(
        (other) =>
          other !== subject && isLive(other) && other.row.is_indexable && titleKey(other) === titleKey(subject),
      );

const withoutEscapes = (path: string): string => path.replace(/%[0-9a-f]{2}/gi, '');
const hasCapitals = (subject: Subject): boolean => /[A-Z]/.test(withoutEscapes(pathOf(subject)));
const hasUnderscores = (subject: Subject): boolean => pathOf(subject).includes('_');

const rankedKeywords = (subject: Subject): number =>
  keywordsOf(subject.page).filter((keyword) => keyword.rank !== null).length;

/**
 * Keywords that have a page as their target and rank with another one, by path. The fixtures hold no keyword
 * targets, so this is the one fact the Issues mock adds to them.
 */
const OFF_TARGET_KEYWORDS: Readonly<Record<string, number>> = { '/services/vapt': 1 };

const clicksOf = (subject: Subject): number => gscClicksOf(subject.page);

/** The 29 checks in catalogue order (backend `api/issues/catalogue.py`). */
const RULES: readonly Rule[] = [
  {
    id: 'status-4xx',
    tab: 'technical',
    category: 'status',
    severity: 'error',
    foundBy: 'crawl',
    need: null,
    matches: (subject) => isBroken(subject) && statusOf(subject) < 500,
    detail: (subject) => ({ count: subject.row.linking_pages_all }),
  },
  {
    id: 'status-5xx',
    tab: 'technical',
    category: 'status',
    severity: 'error',
    foundBy: 'crawl',
    need: null,
    matches: (subject) => isBroken(subject) && statusOf(subject) >= 500,
  },
  {
    id: 'clicks-page-broken',
    tab: 'technical',
    category: 'earning_pages',
    severity: 'error',
    foundBy: 'gsc',
    need: 'gsc',
    matches: (subject) => isUnreachable(subject) && clicksOf(subject) > 0,
  },
  {
    id: 'rank-page-broken',
    tab: 'technical',
    category: 'earning_pages',
    severity: 'error',
    foundBy: 'ranks',
    need: 'ranks',
    matches: (subject) => isUnreachable(subject) && rankedKeywords(subject) > 0,
    detail: (subject) => ({ count: rankedKeywords(subject) }),
  },
  {
    id: 'cited-page-broken',
    tab: 'technical',
    category: 'earning_pages',
    severity: 'error',
    foundBy: 'ai',
    need: 'ai',
    matches: () => false,
  },
  {
    id: 'clicks-page-orphan',
    tab: 'technical',
    category: 'earning_pages',
    severity: 'warning',
    foundBy: 'gsc',
    need: 'gsc',
    matches: (subject) => isLive(subject) && subject.row.flags.includes('orphan') && clicksOf(subject) > 0,
  },
  {
    id: 'redirect-broken',
    tab: 'technical',
    category: 'redirects',
    severity: 'error',
    foundBy: 'crawl',
    need: null,
    matches: (subject, all) => {
      const target = redirectTarget(subject, all);
      return isRedirected(subject) && target !== undefined && isBroken(target);
    },
    detail: targetDetail,
  },
  {
    id: 'redirect-chain',
    tab: 'technical',
    category: 'redirects',
    severity: 'warning',
    foundBy: 'crawl',
    need: null,
    matches: (subject, all) => {
      const target = redirectTarget(subject, all);
      return isRedirected(subject) && target !== undefined && isRedirected(target);
    },
    detail: targetDetail,
  },
  {
    id: 'links-to-redirect',
    tab: 'technical',
    category: 'redirects',
    severity: 'warning',
    foundBy: 'crawl',
    need: null,
    matches: (subject) => isLive(subject) && subject.row.redirect_outlinks > 0,
    detail: (subject) => ({ count: subject.row.redirect_outlinks }),
  },
  {
    id: 'redirect-pages',
    tab: 'technical',
    category: 'redirects',
    severity: 'notice',
    foundBy: 'crawl',
    need: null,
    matches: isRedirected,
    detail: targetDetail,
  },
  // The mock crawl keeps no canonical address, so the two canonical checks ran and found nothing
  {
    id: 'canonical-broken',
    tab: 'technical',
    category: 'indexing',
    severity: 'error',
    foundBy: 'crawl',
    need: null,
    matches: () => false,
  },
  {
    id: 'noindex',
    tab: 'technical',
    category: 'indexing',
    severity: 'warning',
    foundBy: 'crawl',
    need: null,
    matches: (subject) => isLive(subject) && reasonCode(subject) === 'meta_tag',
    detail: (subject) => ({ reason: reasonCode(subject) }),
  },
  {
    id: 'canonical-elsewhere',
    tab: 'technical',
    category: 'indexing',
    severity: 'notice',
    foundBy: 'crawl',
    need: null,
    matches: () => false,
  },
  {
    id: 'sitemap-broken',
    tab: 'technical',
    category: 'sitemap',
    severity: 'error',
    foundBy: 'crawl',
    need: 'sitemap',
    matches: (subject) => isUnreachable(subject) && subject.row.in_sitemap,
  },
  {
    id: 'sitemap-nonindexable',
    tab: 'technical',
    category: 'sitemap',
    severity: 'warning',
    foundBy: 'crawl',
    need: 'sitemap',
    matches: (subject) => isLive(subject) && subject.row.in_sitemap && !subject.row.is_indexable,
    detail: (subject) => ({ reason: reasonCode(subject) }),
  },
  {
    id: 'not-in-sitemap',
    tab: 'technical',
    category: 'sitemap',
    severity: 'notice',
    foundBy: 'crawl',
    need: 'sitemap',
    matches: (subject) => isLive(subject) && subject.row.is_indexable && !subject.row.in_sitemap,
  },
  {
    id: 'broken-internal-links',
    tab: 'technical',
    category: 'links',
    severity: 'error',
    foundBy: 'crawl',
    need: null,
    matches: (subject) => isLive(subject) && subject.row.broken_outlinks > 0,
    detail: (subject) => ({ count: subject.row.broken_outlinks }),
  },
  {
    id: 'orphans',
    tab: 'technical',
    category: 'links',
    severity: 'warning',
    foundBy: 'crawl',
    need: null,
    matches: (subject) => isLive(subject) && subject.row.flags.includes('orphan'),
  },
  {
    id: 'editorial-orphans',
    tab: 'technical',
    category: 'links',
    severity: 'warning',
    foundBy: 'crawl',
    need: null,
    matches: (subject) => isLive(subject) && subject.row.flags.includes('editorial_orphan'),
    detail: (subject) => ({ count: subject.row.linking_pages_all }),
  },
  {
    id: 'links-to-nonindexable',
    tab: 'technical',
    category: 'links',
    severity: 'warning',
    foundBy: 'crawl',
    need: null,
    matches: (subject) => isLive(subject) && subject.row.non_indexable_outlinks > 0,
    detail: (subject) => ({ count: subject.row.non_indexable_outlinks }),
  },
  {
    id: 'deep-pages',
    tab: 'technical',
    category: 'links',
    severity: 'notice',
    foundBy: 'crawl',
    need: null,
    matches: (subject) => isLive(subject) && (subject.row.click_depth ?? 0) > DEPTH_MAX,
    detail: (subject) => ({ count: subject.row.click_depth ?? 0 }),
  },
  // The mock keeps no nofollow links, so the check runs while the crawl holds its links and finds nothing
  {
    id: 'nofollow-internal',
    tab: 'technical',
    category: 'links',
    severity: 'notice',
    foundBy: 'crawl',
    need: 'links',
    matches: () => false,
  },
  {
    id: 'title-missing',
    tab: 'on_page',
    category: 'titles',
    severity: 'error',
    foundBy: 'crawl',
    need: null,
    matches: (subject) => isLive(subject) && titleOf(subject) === '',
  },
  {
    id: 'title-duplicate',
    tab: 'on_page',
    category: 'titles',
    severity: 'warning',
    foundBy: 'crawl',
    need: null,
    matches: (subject, all) => isLive(subject) && subject.row.is_indexable && sharesTitle(subject, all).length > 0,
    detail: (subject, all) => {
      const others = sharesTitle(subject, all)
        .map(pathOf)
        .sort((first, second) => (first < second ? -1 : 1));
      return { target_path: others[0] ?? null, count: others.length };
    },
  },
  {
    id: 'title-long',
    tab: 'on_page',
    category: 'titles',
    severity: 'notice',
    foundBy: 'crawl',
    need: null,
    matches: (subject) => isLive(subject) && textLength(titleOf(subject)) > TITLE_MAX,
    detail: (subject) => ({ count: textLength(titleOf(subject)) }),
  },
  {
    id: 'title-short',
    tab: 'on_page',
    category: 'titles',
    severity: 'notice',
    foundBy: 'crawl',
    need: null,
    matches: (subject) => isLive(subject) && titleOf(subject) !== '' && textLength(titleOf(subject)) < TITLE_MIN,
    detail: (subject) => ({ count: textLength(titleOf(subject)) }),
  },
  {
    id: 'url-format',
    tab: 'on_page',
    category: 'addresses',
    severity: 'notice',
    foundBy: 'crawl',
    need: null,
    matches: (subject) => isLive(subject) && (hasCapitals(subject) || hasUnderscores(subject)),
    detail: (subject) => ({
      reason:
        hasCapitals(subject) && hasUnderscores(subject) ? 'both' : hasCapitals(subject) ? 'capitals' : 'underscores',
    }),
  },
  {
    id: 'url-long',
    tab: 'on_page',
    category: 'addresses',
    severity: 'notice',
    foundBy: 'crawl',
    need: null,
    matches: (subject) => isLive(subject) && textLength(pathOf(subject)) > PATH_MAX,
    detail: (subject) => ({ count: textLength(pathOf(subject)) }),
  },
  {
    id: 'off-target',
    tab: 'on_page',
    category: 'keywords',
    severity: 'warning',
    foundBy: 'ranks',
    need: 'ranks',
    matches: (subject) => (OFF_TARGET_KEYWORDS[pathOf(subject)] ?? 0) > 0,
    detail: (subject) => ({ count: OFF_TARGET_KEYWORDS[pathOf(subject)] ?? 0 }),
  },
];

const RULE_OF: ReadonlyMap<CheckId, Rule> = new Map(RULES.map((rule) => [rule.id, rule]));
const NO_DETAIL: IssueDetail = { target_path: null, target_status: null, count: null, reason: null };

/** Whether a check runs on the crawl in view, and if not, why. */
function availability(need: Need | null, view: RunView): { ran: true } | { ran: false; reason: NotRunReason } {
  if (need === 'sitemap' && (view.run.sitemap_pages ?? 0) === 0) return { ran: false, reason: 'no_sitemap' };
  if (need === 'links' && !view.run.links_available) return { ran: false, reason: 'links_dropped' };
  // The cited answers are the one source the mock has not collected
  if (need === 'ai') return { ran: false, reason: 'not_collected' };
  if (need === 'gsc' && gscState() === 'not_connected') return { ran: false, reason: 'source_not_connected' };
  if (need === 'gsc' && gscState() === 'pending') return { ran: false, reason: 'not_collected' };
  return { ran: true };
}

/** The pages a check found on the crawl in view; none when it did not run. */
function foundBy(rule: Rule, view: RunView, all: readonly Subject[]): Subject[] {
  return availability(rule.need, view).ran ? all.filter((subject) => rule.matches(subject, all)) : [];
}

/** First path in byte order (UTF-16 code units compare as the bytes of ASCII paths do). */
const firstPath = (found: readonly Subject[]): string | null =>
  found.map(pathOf).reduce<string | null>((first, path) => (first === null || path < first ? path : first), null);

export interface CheckResult {
  check: IssueCheck;
  found: readonly Subject[];
}

/** The 29 checks of the crawl in view, in catalogue order, with the pages each found. */
export function checkResults(view: RunView): CheckResult[] {
  const all = subjects();
  const clicksCount = gscState() === 'ok';
  return RULES.map((rule) => {
    const state = availability(rule.need, view);
    const found = foundBy(rule, view, all);
    return {
      found,
      check: {
        id: rule.id,
        tab: rule.tab,
        category: rule.category,
        severity: rule.severity,
        found_by: rule.foundBy,
        state: state.ran ? 'ran' : 'not_run',
        reason: state.ran ? null : state.reason,
        pages: state.ran ? found.length : null,
        clicks: state.ran && clicksCount ? found.reduce((sum, subject) => sum + clicksOf(subject), 0) : null,
        example_path: firstPath(found),
      },
    };
  });
}

/** The totals of the strip: a page counts once per severity, over the checks that ran. */
export function summaryOf(results: readonly CheckResult[]): IssueSummary {
  const ran = results.filter(({ check }) => check.state === 'ran');
  const pagesOf = (severity: Severity | null): number =>
    new Set(
      ran
        .filter(({ check }) => severity === null || check.severity === severity)
        .flatMap(({ found }) => found.map((subject) => subject.page.id)),
    ).size;
  return {
    pages_crawled: crawledPages().length,
    pages_with_issue: pagesOf(null),
    pages_with_error: pagesOf('error'),
    pages_with_warning: pagesOf('warning'),
    pages_with_notice: pagesOf('notice'),
    checks_ran: ran.length,
    checks_passed: ran.filter(({ check }) => check.pages === 0).length,
  };
}

/** Search Console as the meta of the list reports it. */
export function gscMeta(): IssueGsc {
  const state = gscState();
  return {
    state,
    window_start: state === 'ok' ? GSC_WINDOW.start : null,
    window_end: state === 'ok' ? GSC_WINDOW.end : null,
  };
}

/** The ids of the pages a check found on the crawl in view (the `filter[issue]` of the pages list). */
export const issuePageIds = (check: CheckId, view: RunView): ReadonlySet<string> => {
  const rule = RULE_OF.get(check);
  return new Set(rule === undefined ? [] : foundBy(rule, view, subjects()).map((subject) => subject.page.id));
};

/** What a check found on one page (`extras.issue`): the four members, empty where the check has nothing to say. */
export function issueDetailOf(check: CheckId, pageId: string): IssueDetail {
  const rule = RULE_OF.get(check);
  const page = crawledPage(pageId);
  if (rule?.detail === undefined || page === undefined) return NO_DETAIL;
  const all = subjects();
  const subject = all.find((candidate) => candidate.page.id === page.id);
  return subject === undefined ? NO_DETAIL : { ...NO_DETAIL, ...rule.detail(subject, all) };
}
