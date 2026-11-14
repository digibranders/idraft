import { describe, expect, it } from 'vitest';

import {
  changeRowId,
  daysIn,
  lostDays,
  lostWindowDays,
  noPreviousAnswers,
  previousDays,
  rowsOf,
  totalOf,
  truncatedOf,
} from './change-model';
import type { SourceChangePage, SourceChangeRow, SourcesMeta } from '@/lib/citations/types';

const row = (overrides: Partial<SourceChangeRow> = {}): SourceChangeRow => ({
  registrable_domain: 'agency-radar.example',
  domain_role: 'third_party',
  role_entity_id: null,
  current_units: 4,
  previous_units: 0,
  first_seen_at: '2026-11-10T02:00:00Z',
  last_seen_at: '2026-11-12T02:00:00Z',
  ...overrides,
});

const WINDOW = { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' };
const BEFORE = { from: '2026-09-18', to: '2026-10-15', timezone: 'UTC' };

const pageOf = (
  rows: readonly SourceChangeRow[],
  total = rows.length,
  kind: 'new' | 'lost' = 'new',
): SourceChangePage => ({
  data: [...rows],
  page: { limit: 100, offset: 0, total },
  meta: {
    window: kind === 'new' ? WINDOW : { from: BEFORE.from, to: WINDOW.to, timezone: 'UTC' },
    compare_window: kind === 'new' ? BEFORE : { from: '2026-08-21', to: '2026-09-17', timezone: 'UTC' },
    include_branded: false,
    engine_codes: ['chatgpt_web'],
    kind,
    min_support: 2,
  },
});

const scopeMeta = (previousAnswers: number | null | undefined): SourcesMeta => ({
  window: WINDOW,
  include_branded: false,
  engine_codes: ['chatgpt_web'],
  answers: 120,
  answers_citing: 100,
  citation_units: 900,
  by_role: [],
  compare_window: BEFORE,
  ...(previousAnswers === undefined ? {} : { previous_answers: previousAnswers }),
});

describe('changeRowId', () => {
  it('is the domain, the role and the entity, so one domain with two roles has two rows', () => {
    expect(changeRowId(row())).toBe('agency-radar.example|third_party|');
    expect(changeRowId(row({ domain_role: 'competitor', role_entity_id: 'ent-1' }))).toBe(
      'agency-radar.example|competitor|ent-1',
    );
    expect(changeRowId(row({ domain_role: 'competitor' }))).not.toBe(changeRowId(row()));
  });
});

describe('the days a read covers', () => {
  it('daysIn counts both ends of a window', () => {
    expect(daysIn({ from: '2026-10-16', to: '2026-11-12' })).toBe(28);
    expect(daysIn({ from: '2026-11-12', to: '2026-11-12' })).toBe(1);
    // Across the end of daylight saving time, which has a day of 25 hours
    expect(daysIn({ from: '2026-10-31', to: '2026-11-02' })).toBe(3);
  });

  it('previousDays is the window before the asked one, which New compares with', () => {
    expect(previousDays(pageOf([row()]).meta)).toBe(28);
  });

  it('lost reads three windows', () => {
    const { meta } = pageOf([row()], 1, 'lost');
    // The asked window and the one before it, then the support window before those
    expect(lostDays(meta)).toBe(84);
    expect(lostWindowDays(meta)).toBe(28);
    expect(lostDays(meta)).toBe(3 * lostWindowDays(meta));
  });

  it('counts a 92 day ask as 276 days', () => {
    const meta: SourceChangePage['meta'] = {
      ...pageOf([], 0, 'lost').meta,
      window: { from: '2026-05-13', to: '2026-11-12', timezone: 'UTC' },
      compare_window: { from: '2026-02-10', to: '2026-05-12', timezone: 'UTC' },
    };
    expect(lostDays(meta)).toBe(276);
    expect(lostWindowDays(meta)).toBe(92);
  });
});

describe('noPreviousAnswers', () => {
  it('is true only when the scope read says the previous period has no answers', () => {
    expect(noPreviousAnswers(scopeMeta(0))).toBe(true);
    expect(noPreviousAnswers(scopeMeta(null))).toBe(true);
    expect(noPreviousAnswers(scopeMeta(undefined))).toBe(true);
    expect(noPreviousAnswers(scopeMeta(450))).toBe(false);
  });

  it('is false while the scope read is not known, so a failed strip does not hide the list', () => {
    expect(noPreviousAnswers(undefined)).toBe(false);
  });
});

describe('rowsOf', () => {
  it('lists the rows of the page in the order the server gave', () => {
    const rows = [row({ registrable_domain: 'b.example' }), row({ registrable_domain: 'a.example' })];
    expect(rowsOf(pageOf(rows), false).map((entry) => entry.registrable_domain)).toEqual(['b.example', 'a.example']);
  });

  it('a previous period with no answers lists no new row', () => {
    const rows = [row(), row({ registrable_domain: 'b.example' })];
    expect(rowsOf(pageOf(rows), true)).toEqual([]);
    expect(rowsOf(pageOf(rows), false)).toHaveLength(2);
  });

  it('is empty while nothing is read', () => {
    expect(rowsOf(undefined, false)).toEqual([]);
  });
});

describe('totalOf', () => {
  it('is the total of the server, n/a without a read and n/a when the previous period has no answers', () => {
    expect(totalOf(pageOf([row()], 37), false)).toBe(37);
    expect(totalOf(undefined, false)).toBeNull();
    expect(totalOf(pageOf([row()], 37), true)).toBeNull();
  });
});

describe('truncatedOf', () => {
  it('past 100 rows the list is cut and says so', () => {
    const rows = Array.from({ length: 100 }, (_, index) =>
      row({ registrable_domain: `site-${String(index)}.example` }),
    );
    expect(truncatedOf(pageOf(rows, 137))).toEqual({ shown: 100, total: 137 });
    expect(truncatedOf(pageOf(rows, 100))).toBeNull();
    expect(truncatedOf(pageOf([row()], 1))).toBeNull();
    expect(truncatedOf(undefined)).toBeNull();
  });
});
