import type { Schemas } from '@/lib/api/types';

/**
 * The history of one page as the mock answers it (`GET .../pages/{url_id}/history`): one version for each crawl of
 * the project, newest first, the oldest being the first crawl that found the page. Nothing is random: the kinds
 * follow the position of the crawl, so every state of the History tab can be opened.
 */

type PageHistory = Schemas['PageHistory'];
type Version = PageHistory['versions'][number];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const LATEST = Date.parse('2026-11-14T03:12:00Z');

/** What changed on a crawl, by its position (0 is the latest): the text changed on 0 and 2, the menu on 1. */
function versionOf(runId: string, index: number, count: number): Version {
  const date = new Date(LATEST - index * WEEK_MS).toISOString();
  if (index === count - 1) return { run_id: runId, date, kind: 'first', changes: [] };
  if (index === 1) return { run_id: runId, date, kind: 'site_wide', changes: [] };
  if (index === 0) {
    return {
      run_id: runId,
      date,
      kind: 'content',
      changes: [
        { type: 'title', before: 'Plans', after: 'Plans and pricing', delta: null, level: null },
        { type: 'heading_added', before: null, after: 'What a plan includes', delta: null, level: 2 },
        { type: 'words', before: null, after: null, delta: 120, level: null },
      ],
    };
  }
  return {
    run_id: runId,
    date,
    kind: 'content',
    changes: [{ type: 'links', before: 'editorial', after: null, delta: -1, level: null }],
  };
}

/** The history of a page over the given crawls, newest first. */
export function historyOf(runIds: readonly string[]): PageHistory {
  const versions = runIds.map((runId, index) => versionOf(runId, index, runIds.length));
  const content = versions.filter((version) => version.kind === 'content');
  const oldest = versions.at(-1);
  const newestContent = content[0];
  return {
    readable: true,
    why: null,
    status: 200,
    first_seen: oldest?.date ?? new Date(LATEST).toISOString(),
    history_starts: oldest?.date ?? null,
    last_change: newestContent?.date ?? null,
    changes: content.length,
    declared: { date: '2026-11-10T09:00:00Z', source: 'json_ld' },
    declared_unreliable: false,
    versions,
    versions_capped: false,
    google: { crawled_at: '2026-11-12T10:00:00Z', behind: true, coverage_state: null },
    tracked: false,
  };
}
