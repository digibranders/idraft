import { renderHook, screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { useChangeColumns, type ChangeColumnOptions } from './change-columns';
import messages from '../../../../messages/en.json';
import type { DataTableColumn } from '@/components/app/data-table/types';
import type { SourceChangeRow } from '@/lib/citations/types';
import { renderWithProviders } from '@/test/render';

const t = createTranslator({ locale: 'en', messages, namespace: 'citations.newLost' });
const SUPPORT = { from: '2026-08-21', to: '2026-09-17' };

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

const columnsFor = (options: Partial<ChangeColumnOptions> = {}): readonly DataTableColumn<SourceChangeRow>[] =>
  renderHook(() => useChangeColumns({ kind: 'new', t, timeZone: 'UTC', supportWindow: SUPPORT, ...options })).result
    .current;

const column = (columns: readonly DataTableColumn<SourceChangeRow>[], id: string): DataTableColumn<SourceChangeRow> => {
  const found = columns.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`No ${id} column`);
  return found;
};

describe('useChangeColumns', () => {
  it('New shows the domain, the role, the units in the window and the first and last time it was cited', () => {
    const columns = columnsFor();
    expect(columns.map((entry) => entry.id)).toEqual(['domain', 'role', 'units', 'firstCited', 'lastCited']);
    expect(columns.map((entry) => entry.header)).toEqual([
      'Domain',
      'Role',
      'Citation units',
      'First cited',
      'Last cited',
    ]);
  });

  it('Lost shows the domain, the role and the units it had before it went quiet, with no date', () => {
    const columns = columnsFor({ kind: 'lost' });
    expect(columns.map((entry) => entry.id)).toEqual(['domain', 'role', 'unitsBefore']);
    expect(column(columns, 'unitsBefore').header).toBe('Units before it went quiet');
  });

  it('has no share and no change column: a counted list has nothing to compare', () => {
    for (const kind of ['new', 'lost'] as const) {
      const ids = columnsFor({ kind }).map((entry) => entry.id);
      expect(ids).not.toContain('share');
      expect(ids).not.toContain('change');
    }
  });

  it('keeps the domain first and never hidden, and no column sorts', () => {
    const columns = columnsFor();
    expect(column(columns, 'domain').identity).toBe(true);
    for (const entry of columns) expect(entry.sortValue).toBeUndefined();
  });

  it('the units tip of a lost row names the support window it was counted in', () => {
    const tip = column(columnsFor({ kind: 'lost' }), 'unitsBefore').cellTip?.(row({ previous_units: 7 }));
    expect(tip).toEqual({ content: '7 units between Aug 21 to Sep 17, 2026' });
  });

  it('says nothing of a window it does not know', () => {
    expect(column(columnsFor({ kind: 'lost', supportWindow: null }), 'unitsBefore').cellTip?.(row())).toBeUndefined();
  });

  it('is rebuilt only when what it draws changes', () => {
    const initialProps: ChangeColumnOptions = { kind: 'new', t, timeZone: 'UTC', supportWindow: SUPPORT };
    const { result, rerender } = renderHook((options: ChangeColumnOptions) => useChangeColumns(options), {
      initialProps,
    });
    const first = result.current;
    rerender({ ...initialProps });
    expect(result.current).toBe(first);
    rerender({ ...initialProps, kind: 'lost' });
    expect(result.current).not.toBe(first);
  });
});

describe('the cells', () => {
  it('the domain cell draws the registrable domain as text and no badge of its own', () => {
    const cell = column(columnsFor(), 'domain').cell(row({ domain_role: 'own' }));
    renderWithProviders(<>{cell}</>);
    expect(screen.getByText('agency-radar.example')).toBeInTheDocument();
    // The role is the next column's: a badge here would say it twice
    expect(screen.queryByText('Own')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('the role cell is the neutral badge with the word', () => {
    const cell = column(columnsFor(), 'role').cell(row({ domain_role: 'competitor' }));
    renderWithProviders(<>{cell}</>);
    expect(screen.getByText('Competitor')).toBeInTheDocument();
  });

  it('the units cell is an exact count and the dates are in the project zone', () => {
    const columns = columnsFor({ timeZone: 'Asia/Kolkata' });
    renderWithProviders(
      <>
        {column(columns, 'units').cell(row({ current_units: 1912 }))}
        {column(columns, 'firstCited').cell(row())}
      </>,
    );
    expect(screen.getByText('1,912')).toBeInTheDocument();
    expect(screen.getByText('Nov 10, 07:30')).toBeInTheDocument();
  });
});
