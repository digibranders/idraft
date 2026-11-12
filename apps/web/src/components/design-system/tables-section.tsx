'use client';

import { Archive, FolderInput, Tags } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { SpecimenGroup } from './specimen';
import { col } from '@/components/app/data-table/columns';
import { DataTable } from '@/components/app/data-table/data-table';
import type { DataTableColumn, PageSize, RecordAction, RowTree, TableStatus } from '@/components/app/data-table/types';
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

// The extension samples (WP-09): every column is priority 1, so each width shows the same columns
const GROUP_DEMAND = { id: 'demand', label: 'Demand' };
const GROUP_COST = { id: 'cost', label: 'Cost' };
/** A two-column group (Demand), a one-column group (Cost, which collapses to a tall header) and an ungrouped column. */
const GROUPED_COLUMNS = [
  col.keyword<SampleRow>('keyword', (row) => row.keyword, { header: 'Keyword', detail: (row) => row.location }),
  col.volume<SampleRow>('search_volume', (row) => row.volume, {
    header: 'Volume',
    group: GROUP_DEMAND,
    unknown: () => PENDING,
  }),
  col.count<SampleRow>('keyword_difficulty', (row) => row.difficulty, {
    header: 'KD',
    group: GROUP_DEMAND,
    unknown: () => PENDING,
  }),
  col.currency<SampleRow>('cpc_usd', (row) => row.cpc, {
    header: 'CPC (USD)',
    group: GROUP_COST,
    unknown: () => PENDING,
  }),
  col.badge<SampleRow>('intent', (row) => (row.intent === null ? null : { label: row.intent }), {
    header: 'Intent',
    unknown: () => PENDING,
  }),
];
/** Twelve columns, wider than any viewport the gallery is seen at, so the actions column has something to stay in front of. */
const WIDE_COLUMNS: DataTableColumn<SampleRow>[] = [
  ...COLUMNS.map((column) => ({ ...column, priority: 1 as const })),
  ...(
    [
      ['clicks', 'Clicks', 4],
      ['pages', 'Pages', 40],
      ['links', 'Links', 9],
      ['leads', 'Leads', 60],
      ['visits', 'Visits', 2],
    ] as const
  ).map(([id, header, divisor]) =>
    col.count<SampleRow>(id, (row) => (row.volume === null ? null : Math.round(row.volume / divisor)), {
      header,
      unknown: () => PENDING,
    }),
  ),
];
const DEMO_ROWS = SAMPLE.slice(0, 20);

/** One table with its own state, as a screen would hold it. */
function SampleTable({
  caption,
  rows,
  status,
  server,
  columns = COLUMNS,
  columnGroups = false,
  pinActions = false,
}: {
  caption: string;
  rows: readonly SampleRow[];
  status: TableStatus;
  server?: boolean;
  columns?: readonly DataTableColumn<SampleRow>[];
  columnGroups?: boolean;
  pinActions?: boolean;
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
        columns={columns}
        columnGroups={columnGroups}
        pinActions={pinActions}
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

interface Run {
  id: string;
  label: string;
  citations: number;
}
interface Prompt {
  id: string;
  label: string;
  runs: readonly Run[];
}
interface Topic {
  id: string;
  label: string;
  prompts: readonly Prompt[];
}

/** Fixed sample: a topic holds prompts, a prompt holds the runs that answered it. */
const TOPICS: readonly Topic[] = [
  {
    id: 'crm',
    label: 'CRM software',
    prompts: [
      {
        id: 'crm-best',
        label: 'Best CRM for startups',
        runs: [
          { id: 'crm-best-1', label: 'ChatGPT, 12 Nov', citations: 4 },
          { id: 'crm-best-2', label: 'Gemini, 12 Nov', citations: 2 },
          { id: 'crm-best-3', label: 'AI Mode, 12 Nov', citations: 5 },
        ],
      },
      {
        id: 'crm-price',
        label: 'CRM pricing compared',
        runs: [
          { id: 'crm-price-1', label: 'ChatGPT, 12 Nov', citations: 1 },
          { id: 'crm-price-2', label: 'Gemini, 12 Nov', citations: 3 },
        ],
      },
    ],
  },
  {
    id: 'email',
    label: 'Email marketing',
    prompts: [
      {
        id: 'email-tools',
        label: 'Email tools for small teams',
        runs: [
          { id: 'email-tools-1', label: 'ChatGPT, 12 Nov', citations: 6 },
          { id: 'email-tools-2', label: 'AI Mode, 12 Nov', citations: 0 },
        ],
      },
    ],
  },
];

interface TreeSampleRow {
  id: string;
  label: string;
  citations: number;
  tree: RowTree;
}

const sumRuns = (prompts: readonly Prompt[]): number =>
  prompts.reduce((total, prompt) => total + prompt.runs.reduce((runs, run) => runs + run.citations, 0), 0);

/** The rows in display order: a closed group hides what is under it, as a screen sends them. */
function treeRows(open: ReadonlySet<string>): TreeSampleRow[] {
  const rows: TreeSampleRow[] = [];
  TOPICS.forEach((topic, topicIndex) => {
    const topicOpen = open.has(topic.id);
    rows.push({
      id: topic.id,
      label: topic.label,
      citations: sumRuns(topic.prompts),
      tree: { level: 1, expanded: topicOpen, setSize: TOPICS.length, posInSet: topicIndex + 1 },
    });
    if (!topicOpen) return;
    topic.prompts.forEach((prompt, promptIndex) => {
      const promptOpen = open.has(prompt.id);
      rows.push({
        id: prompt.id,
        label: prompt.label,
        citations: sumRuns([prompt]),
        tree: { level: 2, expanded: promptOpen, setSize: topic.prompts.length, posInSet: promptIndex + 1 },
      });
      if (!promptOpen) return;
      prompt.runs.forEach((run, runIndex) =>
        rows.push({
          id: run.id,
          label: run.label,
          citations: run.citations,
          tree: { level: 3, setSize: prompt.runs.length, posInSet: runIndex + 1 },
        }),
      );
    });
  });
  return rows;
}

const TREE_COLUMNS = [
  col.keyword<TreeSampleRow>('label', (row) => row.label, { header: 'Topic, prompt and run', sortable: false }),
  col.count<TreeSampleRow>('citations', (row) => row.citations, { header: 'Citations', sortable: false }),
];
const treeRowId = (row: TreeSampleRow): string => row.id;
const treeRowTree = (row: TreeSampleRow): RowTree => row.tree;
const treeRowName = (row: TreeSampleRow): string => row.label;
const NO_SORT: readonly SortKey[] = [];
const nothing = (): void => undefined;

/** Three levels: the caller sends the rows in display order and keeps which groups are open. */
function ThreeLevelTable(): ReactNode {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(['crm']));
  const [density, setDensity] = useState<Density>(DEFAULT_DENSITY);
  const [visible, setVisible] = useState<readonly string[] | null>(null);
  const [search, setSearch] = useState('');
  const rows = treeRows(open);
  return (
    <div className="flex h-120 flex-col">
      <DataTable<TreeSampleRow>
        caption="Citations by topic, three levels"
        itemNoun={{ one: 'row', other: 'rows' }}
        columns={TREE_COLUMNS}
        getRowId={treeRowId}
        rows={rows}
        total={rows.length}
        rowTree={treeRowTree}
        onToggleGroup={(row) =>
          setOpen((current) => {
            const next = new Set(current);
            if (!next.delete(row.id)) next.add(row.id);
            return next;
          })
        }
        sort={NO_SORT}
        onSortChange={nothing}
        defaultSort={NO_SORT}
        density={density}
        onDensityChange={setDensity}
        columnState={{ visible, onChange: setVisible }}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search rows"
        rowName={treeRowName}
        status="ready"
        errorState={null}
        emptyState={null}
        filteredEmptyState={null}
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
      <SpecimenGroup
        title="DataTable extension: column groups"
        note="12 section 16, WP-09. columnGroups draws a group cell over adjacent columns that share a group. Demand holds two columns. Cost holds one, so its column keeps one tall header; hide KD in Columns and Demand does the same. When every group is down to one column the table keeps one header row."
      >
        <SampleTable
          caption="Keywords, column groups"
          rows={DEMO_ROWS}
          status="ready"
          columns={GROUPED_COLUMNS}
          columnGroups
        />
      </SpecimenGroup>
      <SpecimenGroup
        title="DataTable extension: three levels"
        note="12 section 16, WP-09. RowTree level 3: a topic holds prompts, a prompt holds runs. Right Arrow opens a group or moves into it, Left Arrow closes it or moves to its parent. Rows that load later are the caller's: it sends a row with selectable false in their place."
      >
        <ThreeLevelTable />
      </SpecimenGroup>
      <SpecimenGroup
        title="DataTable extension: pinned actions"
        note="12 section 10, WP-09. pinActions keeps the actions column at the right edge while twelve columns scroll under it; a 1 px border marks the edge while columns are behind it."
      >
        <SampleTable
          caption="Keywords, pinned actions"
          rows={DEMO_ROWS}
          status="ready"
          columns={WIDE_COLUMNS}
          pinActions
        />
      </SpecimenGroup>
    </>
  );
}
