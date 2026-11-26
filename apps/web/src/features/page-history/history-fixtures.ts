import type { HistoryChange, HistoryVersion, PageHistory } from './model/page-history';

/** Test data: a readable page with a content change, a site-wide change and its first crawl. */
export const change = (patch: Partial<HistoryChange> & Pick<HistoryChange, 'type'>): HistoryChange => ({
  after: null,
  before: null,
  delta: null,
  level: null,
  ...patch,
});

export const VERSIONS: HistoryVersion[] = [
  {
    run_id: '00000000-0000-4000-8000-000000000003',
    date: '2026-11-20T02:10:00Z',
    kind: 'content',
    changes: [
      change({ type: 'title', before: 'Managed SOC', after: 'Managed SOC | Eventus Security' }),
      change({ type: 'heading_added', level: 2, after: 'How onboarding works' }),
      change({ type: 'words', delta: 120 }),
      change({ type: 'links', before: 'editorial', delta: -2 }),
    ],
  },
  { run_id: '00000000-0000-4000-8000-000000000002', date: '2026-11-13T02:10:00Z', kind: 'site_wide', changes: [] },
  {
    run_id: '00000000-0000-4000-8000-000000000001',
    date: '2026-11-06T02:10:00Z',
    kind: 'content',
    changes: [change({ type: 'heading_removed', level: 3, before: 'Our partners' })],
  },
  { run_id: '00000000-0000-4000-8000-000000000000', date: '2026-10-30T02:10:00Z', kind: 'first', changes: [] },
];

export const HISTORY: PageHistory = {
  readable: true,
  why: null,
  status: 200,
  first_seen: '2026-10-30T02:10:00Z',
  history_starts: '2026-10-30T02:10:00Z',
  last_change: '2026-11-20T02:10:00Z',
  changes: 2,
  declared: { date: '2026-11-18T09:00:00Z', source: 'json_ld' },
  declared_unreliable: false,
  versions: VERSIONS,
  versions_capped: false,
  google: { crawled_at: '2026-11-15T10:00:00Z', behind: true, coverage_state: null },
  tracked: true,
};
