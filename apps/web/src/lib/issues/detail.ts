import type { CheckId, IssueDetail } from './types';

/** A message under `issues.found` and the values it needs. */
export interface DetailMessage {
  key: string;
  values: Record<string, string | number>;
}

interface DetailRow {
  /** The status code of the page. */
  status: number | null;
  /** `extras.issue` of the row; `null` when it was not asked for or the check has nothing to say. */
  issue: IssueDetail | null;
}

const say = (key: string, values: Record<string, string | number> = {}): DetailMessage => ({ key, values });

/** `noindex` and `sitemap-nonindexable` say why a page is left out of Google's index with the reason code of the API. */
function noindexMessage(reason: string | null | undefined): DetailMessage | null {
  if (reason === 'meta_tag') return say('noindexTag');
  if (reason === 'http_header') return say('noindexHeader');
  return null;
}

function notIndexableMessage(reason: string | null | undefined): DetailMessage {
  if (reason === 'canonical') return say('notIndexableCanonical');
  if (reason === 'meta_tag' || reason === 'http_header') return say('notIndexableNoindex');
  if (reason === 'robots_txt') return say('notIndexableRobots');
  return say('notIndexable');
}

function urlFormatMessage(reason: string | null | undefined): DetailMessage | null {
  if (reason === 'capitals') return say('capitals');
  if (reason === 'underscores') return say('underscores');
  if (reason === 'both') return say('capitalsAndUnderscores');
  return null;
}

function duplicateTitleMessage(issue: IssueDetail | null): DetailMessage | null {
  const target = issue?.target_path;
  const others = issue?.count;
  if (target === null || target === undefined || others === null || others === undefined || others < 1) return null;
  return others === 1 ? say('sameTitle', { target }) : say('sameTitleMore', { target, more: others - 1 });
}

/**
 * The sentence of "What was found" for one page of a check: the key under `issues.found` and its values, or
 * `null` when the check has nothing to say or a value its message needs is missing. The API sends values, never
 * sentences (spec 4, last column); the words are in `messages/en.json`.
 */
export function detailMessage(check: CheckId, { status, issue }: DetailRow): DetailMessage | null {
  const count = issue?.count ?? null;
  const target = issue?.target_path ?? null;
  const targetStatus = issue?.target_status ?? null;
  switch (check) {
    case 'status-4xx':
      return status === null || count === null ? null : say('returnsLinked', { status, count });
    case 'status-5xx':
    case 'sitemap-broken':
    case 'clicks-page-broken':
      return status === null ? null : say('returns', { status });
    case 'redirect-pages':
      if (target !== null) return say('redirectsTo', { target });
      return status === null ? null : say('returns', { status });
    case 'redirect-broken':
      return target === null || targetStatus === null ? null : say('redirectsToStatus', { target, targetStatus });
    case 'redirect-chain':
      return target === null ? null : say('redirectsAgain', { target });
    case 'links-to-redirect':
      return count === null ? null : say('linksToRedirects', { count });
    case 'canonical-elsewhere':
      return target === null ? null : say('canonical', { target });
    case 'canonical-broken':
      return target === null || targetStatus === null ? null : say('canonicalStatus', { target, targetStatus });
    case 'noindex':
      return noindexMessage(issue?.reason);
    case 'sitemap-nonindexable':
      return notIndexableMessage(issue?.reason);
    case 'not-in-sitemap':
      return say('notInSitemap');
    case 'broken-internal-links':
      return count === null ? null : say('linksToBroken', { count });
    case 'orphans':
    case 'clicks-page-orphan':
      return say('noLinksIn');
    case 'editorial-orphans':
      return count === null ? null : say('noneEditorial', { count });
    case 'links-to-nonindexable':
      return count === null ? null : say('linksToNonIndexable', { count });
    case 'deep-pages':
      return count === null ? null : say('clicksDeep', { count });
    case 'nofollow-internal':
      return count === null ? null : say('nofollowLinks', { count });
    case 'title-missing':
      return say('noTitle');
    case 'title-duplicate':
      return duplicateTitleMessage(issue);
    case 'title-long':
    case 'title-short':
    case 'url-long':
      return count === null ? null : say('characters', { count });
    case 'url-format':
      return urlFormatMessage(issue?.reason);
    case 'rank-page-broken':
      return status === null || count === null ? null : say('rankBroken', { status, count });
    case 'cited-page-broken':
      return status === null || count === null ? null : say('citedBroken', { status, count });
    case 'off-target':
      return count === null ? null : say('offTarget', { count });
  }
}
