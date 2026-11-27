import type { Route } from 'next';

import type { LinksTabContext } from '../tabs';
import type { CrawlInView } from '@/lib/internal-links/crawl-choice';
import { DEFAULT_SCOPE, type LinkScope } from '@/lib/internal-links/scopes';
import type { LinksScope, PageTier } from '@/lib/internal-links/types';
import { isCheckId } from '@/lib/issues/types';
import { withQuery } from '@/lib/routes/paths';

const INTERNAL_LINKS_PATH = '/seo/internal-links';
const ISSUES_PATH = '/seo/issues';
const TAXONOMY_PATH = '/settings/taxonomy';
const INTEGRATIONS_PATH = '/integrations/google';

/** What the page drawer needs from its host (spec 9.2): the host builds the exits as links with `projectPath`. */
export interface PageDrawerContext {
  scope: LinksScope;
  workspaceSlug: string;
  projectSlug: string;
  crawl: CrawlInView;
  linkScope: LinkScope;
  tiers: readonly PageTier[];
  timeZone: string;
  canWrite: boolean;
  /** `notes:write`: may add a note, and change or delete their own (9.7). */
  canNote: boolean;
  /** Opens another page in the drawer, keeping the tab. */
  openPage: (urlId: string) => void;
  hrefs: {
    journey: (urlId: string) => Route;
    linksFrom: (urlId: string) => Route;
    linksTo: (urlId: string) => Route;
    /** The open check of the Issues page; `null` for an id the page does not know: no link is drawn then. */
    issueCheck: (checkId: string) => Route | null;
    taxonomy: Route;
    /** Integrations > Google, where the Search tab sends a member who may connect Search Console. */
    integrations: Route;
  };
}

/** The open check of the Issues page, for a check of its catalogue; `null` for an id the page does not know. */
export const issueCheckHref =
  (issuesPage: Route) =>
  (checkId: string): Route | null =>
    isCheckId(checkId) ? withQuery(issuesPage, new URLSearchParams({ check: checkId }).toString()) : null;

/** The drawer's context for a tab of Internal links. */
export function drawerContextOf(context: LinksTabContext, can: { write: boolean; note: boolean }): PageDrawerContext {
  const base = context.hrefOf(INTERNAL_LINKS_PATH);
  // A link keeps the crawl in view and the link scope, as the tabs' own `setSearch` does
  const exit = (values: Record<string, string>): Route => {
    const query = new URLSearchParams(values);
    if (context.crawl.run !== null) query.set('run', context.crawl.run);
    if (context.state.scope !== DEFAULT_SCOPE) query.set('scope', context.state.scope);
    return withQuery(base, query.toString());
  };
  return {
    scope: context.scope,
    workspaceSlug: context.workspaceSlug,
    projectSlug: context.projectSlug,
    crawl: context.crawl,
    linkScope: context.state.scope,
    tiers: context.tiers,
    timeZone: context.timeZone,
    canWrite: can.write,
    canNote: can.note,
    openPage: context.inspect.open,
    hrefs: {
      journey: (urlId) => exit({ tab: 'journey', focus: urlId }),
      linksFrom: (urlId) => exit({ tab: 'links', src: urlId }),
      linksTo: (urlId) => exit({ tab: 'links', tgt: urlId }),
      issueCheck: issueCheckHref(context.hrefOf(ISSUES_PATH)),
      taxonomy: context.hrefOf(TAXONOMY_PATH),
      integrations: context.hrefOf(INTEGRATIONS_PATH),
    },
  };
}
