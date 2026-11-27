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
  detail?: ((subject: Subject, all: readonly Subject[]) => Partial<IssueDetail>) | undefined;
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

/** What a page's HTML says and how fast it answered (`crawl_pages` columns of the HTML checks). */
interface PageFacts {
  description: string;
  h1: number;
  words: number;
  /** The hash of the text: pages with the same one have the same text. */
  text: string;
  imagesWithoutAlt: number;
  openGraph: boolean;
  jsonldErrors: number;
  hreflangErrors: number;
  httpResources: number;
  responseMs: number;
}

const THIN_WORDS = 200;
const DUPLICATE_MIN_WORDS = 50;
const SLOW_MS = 3000;

const DEFAULT_FACTS: PageFacts = {
  description: '',
  h1: 1,
  words: 640,
  text: '',
  imagesWithoutAlt: 0,
  openGraph: true,
  jsonldErrors: 0,
  hreflangErrors: 0,
  httpResources: 0,
  responseMs: 420,
};

/** The facts of the mock crawl's pages by path; a page not listed has a description of its own and nothing wrong. */
const FACTS: Readonly<Record<string, Partial<PageFacts>>> = {
  '/services': { description: '', imagesWithoutAlt: 1, hreflangErrors: 2 },
  '/services/soc-as-a-service': {
    description: 'Round-the-clock monitoring by our analysts.',
    responseMs: 3600,
  },
  '/services/managed-detection-and-response': { description: 'Round-the-clock monitoring by our analysts.' },
  '/pricing': { h1: 2, jsonldErrors: 1 },
  '/blog': { h1: 0, words: 90 },
  '/blog/what-is-a-soc': { imagesWithoutAlt: 2 },
  '/blog/vapt-checklist': { text: 'checklist', responseMs: 4200 },
  '/blog/threat-report-2022': { text: 'checklist', openGraph: false },
  '/about': { imagesWithoutAlt: 3, httpResources: 2 },
  '/partners': { description: '', h1: 0, words: 40, openGraph: false },
  '/compare/eventus-vs-in-house-soc': { openGraph: false },
};

const factsOf = (subject: Subject): PageFacts => ({
  ...DEFAULT_FACTS,
  description: `${titleOf(subject)}, in a few words.`,
  text: pathOf(subject),
  ...FACTS[pathOf(subject)],
});

const descriptionKey = (subject: Subject): string => factsOf(subject).description.trim().toLowerCase();

/** Other live, indexable pages that share a value (a description or a text) with a page, by path. */
const sharing = (
  subject: Subject,
  all: readonly Subject[],
  keyOf: (page: Subject) => string,
  counts: (page: Subject) => boolean,
): string[] =>
  keyOf(subject) === ''
    ? []
    : all
        .filter(
          (other) =>
            other !== subject &&
            isLive(other) &&
            other.row.is_indexable &&
            counts(other) &&
            keyOf(other) === keyOf(subject),
        )
        .map(pathOf)
        .sort((first, second) => (first < second ? -1 : 1));

const duplicateDetail = (others: readonly string[]): Partial<IssueDetail> => ({
  target_path: others[0] ?? null,
  count: others.length,
});

const sameDescription = (subject: Subject, all: readonly Subject[]): string[] =>
  sharing(subject, all, descriptionKey, () => true);
const sameText = (subject: Subject, all: readonly Subject[]): string[] =>
  sharing(
    subject,
    all,
    (page) => factsOf(page).text,
    (page) => factsOf(page).words >= DUPLICATE_MIN_WORDS,
  );

/** A check of the HTML of live pages, which the mock crawl read for every page. */
const htmlRule = (
  id: CheckId,
  tab: ApiTab,
  category: string,
  severity: Severity,
  matches: Rule['matches'],
  detail?: Rule['detail'],
): Rule => ({ id, tab, category, severity, foundBy: 'crawl', need: null, matches, detail });

/** The 41 checks in catalogue order (backend `api/issues/catalogue.py`). */
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
  htmlRule(
    'mixed-content',
    'technical',
    'security',
    'warning',
    (subject) => isLive(subject) && factsOf(subject).httpResources > 0,
    (subject) => ({ count: factsOf(subject).httpResources }),
  ),
  htmlRule(
    'hreflang',
    'technical',
    'languages',
    'warning',
    (subject) => isLive(subject) && factsOf(subject).hreflangErrors > 0,
    (subject) => ({ count: factsOf(subject).hreflangErrors }),
  ),
  htmlRule(
    'slow-pages',
    'technical',
    'speed',
    'warning',
    (subject) => isLive(subject) && factsOf(subject).responseMs > SLOW_MS,
    (subject) => ({ count: factsOf(subject).responseMs }),
  ),
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
  htmlRule(
    'description-missing',
    'on_page',
    'descriptions',
    'warning',
    (subject) => isLive(subject) && descriptionKey(subject) === '',
  ),
  htmlRule(
    'description-duplicate',
    'on_page',
    'descriptions',
    'notice',
    (subject, all) => isLive(subject) && subject.row.is_indexable && sameDescription(subject, all).length > 0,
    (subject, all) => duplicateDetail(sameDescription(subject, all)),
  ),
  htmlRule('h1-missing', 'on_page', 'headings', 'warning', (subject) => isLive(subject) && factsOf(subject).h1 === 0),
  htmlRule(
    'h1-multiple',
    'on_page',
    'headings',
    'notice',
    (subject) => isLive(subject) && factsOf(subject).h1 > 1,
    (subject) => ({ count: factsOf(subject).h1 }),
  ),
  htmlRule(
    'thin-content',
    'on_page',
    'content',
    'warning',
    (subject) => isLive(subject) && factsOf(subject).words < THIN_WORDS,
    (subject) => ({ count: factsOf(subject).words }),
  ),
  htmlRule(
    'duplicate-content',
    'on_page',
    'content',
    'warning',
    (subject, all) =>
      isLive(subject) &&
      subject.row.is_indexable &&
      factsOf(subject).words >= DUPLICATE_MIN_WORDS &&
      sameText(subject, all).length > 0,
    (subject, all) => duplicateDetail(sameText(subject, all)),
  ),
  htmlRule(
    'image-alt',
    'on_page',
    'images',
    'notice',
    (subject) => isLive(subject) && factsOf(subject).imagesWithoutAlt > 0,
    (subject) => ({ count: factsOf(subject).imagesWithoutAlt }),
  ),
  htmlRule(
    'schema-errors',
    'on_page',
    'structured_data',
    'warning',
    (subject) => isLive(subject) && factsOf(subject).jsonldErrors > 0,
    (subject) => ({ count: factsOf(subject).jsonldErrors }),
  ),
  htmlRule(
    'social-tags',
    'on_page',
    'social_tags',
    'notice',
    (subject) => isLive(subject) && !factsOf(subject).openGraph,
  ),
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

/** The 41 checks of the crawl in view, in catalogue order, with the pages each found. */
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
