'use client';

import { Archive, FolderInput, Tags } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { SpecimenGroup } from './specimen';
import { col } from '@/components/app/data-table/columns';
import { DataTable } from '@/components/app/data-table/data-table';
import type { PageSize, RecordAction, TableStatus } from '@/components/app/data-table/types';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { formatInteger } from '@/lib/format';
import { DEFAULT_DENSITY, type Density, type SortKey } from '@/lib/tables/table-state';

interface SampleRow {
  id: string;
  keyword: string;
  location: string;
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  intent: string | null;
  group: string;
  added: string;
}

const INTENTS = ['Commercial', 'Informational', 'Transactional', 'Navigational'];
const GROUPS = ['Product/CRM', 'Product/Email', 'Brand', 'Competitors'];
const WORDS = ['crm', 'pricing', 'for startups', 'alternatives', 'free', 'software', 'agency', 'small business'];

/** 300 sample keywords: fixed values, so the preview and its visual test look the same each time. */
const SAMPLE: SampleRow[] = Array.from({ length: 300 }, (_, index) => ({
  id: `kw-${String(index)}`,
  keyword: `${WORDS[index % WORDS.length] ?? 'crm'} ${WORDS[(index * 3 + 1) % WORDS.length] ?? 'tools'} ${String(index + 1)}`,
  location: index % 3 === 0 ? 'United Kingdom, Desktop' : 'United States, Desktop',
  volume: index % 17 === 0 ? null : ((index * 7919) % 33_000) + 20,
  difficulty: index % 17 === 0 ? null : (index * 37) % 100,
  cpc: index % 17 === 0 ? null : ((index * 131) % 900) / 100,
  intent: index % 17 === 0 ? null : (INTENTS[index % INTENTS.length] ?? null),
  group: GROUPS[index % GROUPS.length] ?? 'Brand',
  added: new Date(Date.UTC(2026, 8, 1 + (index % 28), 9, index % 60)).toISOString(),
}));

const PENDING = { label: 'Pending', tooltip: 'Metrics arrive within minutes of adding a keyword' };

const COLUMNS = [
  col.keyword<SampleRow>('keyword', (row) => row.keyword, { header: 'Keyword', detail: (row) => row.location }),
  col.volume<SampleRow>('search_volume', (row) => row.volume, {
    header: 'Volume',
    headerTooltip: 'Monthly searches, an estimate from DataForSEO Labs',
    unknown: () => PENDING,
  }),
  col.count<SampleRow>('keyword_difficulty', (row) => row.difficulty, {
    header: 'KD',
    headerTooltip: 'Keyword difficulty, 0 to 100',
    priority: 2,
    unknown: () => PENDING,
  }),
  col.currency<SampleRow>('cpc_usd', (row) => row.cpc, { header: 'CPC (USD)', priority: 3, unknown: () => PENDING }),
  col.badge<SampleRow>('intent', (row) => (row.intent === null ? null : { label: row.intent }), {
    header: 'Intent',
    priority: 2,
    unknown: () => PENDING,
  }),
  col.text<SampleRow>('group', (row) => row.group, { header: 'Group', priority: 3 }),
  col.date<SampleRow>('created_at', (row) => row.added, {
    header: 'Added',
    priority: 4,
    timeZone: 'Europe/Berlin',
    secondary: true,
  }),
];

const DEFAULT_SORT: SortKey[] = [{ id: 'search_volume', desc: true }];
// Module-level, so the table searches and sorts again only when the rows or the sort change
const rowId = (row: SampleRow): string => row.id;
const keywordOf = (row: SampleRow): string => row.keyword;
const ACTIONS: RecordAction<SampleRow>[] = [
  { id: 'tags', label: 'Add tags', icon: Tags, group: 'object', onSelect: () => undefined },
  { id: 'group', label: 'Move to group', icon: FolderInput, group: 'object', onSelect: () => undefined },
  { id: 'archive', label: 'Archive', icon: Archive, group: 'destructive', onSelect: () => undefined },
];

/** One table with its own state, as a screen would hold it. */
function SampleTable({
  caption,
  rows,
  status,
  server,
}: {
  caption: string;
  rows: readonly SampleRow[];
  status: TableStatus;
  server?: boolean;
}): ReactNode {
  const [sort, setSort] = useState<readonly SortKey[]>(DEFAULT_SORT);
  const [density, setDensity] = useState<Density>(DEFAULT_DENSITY);
  const [visible, setVisible] = useState<readonly string[] | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<PageSize>(100);
  const [page, setPage] = useState(0);
  const shown = server === true ? rows.slice(page * pageSize, (page + 1) * pageSize) : rows;
  return (
    <div className="flex h-120 flex-col">
      <DataTable<SampleRow>
        caption={caption}
        itemNoun={{ one: 'keyword', other: 'keywords' }}
        columns={COLUMNS}
        getRowId={rowId}
        rows={shown}
        total={rows.length}
        server={
          server === true
            ? {
                rangeText: `Showing ${formatInteger(page * pageSize + 1)} to ${formatInteger(Math.min(rows.length, (page + 1) * pageSize))} of ${formatInteger(rows.length)} keywords`,
                offset: page * pageSize,
                hasPrevious: page > 0,
                hasNext: (page + 1) * pageSize < rows.length,
                onPrevious: () => setPage((current) => current - 1),
                onNext: () => setPage((current) => current + 1),
                pageSize,
                onPageSizeChange: (size) => {
                  setPageSize(size);
                  setPage(0);
                },
              }
            : undefined
        }
        sort={sort}
        onSortChange={setSort}
        defaultSort={DEFAULT_SORT}
        density={density}
        onDensityChange={setDensity}
        columnState={{ visible, onChange: setVisible }}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search keywords"
        searchText={keywordOf}
        selection={{
          selectedIds: selected,
          onChange: setSelected,
          matchingTotal: server === true ? rows.length : null,
          allMatching,
          onAllMatchingChange: setAllMatching,
        }}
        bulkActions={ACTIONS}
        rowActions={ACTIONS}
        rowName={(row) => row.keyword}
        onRowOpen={(row) => setActive(row.id)}
        activeRowId={active}
        status={status}
        errorState={
          <InlineError
            title="The keywords did not load"
            reason="The server did not answer. Your filters are kept."
            errorId={null}
            onRetry={() => undefined}
            retrying={false}
            retryLabel="Retry"
          />
        }
        emptyState={
          <EmptyState
            title="No keywords tracked yet"
            reason="Add keywords or import a list to start."
            headingLevel={3}
          />
        }
        filteredEmptyState={
          <EmptyState title="No keywords match" reason="Clear a filter or the search to see more." headingLevel={3} />
        }
        footerNote="Updated 12m ago"
      />
    </div>
  );
}

export function TablesSection(): ReactNode {
  return (
    <>
      <SpecimenGroup
        title="DataTable, client mode"
        note="12. Compact rows, 12 px text, capital headers and left aligned columns are the defaults (owner decisions of 2026-10-29). 300 rows: rows near the view render, the rest keep their space. Sort from a header, select with the checkboxes or Space, open a row with Enter. Missing metrics read Pending and sort last both ways."
      >
        <SampleTable caption="Keywords, client mode" rows={SAMPLE} status="ready" />
      </SpecimenGroup>
      <SpecimenGroup
        title="DataTable, server mode"
        note="12 section 12. A page at a time, with previous, next and page size."
      >
        <SampleTable caption="Keywords, server mode" rows={SAMPLE} status="ready" server />
      </SpecimenGroup>
      <SpecimenGroup title="States" note="12 section 7. Loading, empty and error keep the header.">
        <div className="flex flex-col gap-6">
          <SampleTable caption="Keywords, loading" rows={[]} status="loading" />
          <SampleTable caption="Keywords, empty" rows={[]} status="empty" />
          <SampleTable caption="Keywords, error" rows={[]} status="error" />
        </div>
      </SpecimenGroup>
    </>
  );
}
