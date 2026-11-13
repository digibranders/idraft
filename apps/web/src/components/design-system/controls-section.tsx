'use client';

import { parseAsString, useQueryStates } from 'nuqs';
import { useState, type ReactElement, type ReactNode } from 'react';

import { SpecimenGroup, SpecimenRow } from './specimen';
import { TableScroll } from './table-scroll';
import { HOSTILE_TITLES } from '@/components/app/cells/xss-fixtures';
import { col } from '@/components/app/data-table/columns';
import { DataTable } from '@/components/app/data-table/data-table';
import {
  DataTableList,
  DataTableListSort,
  ListTableSwitch,
  useListMode,
  type ListLine1,
  type ListLine2,
} from '@/components/app/data-table/data-table-list';
import type { DataTableColumn, PageSize, ServerPaging, TableStatus } from '@/components/app/data-table/types';
import { Delta, hasDeltaComparison } from '@/components/app/metric/delta';
import { DeltaCell } from '@/components/app/metric/delta-cell';
import { SampleCount } from '@/components/app/metric/sample-count';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { SavedViewMenu, type SavedViewExtraItem } from '@/components/app/views/saved-view-menu';
import { useSavedView } from '@/components/app/views/use-saved-view';
import { defaultView, type SavedView } from '@/components/app/views/views-model';
import { Button } from '@/components/ui/button';
import { EMPTY_VALUE, formatInteger, formatPercent, formatSampleCount, type MetricDeltaInput } from '@/lib/format';
import { DEFAULT_DENSITY, type Density, type SortKey } from '@/lib/tables/table-state';
import { cn } from '@/lib/utils';

/*
 * The mobile list rows (SC-04) and the saved view menu (SC-06) of WP-10. Every value is fixed (no clock, no
 * random numbers), so the page and its visual test look the same each time. A percent always has its count
 * beside it, an unknown value is `n/a` and never a zero, and a change is coloured only when it is detectable.
 * Nothing on this page leaves it.
 *
 * Each group is its own component, so the groups of the date range picker are added to `ControlsSection`
 * after the last one without touching these.
 */
const noop = (): void => undefined;

// -------------------------------------------------------------------------------------------------
// The prompts

interface PromptRow {
  id: string;
  text: string;
  topic: string;
  engines: number;
  /** Answers that name the brand, and the answers in all: both `null` while nothing has answered. */
  mentioned: number | null;
  answers: number | null;
  /** The change of the mention rate between the periods, as a ratio (0.053 is 5.3 points). */
  change: number | null;
  detectable: boolean | null;
}

/** 120 characters, so the cut at 320 px is seen. */
const LONG_PROMPT =
  'Which customer relationship management platform should a small marketing agency choose for email, pipeline and reporting';

const PROMPTS: readonly PromptRow[] = [
  {
    id: 'long',
    text: LONG_PROMPT,
    topic: 'Technical SEO',
    engines: 3,
    mentioned: 14,
    answers: 30,
    change: 0.053,
    detectable: true,
  },
  // No answer yet: the rate is unknown, not 0
  {
    id: 'unknown',
    text: 'Best CRM for a small agency',
    topic: 'Pricing',
    engines: 2,
    mentioned: null,
    answers: null,
    change: null,
    detectable: null,
  },
  // A change of exactly zero, within normal variation
  {
    id: 'flat',
    text: 'CRM with email marketing built in',
    topic: 'Email',
    engines: 1,
    mentioned: 6,
    answers: 30,
    change: 0,
    detectable: false,
  },
  // A rise the test found
  {
    id: 'rise',
    text: 'Best CRM for startups',
    topic: 'CRM software',
    engines: 3,
    mentioned: 21,
    answers: 30,
    change: 0.081,
    detectable: true,
  },
  // A fall the test found
  {
    id: 'fall',
    text: 'CRM pricing compared',
    topic: 'Pricing',
    engines: 2,
    mentioned: 9,
    answers: 30,
    change: -0.062,
    detectable: true,
  },
  // A change the test could not tell from noise: shown, not coloured
  {
    id: 'noise',
    text: 'HubSpot alternatives',
    topic: 'Competitors',
    engines: 2,
    mentioned: 12,
    answers: 30,
    change: 0.012,
    detectable: false,
  },
];

const TOPICS = ['CRM software', 'Pricing', 'Email', 'Competitors'] as const;
const WORDS = ['crm', 'pricing', 'email', 'automation', 'agency', 'reporting', 'startups', 'alternatives'] as const;

/** Fixed rows for the long list: no two alike, some without an answer or without a change. */
function generatedRows(count: number): PromptRow[] {
  return Array.from({ length: count }, (_, index) => {
    const answered = index % 11 !== 0;
    return {
      id: `gen-${String(index + 1)}`,
      text: `Prompt ${String(index + 1)}: ${WORDS[index % WORDS.length] ?? 'crm'} ${WORDS[(index * 3 + 1) % WORDS.length] ?? 'tools'}`,
      topic: TOPICS[index % TOPICS.length] ?? 'CRM software',
      engines: (index % 3) + 1,
      mentioned: answered ? (index * 7) % 31 : null,
      answers: answered ? 30 : null,
      change: answered && index % 4 !== 0 ? (((index * 5) % 17) - 8) / 200 : null,
      detectable: answered && index % 4 !== 0 ? index % 3 === 0 : null,
    };
  });
}
const LONG_LIST = generatedRows(150);

/** Hostile prompt and topic text from the outside world: every one of them must come out as text. */
const HOSTILE_ROWS: readonly PromptRow[] = HOSTILE_TITLES.map((title, index) => ({
  id: `hostile-${String(index + 1)}`,
  text: title,
  topic: HOSTILE_TITLES[(index + 3) % HOSTILE_TITLES.length] ?? 'Imported',
  engines: 1,
  mentioned: null,
  answers: null,
  change: null,
  detectable: null,
}));

const ratioOf = (row: PromptRow): number | null =>
  row.mentioned === null || row.answers === null || row.answers === 0 ? null : row.mentioned / row.answers;
const deltaOf = (row: PromptRow): MetricDeltaInput => ({
  value: row.change,
  unit: 'points',
  polarity: 'higher_is_better',
  isDetectable: row.detectable,
});

const line1 = (row: PromptRow): ListLine1 => {
  const ratio = ratioOf(row);
  return {
    identity: row.text,
    valueLabel: 'Mention rate',
    value: ratio === null ? <span className="text-foreground-tertiary">{EMPTY_VALUE}</span> : formatPercent(ratio),
  };
};

const line2 = (row: PromptRow): ListLine2 => {
  const delta = deltaOf(row);
  return {
    // The count that stands behind the percent of line 1, in the same button
    context:
      row.mentioned === null || row.answers === null
        ? `${row.topic}, no answers yet`
        : `${row.topic}, ${formatSampleCount(row.mentioned, row.answers)} answers`,
    // The delta has its tooltip on a desktop cell; inside the row's button it would be a second control
    delta: hasDeltaComparison(delta) ? <Delta input={delta} size="sm" tip={false} /> : null,
  };
};

// Module-level, so the table and the list search and sort again only when the rows or the sort change
const COLUMNS: readonly DataTableColumn<PromptRow>[] = [
  col.keyword<PromptRow>('prompt', (row) => row.text, { header: 'Prompt' }),
  col.volumeTrend<PromptRow>('mention', ratioOf, {
    header: 'Mention rate',
    // The percent and its count stay on one line: a wrapped count would make the row taller than its density
    width: 200,
    unknown: () => ({ label: EMPTY_VALUE, tooltip: 'No answers yet, so there is no rate' }),
    known: (row, ratio) => (
      <span className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
        <span className="num">{formatPercent(ratio)}</span>
        <SampleCount k={row.mentioned} n={row.answers} noun="answers" />
      </span>
    ),
  }),
  col.rankDelta<PromptRow>('change', (row) => row.change, {
    header: 'Change',
    cell: (row) => <DeltaCell input={deltaOf(row)} />,
  }),
  col.text<PromptRow>('topic', (row) => row.topic, { header: 'Topic', priority: 2 }),
  col.count<PromptRow>('engines', (row) => row.engines, { header: 'Engines', priority: 2 }),
];
const rowId = (row: PromptRow): string => row.id;
const textOf = (row: PromptRow): string => row.text;
const ITEM_NOUN = { one: 'prompt', other: 'prompts' };
const DEFAULT_SORT: readonly SortKey[] = [{ id: 'mention', desc: true }];
const NO_SORT: readonly SortKey[] = [];

const FILTERED_EMPTY = (
  <EmptyState title="No prompts match" reason="Clear a filter or the search to see more." headingLevel={3} />
);

interface PromptListProps {
  rows: readonly PromptRow[];
  sort: readonly SortKey[];
  status?: TableStatus | undefined;
  total?: number | null | undefined;
  toolbar?: ReactNode;
  server?: ServerPaging | undefined;
  loadProgress?: { loaded: number; total: number } | null | undefined;
  footerNote?: string | undefined;
  activeRowId?: string | null | undefined;
  onRowOpen?: ((row: PromptRow) => void) | undefined;
  errorState?: ReactNode;
  emptyState?: ReactNode;
}

/** The list with the fixtures' columns and lines; each specimen says only what differs. */
function PromptList({
  rows,
  sort,
  status = 'ready',
  total,
  toolbar,
  server,
  loadProgress,
  footerNote,
  activeRowId,
  onRowOpen = noop,
  errorState = null,
  emptyState = null,
}: PromptListProps): ReactElement {
  return (
    <DataTableList<PromptRow>
      caption="Prompts"
      itemNoun={ITEM_NOUN}
      columns={COLUMNS}
      rows={rows}
      total={total === undefined ? rows.length : total}
      getRowId={rowId}
      sort={sort}
      search=""
      searchText={textOf}
      server={server}
      loadProgress={loadProgress}
      line1={line1}
      line2={line2}
      onRowOpen={onRowOpen}
      activeRowId={activeRowId}
      status={status}
      errorState={errorState}
      emptyState={emptyState}
      filteredEmptyState={FILTERED_EMPTY}
      footerNote={footerNote}
      toolbar={toolbar}
    />
  );
}

/** A list with the sort menu and a row that opens, as a screen holds them. */
function SortableList({
  rows,
  initialSort,
}: {
  rows: readonly PromptRow[];
  initialSort: readonly SortKey[];
}): ReactElement {
  const [sort, setSort] = useState<readonly SortKey[]>(initialSort);
  const [active, setActive] = useState<string | null>(null);
  return (
    <PromptList
      rows={rows}
      sort={sort}
      activeRowId={active}
      onRowOpen={(row) => setActive(row.id)}
      toolbar={<DataTableListSort columns={COLUMNS} sort={sort} onSortChange={setSort} />}
    />
  );
}

// -------------------------------------------------------------------------------------------------
// Mobile list rows at 320, 390 and 768 px

const LIST_FRAMES = [
  { px: 320, className: 'w-80' },
  { px: 390, className: 'w-97.5' },
  { px: 768, className: 'w-192' },
] as const;

/**
 * The list in a box of a phone's width, whatever the window: `DataTableList` is a component, so it is drawn
 * directly and its own media query is not involved. A frame wider than the page scrolls inside its region.
 */
export function MobileListFramesGroup(): ReactNode {
  return (
    <SpecimenGroup
      title="Mobile list rows at 320, 390 and 768 px"
      note="19 section 6.7. Two lines a row, 56 px tall, the whole row one button that opens the record. The long prompt ends in an ellipsis, the unknown rate reads n/a and the count of answers stays beside the rate."
    >
      <div className="flex flex-col gap-4">
        {LIST_FRAMES.map(({ px, className }) => (
          <div key={px} className="flex min-w-0 flex-col gap-1">
            <span className="num type-meta">{`${formatInteger(px)} px`}</span>
            <TableScroll label={`Mobile list at ${formatInteger(px)} px`}>
              <div data-specimen-frame={px} className={cn('flex h-120 shrink-0 flex-col', className)}>
                <SortableList rows={PROMPTS} initialSort={DEFAULT_SORT} />
              </div>
            </TableScroll>
          </div>
        ))}
      </div>
    </SpecimenGroup>
  );
}

// -------------------------------------------------------------------------------------------------
// Live list or table

function LiveListOrTable(): ReactElement {
  const list = useListMode();
  const [sort, setSort] = useState<readonly SortKey[]>(DEFAULT_SORT);
  const [density, setDensity] = useState<Density>(DEFAULT_DENSITY);
  const [visible, setVisible] = useState<readonly string[] | null>(null);
  const [search, setSearch] = useState('');
  const [opened, setOpened] = useState<PromptRow | null>(null);
  const switcher = list.canSwitch ? <ListTableSwitch mode={list.mode} onModeChange={list.onModeChange} /> : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-120 flex-col">
        {list.mode === 'list' ? (
          <PromptList
            rows={PROMPTS}
            sort={sort}
            activeRowId={opened?.id ?? null}
            onRowOpen={setOpened}
            toolbar={
              <>
                <DataTableListSort columns={COLUMNS} sort={sort} onSortChange={setSort} />
                {switcher}
              </>
            }
          />
        ) : (
          <DataTable<PromptRow>
            caption="Prompts"
            itemNoun={ITEM_NOUN}
            columns={COLUMNS}
            getRowId={rowId}
            rows={PROMPTS}
            total={PROMPTS.length}
            sort={sort}
            onSortChange={setSort}
            defaultSort={DEFAULT_SORT}
            density={density}
            onDensityChange={setDensity}
            columnState={{ visible, onChange: setVisible }}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search prompts"
            searchText={textOf}
            rowName={textOf}
            onRowOpen={(row) => setOpened(row)}
            activeRowId={opened?.id ?? null}
            toolbarEnd={switcher}
            status="ready"
            errorState={null}
            emptyState={null}
            filteredEmptyState={FILTERED_EMPTY}
          />
        )}
      </div>
      <p className="type-meta">{`Opened: ${opened === null ? 'none yet' : opened.text}`}</p>
    </div>
  );
}

/** The same rows through `useListMode`: a list below 768 px, the table from 768 px, as a screen renders them. */
export function LiveListGroup(): ReactNode {
  return (
    <SpecimenGroup
      title="Live list or table"
      note="19 section 6.7 rules 5 and 7. Below 768 px the list, with a List and Table switch unless the device is touch-primary; from 768 px the table, with its Comfortable and Compact density in the toolbar. Opening a row marks it and says which."
    >
      <LiveListOrTable />
    </SpecimenGroup>
  );
}

// -------------------------------------------------------------------------------------------------
// List states

/** A list in a fixed box with its name, and the controls that change its state. */
function StateFrame({
  name,
  label,
  controls,
  children,
}: {
  name: string;
  label: string;
  controls?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    // The name marks the whole specimen, its controls included
    <div data-specimen={name} className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="num type-meta">{label}</span>
        {controls}
      </div>
      <div className="flex h-120 w-97.5 max-w-full flex-col">{children}</div>
    </div>
  );
}

function ErrorSpecimen(): ReactElement {
  const [failed, setFailed] = useState(true);
  return (
    <StateFrame
      name="error"
      label="Error, with retry"
      controls={
        <Button size="sm" onClick={() => setFailed(true)}>
          Fail again
        </Button>
      }
    >
      <PromptList
        rows={failed ? [] : PROMPTS}
        sort={DEFAULT_SORT}
        status={failed ? 'error' : 'ready'}
        errorState={
          <InlineError
            title="The prompts did not load"
            reason="The server did not answer. Your filters are kept."
            errorId={null}
            onRetry={() => setFailed(false)}
            retrying={false}
            retryLabel="Try again"
          />
        }
      />
    </StateFrame>
  );
}

function RefetchSpecimen(): ReactElement {
  const [busy, setBusy] = useState(false);
  return (
    <StateFrame
      name="refetching"
      label="Refetching"
      controls={
        <Button size="sm" aria-pressed={busy} onClick={() => setBusy((current) => !current)}>
          Refetch
        </Button>
      }
    >
      <PromptList rows={PROMPTS} sort={DEFAULT_SORT} status={busy ? 'refetching' : 'ready'} />
    </StateFrame>
  );
}

/** Loading, empty, filtered empty, error, refetching, partial and stale, each in the box of a phone. */
export function ListStatesGroup(): ReactNode {
  return (
    <SpecimenGroup
      title="List states"
      note="17 and 19 section 6.7. Loading keeps the row height and has no spinner. Empty gives the reason and the action. Error keeps its place and offers Retry. Refetching keeps the rows and draws a bar. Partial and stale say so in the count line."
    >
      <div className="flex flex-wrap gap-4">
        <StateFrame name="loading" label="Loading">
          <PromptList rows={[]} sort={DEFAULT_SORT} status="loading" />
        </StateFrame>
        <StateFrame name="empty" label="Empty, with an action">
          <PromptList
            rows={[]}
            sort={DEFAULT_SORT}
            status="empty"
            emptyState={
              <EmptyState
                title="No prompts tracked yet"
                reason="Add the questions your buyers ask, and the first answers arrive within the hour."
                primaryAction={<Button variant="primary">Add prompts</Button>}
                headingLevel={3}
              />
            }
          />
        </StateFrame>
        <StateFrame name="filtered-empty" label="Filtered empty">
          <PromptList rows={[]} sort={DEFAULT_SORT} status="filtered-empty" />
        </StateFrame>
        <ErrorSpecimen />
        <RefetchSpecimen />
        <StateFrame name="partial" label="Partial, 3 of 6 loaded">
          <PromptList
            rows={PROMPTS.slice(0, 3)}
            sort={DEFAULT_SORT}
            total={PROMPTS.length}
            loadProgress={{ loaded: 3, total: PROMPTS.length }}
          />
        </StateFrame>
        <StateFrame name="stale" label="Stale">
          <PromptList rows={PROMPTS} sort={DEFAULT_SORT} footerNote="Updated 3d ago, the last run did not finish" />
        </StateFrame>
      </div>
    </SpecimenGroup>
  );
}

// -------------------------------------------------------------------------------------------------
// Long lists and server paging

const PAGE_SIZE: PageSize = 100;

function ServerSpecimen(): ReactElement {
  const [page, setPage] = useState(0);
  const offset = page * PAGE_SIZE;
  const total = LONG_LIST.length;
  return (
    <PromptList
      rows={LONG_LIST.slice(offset, offset + PAGE_SIZE)}
      sort={NO_SORT}
      total={total}
      server={{
        rangeText: `Showing ${formatInteger(offset + 1)} to ${formatInteger(Math.min(total, offset + PAGE_SIZE))} of ${formatInteger(total)} prompts`,
        offset,
        hasPrevious: page > 0,
        hasNext: offset + PAGE_SIZE < total,
        onPrevious: () => setPage((current) => current - 1),
        onNext: () => setPage((current) => current + 1),
        pageSize: PAGE_SIZE,
        onPageSizeChange: noop,
      }}
    />
  );
}

/** 150 rows are windowed: only the rows near the view are in the page. A server list pages instead. */
export function LongListsGroup(): ReactNode {
  return (
    <SpecimenGroup
      title="Long lists and server paging"
      note="19 section 6.7 and 12 section 12. Rows near the view render and the rest keep their 56 px of space, so the open row and the focused row stay where they are. In server mode the caller sorts and pages, and the list shows Previous and Next."
    >
      <div className="flex flex-wrap gap-4">
        <StateFrame name="windowed" label="150 rows, windowed">
          <SortableList rows={LONG_LIST} initialSort={NO_SORT} />
        </StateFrame>
        <StateFrame name="server" label="Server mode, 100 a page">
          <ServerSpecimen />
        </StateFrame>
      </div>
    </SpecimenGroup>
  );
}

// -------------------------------------------------------------------------------------------------
// Hostile row text

/** Markup, script schemes, right-to-left controls, other scripts and a 400 character word, as prompt text. */
export function HostileRowsGroup(): ReactNode {
  return (
    <SpecimenGroup
      title="Hostile row text"
      note="Prompts and topics come from the outside world. Each one is text, one line with an ellipsis, and none runs."
    >
      <StateFrame name="hostile" label="Hostile prompts and topics">
        <PromptList rows={HOSTILE_ROWS} sort={NO_SORT} />
      </StateFrame>
    </SpecimenGroup>
  );
}

// -------------------------------------------------------------------------------------------------
// SavedViewMenu

const BRANDED: SavedView = { id: 'branded', name: 'Branded prompts', kind: 'preset', params: { branded: 'only' } };
const UNCITED: SavedView = {
  id: 'uncited',
  name: 'Uncited',
  kind: 'preset',
  params: { cited: 'no', sort: '-mention' },
};
const DEFAULT_VIEW = defaultView('Default');
const PRESET_VIEWS: readonly SavedView[] = [DEFAULT_VIEW, BRANDED, UNCITED];
/** The URL keys a view governs here: a stable array, as `useSavedView` asks. */
const VIEW_KEYS: readonly string[] = ['branded', 'cited', 'sort', 'q'];
const ADDRESS_PARSERS = {
  view: parseAsString,
  branded: parseAsString,
  cited: parseAsString,
  sort: parseAsString,
  q: parseAsString,
};

/** Live on the address of this page: the view and its keys are in the URL, so a link shares them. */
function LiveViewMenu(): ReactElement {
  const { view, edited, apply, reset } = useSavedView({ views: PRESET_VIEWS, viewKeys: VIEW_KEYS });
  const [address, setAddress] = useQueryStates(ADDRESS_PARSERS);
  const searching = address.q === 'crm';
  const shown = Object.entries(address).flatMap(([key, value]) => (value === null ? [] : [`${key}=${value}`]));
  return (
    <div className="flex flex-col gap-3">
      <SpecimenRow label="Live, on the page address">
        <SavedViewMenu views={PRESET_VIEWS} current={view} edited={edited} onApply={apply} onReset={reset} />
        <Button size="sm" aria-pressed={searching} onClick={() => void setAddress({ q: searching ? null : 'crm' })}>
          Search crm
        </Button>
      </SpecimenRow>
      <p className="num type-meta">{`Address keys: ${shown.length === 0 ? 'none' : shown.join(', ')}`}</p>
    </div>
  );
}

export function SavedViewGroup(): ReactNode {
  return (
    <SpecimenGroup
      title="SavedViewMenu"
      note="23 section 14. Presets map to URL states: Branded prompts sets branded=only, Uncited sets cited=no and sort=-mention. A view is a history entry, so Back returns to the one before. Search crm changes a view key and shows (edited); Reset to the view clears it."
    >
      <LiveViewMenu />
    </SpecimenGroup>
  );
}

// -------------------------------------------------------------------------------------------------
// SavedViewMenu states

/** 60 characters, as the longest name a person may give a view. */
const LONG_VIEW: SavedView = {
  id: 'long',
  name: 'Prompts that name a competitor and no engine cites our sites',
  kind: 'preset',
  params: { branded: 'competitor', cited: 'no' },
};
const WEEKLY: SavedView = {
  id: 'weekly',
  name: 'Weekly review',
  kind: 'stored',
  scope: 'workspace',
  params: { cited: 'no' },
};
const PARTNERS: SavedView = {
  id: 'partners',
  name: 'Partner prompts',
  kind: 'stored',
  scope: 'workspace',
  params: { branded: 'partner' },
};
const WATCHLIST: SavedView = {
  id: 'watchlist',
  name: 'My watchlist',
  kind: 'stored',
  scope: 'personal',
  params: { q: 'crm' },
};

/** What WP-49 passes for the actions that persist a view: labels and handlers are the caller's. */
const EXTRA_ITEMS: readonly SavedViewExtraItem[] = [
  { id: 'save-as', label: 'Save as new view', group: 'Manage', onSelect: noop },
  { id: 'rename', label: 'Rename view', group: 'Manage', onSelect: noop },
  { id: 'default', label: 'Set as my default', group: 'Manage', onSelect: noop },
  { id: 'delete', label: 'Delete view', group: 'Manage', tone: 'destructive', onSelect: noop },
];

interface StaticMenuProps {
  current: SavedView;
  edited?: boolean | undefined;
  views?: readonly SavedView[] | undefined;
  notice?: string | undefined;
  extraItems?: readonly SavedViewExtraItem[] | undefined;
}

/** One menu with a fixed state: choosing a view closes it and changes nothing. */
function StaticMenu({
  current,
  edited = false,
  views = PRESET_VIEWS,
  notice,
  extraItems,
}: StaticMenuProps): ReactElement {
  return (
    <SavedViewMenu
      views={views}
      current={current}
      edited={edited}
      onApply={noop}
      onReset={noop}
      notice={notice}
      extraItems={extraItems}
    />
  );
}

/** A fixed-width box, so the cut of a long name is seen in a narrow container. */
function Frame({ px, className, children }: { px: number; className: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <span className="num type-meta">{`${formatInteger(px)} px`}</span>
      <div
        data-specimen-frame={px}
        className={cn('max-w-full min-w-0 rounded-md border border-border-subtle p-1', className)}
      >
        {children}
      </div>
    </div>
  );
}

export function SavedViewStatesGroup(): ReactNode {
  return (
    <SpecimenGroup
      title="SavedViewMenu states"
      note="23 section 14 and WP-49. The trigger is as wide as its text up to a bound; a long name is cut and kept whole in the accessible name. Stored views are grouped by scope. The persistence items and the notice are given by the caller; the menu reads no permission."
    >
      <div className="flex flex-col gap-4">
        <SpecimenRow label="Default">
          <StaticMenu current={DEFAULT_VIEW} />
        </SpecimenRow>
        <SpecimenRow label="Named">
          <StaticMenu current={BRANDED} />
        </SpecimenRow>
        <SpecimenRow label="Edited">
          <StaticMenu current={BRANDED} edited />
        </SpecimenRow>
        <SpecimenRow label="Long name, 60 characters">
          <StaticMenu current={LONG_VIEW} views={[...PRESET_VIEWS, LONG_VIEW]} />
        </SpecimenRow>
        <SpecimenRow label="Stored views">
          <StaticMenu current={WEEKLY} views={[...PRESET_VIEWS, WEEKLY, PARTNERS, WATCHLIST]} />
        </SpecimenRow>
        <SpecimenRow label="With a notice">
          <StaticMenu current={BRANDED} notice="1 filter no longer exists" />
        </SpecimenRow>
        <SpecimenRow label="Persistence items">
          <StaticMenu current={BRANDED} edited extraItems={EXTRA_ITEMS} />
        </SpecimenRow>
        <SpecimenRow label="Narrow container">
          <Frame px={160} className="w-40">
            <StaticMenu current={LONG_VIEW} views={[...PRESET_VIEWS, LONG_VIEW]} edited />
          </Frame>
          <Frame px={240} className="w-60">
            <StaticMenu current={LONG_VIEW} views={[...PRESET_VIEWS, LONG_VIEW]} />
          </Frame>
        </SpecimenRow>
      </div>
    </SpecimenGroup>
  );
}

/** The mobile list rows and the saved view menu of WP-10; the date range picker joins them in T3. */
export function ControlsSection(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <MobileListFramesGroup />
      <LiveListGroup />
      <ListStatesGroup />
      <LongListsGroup />
      <HostileRowsGroup />
      <SavedViewGroup />
      <SavedViewStatesGroup />
    </div>
  );
}
