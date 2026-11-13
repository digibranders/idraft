import type { EngineUnits, SourcePagePage } from '@/lib/citations/types';
import { displayUrl, webHref } from '@/lib/format';

/**
 * The rows of the own pages card, as figures (WP-37 plan T2). Pure: numbers and text in, numbers and text out. The
 * address, the title and the host are provider text: they leave this file as strings for React to draw as text.
 */

export interface PageFigures {
  /** The page's id in the API (`url_id`), which the source inspector of the Citations page opens. */
  urlId: number;
  id: string;
  /** The canonical address as the API sent it. */
  url: string;
  /** What the row shows: the path, with the host in front when the host is shown; an unsafe address as it came. */
  label: string;
  /** The host is part of the label. */
  hostShown: boolean;
  /** An http or https address without credentials: the only kind a link may ever take. */
  safe: boolean;
  /** A title an answer gave the page, or null. */
  title: string | null;
  units: number;
  answers: number;
  prompts: number;
  engines: readonly EngineUnits[];
  firstSeenAt: string;
}

/**
 * Whether the host can be left out: every page is on one host and the list is complete. A page that is not in the
 * list (the route has more than it was asked for) may be on another domain, and then the host stays.
 */
function onOneHost(page: SourcePagePage): boolean {
  if (page.data.length === 0 || page.page.total > page.data.length) return false;
  const hosts = new Set(page.data.map((row) => row.host.toLowerCase()));
  const domains = new Set(page.data.map((row) => row.registrable_domain.toLowerCase()));
  return hosts.size === 1 && domains.size === 1;
}

/** The rows of a page of own pages in the order the route gave them (units, descending). */
export function pageRows(page: SourcePagePage): PageFigures[] {
  const hideHost = onOneHost(page);
  return page.data.map((row) => {
    const safe = webHref(row.url) !== null;
    const parsed = displayUrl(row.url);
    // An address that is not safe is shown as it came, so nothing hides what it is
    const label = !safe ? row.url : hideHost ? parsed.path : parsed.display;
    return {
      urlId: row.url_id,
      id: String(row.url_id),
      url: row.url,
      label,
      hostShown: safe && !hideHost,
      safe,
      title: row.title,
      units: row.citation_units,
      answers: row.observations,
      prompts: row.prompts,
      engines: row.engines,
      firstSeenAt: row.first_seen_at,
    };
  });
}
