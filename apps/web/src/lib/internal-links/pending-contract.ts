import type { Schemas } from '@/lib/api/types';

/**
 * PENDING CONTRACT. The structural types of what the backend OpenAPI does not hold yet: the crawl runs
 * (`link-crawls`) and the internal links settings. Each type says which schema it stands in for. When the
 * backend commits them, regenerate `schema.ts`, replace each type here with an alias of the generated one
 * (in `types.ts`), delete this file, and add the queries and mutations the screens wait for. Nothing here names
 * a route: there is no path for a missing route anywhere in the typed client.
 */

/** Stands in for the schema `CrawlRun`.state. */
export type CrawlState = 'queued' | 'crawling' | 'processing' | 'ready' | 'stopped_at_ceiling' | 'failed' | 'cancelled';

/** Stands in for the schema `CrawlRun`.trigger. */
export type CrawlTrigger = 'website_added' | 'schedule' | 'manual' | 'ceiling_retry';

/** Stands in for the schema `CrawlRun` (backend plan 02, `api/schemas/internal_links.py`). */
export interface CrawlRun {
  run_id: string;
  trigger: CrawlTrigger;
  state: CrawlState;
  ceiling: number;
  pages_found: number;
  pages_crawled: number;
  sitemap_pages: number | null;
  render_javascript: boolean;
  estimated_cost_usd: string | null;
  cost_usd: string | null;
  stop_reason: string | null;
  error_code: string | null;
  error_message: string | null;
  hints: 'render_javascript'[];
  is_latest: boolean;
  created_at: string;
  submitted_at: string | null;
  finished_at: string | null;
  requested_by: Schemas['UserRef'] | null;
}

/** Stands in for the schema `CrawlRunPage` (the answer of `GET .../link-crawls`). */
export interface CrawlRunPage {
  data: CrawlRun[];
  page: Schemas['CursorPageInfo'];
}

/** Stands in for the schema `CrawlScheduleName`. */
export type CrawlSchedule = 'weekly' | 'every_two_weeks' | 'monthly' | 'off';

/** Stands in for the schema `InternalLinksSettings` (the `internal_links` member of `ProjectSettings`). */
export interface InternalLinksSettings {
  schedule: CrawlSchedule;
  render_javascript: boolean;
  allowed_subdomains: string[];
}

/** Stands in for the schema `InternalLinksSettingsPatch`: any of the three settings. */
export type InternalLinksSettingsPatch = Partial<InternalLinksSettings>;
