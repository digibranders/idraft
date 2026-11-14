'use client';

import {
  ArrowUpRight,
  Bell,
  FileText,
  Globe,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { Route } from 'next';
import { useId, useState, type ReactElement, type ReactNode } from 'react';

import { SpecimenGroup, SpecimenRow } from './specimen';
import { CountPopover, type CountPopoverDomain } from '@/components/app/cells/count-popover';
import { DomainCell, DomainRoleBadge, type DomainRole, type FaviconMode } from '@/components/app/cells/domain-cell';
import { DomainChipList, type DomainChipProps } from '@/components/app/cells/domain-chip';
import { URLCell } from '@/components/app/cells/url-cell';
import { HOSTILE_HOSTS, HOSTILE_TITLES, HOSTILE_URLS } from '@/components/app/cells/xss-fixtures';
import { col } from '@/components/app/data-table/columns';
import { DataTable } from '@/components/app/data-table/data-table';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { ChangeFeed, type ChangeFeedState } from '@/components/app/feed/change-feed';
import { CountTabs, type CountTabsItem } from '@/components/app/feed/count-tabs';
import type { ChangeFeedGroup, ChangeFeedItem } from '@/components/app/feed/feed-model';
import { FeedRow, type FeedChange, type FeedItem } from '@/components/app/feed/feed-row';
import { Inspector } from '@/components/app/inspector/inspector';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { InspectorBody } from '@/components/app/inspector/inspector-tabs';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { Button } from '@/components/ui/button';
import { displayDomain, EMPTY_VALUE, formatInteger, formatPercent, type MetricDeltaInput } from '@/lib/format';
import { useInspectorStepping } from '@/lib/inspector/use-inspector-stepping';
import { DEFAULT_DENSITY, type Density, type SortKey } from '@/lib/tables/table-state';
import { cn } from '@/lib/utils';

/*
 * Every value on this page is fixed (no clock, no random numbers), so the preview and its visual test look the
 * same each time. Counts sit beside every percent, an unknown value is `n/a` and never a zero, and a change is
 * coloured only when it is detectable (rules R1, R2, R3 and R5 of the AI visibility inventory). Hrefs are
 * `#anchors`: nothing on this page leaves it.
 */
const anchor = (id: string): Route => `#${id}`;
const noop = (): void => undefined;

const NOW = new Date('2026-11-13T12:00:00Z');
const TIME_ZONE = 'UTC';

const OWN: DomainRole = 'own';
const COMPETITOR: DomainRole = 'competitor';
const THIRD_PARTY: DomainRole = 'third_party';
const ROLE_WORD = { own: 'Own', competitor: 'Competitor', third_party: 'Third party' } as const satisfies Record<
  DomainRole,
  string
>;

// -------------------------------------------------------------------------------------------------
// Layout helpers

/** A fixed-width box, so truncation is seen at three container widths in one viewport. */
const FRAMES = [
  { px: 160, className: 'w-40' },
  { px: 240, className: 'w-60' },
  { px: 320, className: 'w-80' },
] as const;

function Frame({ px, className, children }: { px: number; className: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <span className="num type-meta">{`${formatInteger(px)} px`}</span>
      <div
        data-specimen-frame={px}
        // `group` is what shows Copy and Open on hover, as a table row does
        className={cn('group max-w-full min-w-0 rounded-md border border-border-subtle p-1', className)}
      >
        {children}
      </div>
    </div>
  );
}

/** A cell in a box wide enough for a row of the page, with the hover group a table row provides. */
function Slot({ width, children }: { width: 'w-60' | 'w-96'; children: ReactNode }): ReactElement {
  return <div className={cn('group max-w-full min-w-0', width)}>{children}</div>;
}

// -------------------------------------------------------------------------------------------------
// DomainCell and DomainRoleBadge

interface DomainSpecimen {
  label: string;
  host: string;
  registrable: string;
  role: DomainRole | undefined;
  linked: boolean;
  unresolvedRedirect: boolean;
  category: string | undefined;
}

const DOMAIN_SPECIMENS: readonly DomainSpecimen[] = [
  {
    label: 'Own',
    host: 'northwind.com',
    registrable: 'northwind.com',
    role: OWN,
    linked: true,
    unresolvedRedirect: false,
    category: undefined,
  },
  {
    label: 'Competitor',
    host: 'hubspot.com',
    registrable: 'hubspot.com',
    role: COMPETITOR,
    linked: true,
    unresolvedRedirect: false,
    category: undefined,
  },
  {
    label: 'Third party',
    host: 'g2.com',
    registrable: 'g2.com',
    role: THIRD_PARTY,
    linked: true,
    unresolvedRedirect: false,
    category: 'Review site',
  },
  {
    label: 'Subdomain',
    host: 'docs.hubspot.com',
    registrable: 'hubspot.com',
    role: COMPETITOR,
    linked: true,
    unresolvedRedirect: false,
    category: undefined,
  },
  {
    label: 'Redirect not resolved',
    host: 'go.example-store.com',
    registrable: 'example-store.com',
    role: THIRD_PARTY,
    linked: true,
    unresolvedRedirect: true,
    category: undefined,
  },
  {
    label: 'No link',
    host: 'capterra.com',
    registrable: 'capterra.com',
    role: THIRD_PARTY,
    linked: false,
    unresolvedRedirect: false,
    category: undefined,
  },
];

const FAVICON_VARIANTS: readonly { key: string; mode: FaviconMode | undefined }[] = [
  { key: 'show', mode: 'show' },
  { key: 'hide', mode: 'hide' },
  { key: 'none', mode: undefined },
];

const LONG_HOST = HOSTILE_HOSTS[0];

function DomainCellGroup(): ReactElement {
  return (
    <SpecimenGroup
      title="DomainCell"
      note="12-tables.md section 6. Left to right: icon shown, icon placeholder only (the setting is off), no icon slot. The prefix gives way first; the registrable domain stays."
    >
      <div className="flex flex-col gap-3">
        {DOMAIN_SPECIMENS.map((specimen) => (
          <SpecimenRow key={specimen.label} label={specimen.label}>
            {FAVICON_VARIANTS.map((variant) => (
              <Slot key={variant.key} width="w-60">
                <DomainCell
                  host={specimen.host}
                  registrable={specimen.registrable}
                  role={specimen.role}
                  favicon={variant.mode}
                  href={specimen.linked ? anchor(`domain-${specimen.host}`) : undefined}
                  unresolvedRedirect={specimen.unresolvedRedirect}
                  category={specimen.category}
                  context="list"
                />
              </Slot>
            ))}
          </SpecimenRow>
        ))}
        <SpecimenRow label="Long host">
          {FRAMES.map((frame) => (
            <Frame key={frame.px} {...frame}>
              {LONG_HOST === undefined ? null : (
                <DomainCell
                  host={LONG_HOST.host}
                  registrable={LONG_HOST.registrable}
                  favicon="hide"
                  href={anchor('domain-long')}
                  context="list"
                />
              )}
            </Frame>
          ))}
        </SpecimenRow>
      </div>
    </SpecimenGroup>
  );
}

function DomainRoleBadgeGroup(): ReactElement {
  return (
    <SpecimenGroup title="DomainRoleBadge" note="For a Role column. All three roles are neutral: the word carries it.">
      <SpecimenRow label="Roles">
        <DomainRoleBadge role={OWN} />
        <DomainRoleBadge role={COMPETITOR} />
        <DomainRoleBadge role={THIRD_PARTY} />
      </SpecimenRow>
    </SpecimenGroup>
  );
}

// -------------------------------------------------------------------------------------------------
// DomainChip

const chips = (domains: readonly string[]): readonly DomainChipProps[] =>
  domains.map((domain) => ({ domain, href: anchor(`chip-${domain}`) }));

function DomainChipGroup(): ReactElement {
  return (
    <SpecimenGroup
      title="DomainChip"
      note="23-application-patterns.md section 4.4. Three chips show; the rest are +N, which opens them."
    >
      <div className="flex flex-col gap-3">
        <SpecimenRow label="Two chips">
          <DomainChipList label="Cited by ChatGPT" domains={chips(['hubspot.com', 'g2.com'])} />
        </SpecimenRow>
        <SpecimenRow label="Three chips">
          <DomainChipList label="Cited by Gemini" domains={chips(['hubspot.com', 'g2.com', 'capterra.com'])} />
        </SpecimenRow>
        <SpecimenRow label="Five chips">
          <DomainChipList
            label="Cited by Perplexity"
            domains={chips(['hubspot.com', 'g2.com', 'capterra.com', 'salesforce.com', 'zoho.com'])}
          />
        </SpecimenRow>
      </div>
    </SpecimenGroup>
  );
}

// -------------------------------------------------------------------------------------------------
// URLCell

const PAGE_URL = 'https://www.hubspot.com/products/crm';
const LONG_URL = 'https://www.hubspot.com/resources/guides/how-to-choose-a-crm-for-startups-and-small-teams';

function URLCellGroup(): ReactElement {
  return (
    <SpecimenGroup
      title="URLCell"
      note="12-tables.md section 6. The host is shown unless the table is about one domain. Copy and Open show on hover and focus. An address a browser would run is text with a warning."
    >
      <div className="flex flex-col gap-3">
        <SpecimenRow label="Host shown">
          <Slot width="w-96">
            <URLCell url={PAGE_URL} hostDisplay="show" label="cited page" context="list" />
          </Slot>
        </SpecimenRow>
        <SpecimenRow label="Host hidden">
          <Slot width="w-96">
            <URLCell
              url="https://northwind.com/blog/how-to-choose-a-crm"
              hostDisplay="hide"
              label="cited page"
              context="list"
            />
          </Slot>
        </SpecimenRow>
        <SpecimenRow label="With title">
          <Slot width="w-96">
            <URLCell
              url={PAGE_URL}
              hostDisplay="show"
              label="cited page"
              title="Free CRM software for small teams"
              context="list"
            />
          </Slot>
        </SpecimenRow>
        <SpecimenRow label="Inspector link">
          <Slot width="w-96">
            <URLCell
              url={PAGE_URL}
              hostDisplay="show"
              label="cited page"
              inspectorHref={anchor('source-hubspot')}
              context="list"
            />
          </Slot>
        </SpecimenRow>
        <SpecimenRow label="Icon shown">
          <Slot width="w-96">
            <URLCell url={PAGE_URL} hostDisplay="show" label="cited page" favicon="show" context="list" />
          </Slot>
        </SpecimenRow>
        <SpecimenRow label="Invalid address">
          <Slot width="w-96">
            <URLCell url="javascript:void(0)" hostDisplay="show" label="cited page" context="list" />
          </Slot>
        </SpecimenRow>
        <SpecimenRow label="Not cited">
          <Slot width="w-96">
            <URLCell url={null} hostDisplay="show" label="cited page" emptyText="Not cited" context="list" />
          </Slot>
        </SpecimenRow>
        <SpecimenRow label="Long path">
          {FRAMES.map((frame) => (
            <Frame key={frame.px} {...frame}>
              <URLCell url={LONG_URL} hostDisplay="show" label="cited page" context="list" />
            </Frame>
          ))}
        </SpecimenRow>
      </div>
    </SpecimenGroup>
  );
}

// -------------------------------------------------------------------------------------------------
// In a table, with the inspector and its stepping

interface DomainRow {
  id: string;
  host: string;
  registrable: string;
  role: DomainRole;
  topPage: string | null;
  citations: number;
  /** Domains cited where the own domain was not; `null` when unknown. */
  citedInstead: number | null;
  insteadDomains: readonly CountPopoverDomain[];
}

const INSTEAD_TOTAL = 107;

const INSTEAD: readonly CountPopoverDomain[] = [
  { id: 'hubspot', host: 'hubspot.com', registrable: 'hubspot.com', role: COMPETITOR, countText: '34' },
  { id: 'g2', host: 'g2.com', registrable: 'g2.com', countText: '22' },
  { id: 'capterra', host: 'capterra.com', registrable: 'capterra.com', countText: '18' },
  { id: 'salesforce', host: 'salesforce.com', registrable: 'salesforce.com', role: COMPETITOR, countText: '12' },
  { id: 'zoho', host: 'zoho.com', registrable: 'zoho.com', role: COMPETITOR, countText: '9' },
  { id: 'pipedrive', host: 'pipedrive.com', registrable: 'pipedrive.com', role: COMPETITOR, countText: '7' },
  { id: 'freshworks', host: 'freshworks.com', registrable: 'freshworks.com', role: COMPETITOR, countText: '5' },
];

/** The same domains with a share after each count: the count stays, the share never stands alone. */
const INSTEAD_COUNTS = [34, 22, 18, 12, 9, 7, 5] as const;
const INSTEAD_WITH_SHARE: readonly CountPopoverDomain[] = INSTEAD.map((entry, index) => ({
  ...entry,
  shareText: formatPercent((INSTEAD_COUNTS[index] ?? 0) / INSTEAD_TOTAL),
}));

const ROWS: readonly DomainRow[] = [
  {
    id: 'hubspot',
    host: 'hubspot.com',
    registrable: 'hubspot.com',
    role: COMPETITOR,
    topPage: PAGE_URL,
    citations: 412,
    citedInstead: 7,
    insteadDomains: INSTEAD,
  },
  {
    id: 'northwind',
    host: 'northwind.com',
    registrable: 'northwind.com',
    role: OWN,
    topPage: 'https://northwind.com/blog/how-to-choose-a-crm',
    citations: 268,
    citedInstead: 0,
    insteadDomains: [],
  },
  {
    id: 'g2',
    host: 'g2.com',
    registrable: 'g2.com',
    role: THIRD_PARTY,
    topPage: 'https://www.g2.com/categories/crm',
    citations: 187,
    citedInstead: 3,
    insteadDomains: INSTEAD.slice(0, 3),
  },
  {
    id: 'hubspot-docs',
    host: 'docs.hubspot.com',
    registrable: 'hubspot.com',
    role: COMPETITOR,
    topPage: 'https://docs.hubspot.com/docs/api/overview',
    citations: 96,
    citedInstead: null,
    insteadDomains: [],
  },
  {
    id: 'capterra',
    host: 'capterra.com',
    registrable: 'capterra.com',
    role: THIRD_PARTY,
    topPage: null,
    citations: 74,
    citedInstead: 5,
    insteadDomains: INSTEAD.slice(0, 5),
  },
  {
    id: 'salesforce',
    host: 'salesforce.com',
    registrable: 'salesforce.com',
    role: COMPETITOR,
    topPage: 'https://www.salesforce.com/crm/',
    citations: 51,
    citedInstead: 4,
    insteadDomains: INSTEAD.slice(0, 4),
  },
];

const ROW_IDS: readonly string[] = ROWS.map((row) => row.id);

/*
 * The identity column and the badge, count and URL columns take the part's own cell: `col.keyword` draws text and
 * `col.badge` and `col.count` draw their own values, so each column keeps its type's width, sorting and header
 * and swaps the cell. `hasControls` tells the table that its cells hold links, which F2 reaches.
 */
const COLUMNS: readonly DataTableColumn<DomainRow>[] = [
  {
    ...col.keyword<DomainRow>('domain', (row) => row.host, { header: 'Domain' }),
    cell: (row) => (
      <DomainCell
        host={row.host}
        registrable={row.registrable}
        role={row.role}
        favicon="show"
        href={anchor(`domain-${row.id}`)}
      />
    ),
    cellLabel: (row) => row.host,
    hasControls: true,
  },
  {
    ...col.badge<DomainRow>('role', (row) => ({ label: ROLE_WORD[row.role] }), { header: 'Role' }),
    cell: (row) => <DomainRoleBadge role={row.role} />,
  },
  col.url<DomainRow>('top_page', (row) => row.topPage, {
    header: 'Top page',
    width: 280,
    hasControls: true,
    cell: (row) => (
      <URLCell
        url={row.topPage}
        hostDisplay="hide"
        label="top page"
        emptyText="Not cited"
        inspectorHref={anchor(`page-${row.id}`)}
      />
    ),
  }),
  {
    ...col.count<DomainRow>('cited_instead', (row) => row.citedInstead, { header: 'Cited instead', width: 120 }),
    cell: (row) => (
      <CountPopover
        countText={row.citedInstead === null ? EMPTY_VALUE : formatInteger(row.citedInstead)}
        label={`${row.citedInstead === null ? EMPTY_VALUE : formatInteger(row.citedInstead)} domains cited instead for ${row.host}, show them`}
        title="Cited instead"
        domains={row.insteadDomains}
        total={row.citedInstead}
      />
    ),
    hasControls: true,
  },
  col.count<DomainRow>('citations', (row) => row.citations, { header: 'Citations' }),
];

const DEFAULT_SORT: readonly SortKey[] = [{ id: 'citations', desc: true }];
const rowId = (row: DomainRow): string => row.id;
const rowHost = (row: DomainRow): string => row.host;

/** A list of domains with its inspector, as Citations will hold them; J and K step through the order shown. */
function SteppingSpecimen(): ReactElement {
  const inspector = useInspector();
  const [sort, setSort] = useState<readonly SortKey[]>(DEFAULT_SORT);
  const [density, setDensity] = useState<Density>(DEFAULT_DENSITY);
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState<readonly string[]>(ROW_IDS);
  const stepping = useInspectorStepping({
    inspector,
    type: 'domain',
    order,
    typeLabel: 'Domain',
    typeNoun: 'domain',
  });
  const openId = inspector.target?.type === 'domain' ? inspector.target.id : null;
  const open = ROWS.find((row) => row.id === openId) ?? null;
  return (
    <div className="flex h-120 overflow-hidden rounded-lg border border-border-subtle">
      <InspectorLayout
        inspector={
          open === null ? null : (
            <Inspector
              type="domain"
              backLabel="Back to the list"
              onClose={inspector.close}
              onStep={stepping.onStep}
              header={{
                title: open.host,
                typeLabel: 'Domain',
                typeNoun: 'domain',
                positionText: stepping.positionText,
                navigation: stepping.navigation,
                badges: <DomainRoleBadge role={open.role} />,
              }}
            >
              <InspectorBody>
                <p className="num type-body">{`${formatInteger(open.citations)} citations in the last 28 days`}</p>
              </InspectorBody>
            </Inspector>
          )
        }
      >
        <DataTable<DomainRow>
          caption="Domains with an inspector"
          itemNoun={{ one: 'domain', other: 'domains' }}
          columns={COLUMNS}
          getRowId={rowId}
          rows={ROWS}
          total={ROWS.length}
          sort={sort}
          onSortChange={setSort}
          defaultSort={DEFAULT_SORT}
          density={density}
          onDensityChange={setDensity}
          columnState={{ visible: null, onChange: noop }}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search domains"
          // No `searchText`: the field takes text and narrows nothing here, so typing J in it leaves the order, and the position, alone
          rowName={rowHost}
          onRowOpen={(row) => inspector.open({ type: 'domain', id: row.id })}
          activeRowId={openId}
          onRowOrderChange={setOrder}
          status="ready"
          errorState={null}
          emptyState={null}
          filteredEmptyState={<p className="p-4 type-meta">No domains match.</p>}
        />
      </InspectorLayout>
    </div>
  );
}

function TableGroup(): ReactElement {
  return (
    <SpecimenGroup
      title="In a table, Default and Compact"
      note="Rows are 40 px (Comfortable) or 32 px (Compact): choose in the table's density control. Open a row, then J and K step through the rows in the order shown, with N of M; typing in the field does not."
    >
      <SteppingSpecimen />
    </SpecimenGroup>
  );
}

// -------------------------------------------------------------------------------------------------
// CountPopover

function CountPopoverGroup(): ReactElement {
  return (
    <SpecimenGroup
      title="CountPopover"
      note="12-tables.md section 6. A count that opens the domains behind it: five at most, each with its own count, then the rest. A real zero and an unknown count are plain text."
    >
      <div className="flex flex-col gap-3">
        <SpecimenRow label="Seven domains">
          <CountPopover
            countText="7"
            label="7 domains cited instead, show them"
            title="Cited instead"
            domains={INSTEAD}
            total={7}
            moreHref={anchor('instead-all')}
            context="list"
          />
        </SpecimenRow>
        <SpecimenRow label="Five domains">
          <CountPopover
            countText="5"
            label="5 domains cited instead, show them"
            title="Cited instead, five"
            domains={INSTEAD.slice(0, 5)}
            total={5}
            context="list"
          />
        </SpecimenRow>
        <SpecimenRow label="With share">
          <CountPopover
            countText="7"
            label="7 domains cited instead with their share, show them"
            title="Cited instead, with share"
            domains={INSTEAD_WITH_SHARE}
            total={7}
            moreHref={anchor('instead-share-all')}
            favicon="hide"
            context="list"
          />
        </SpecimenRow>
        <SpecimenRow label="No domains">
          <CountPopover
            countText="0"
            label="0 domains cited instead"
            title="Cited instead"
            domains={[]}
            total={0}
            context="list"
          />
        </SpecimenRow>
        <SpecimenRow label="Unknown count">
          <CountPopover
            countText={EMPTY_VALUE}
            label="Domains cited instead are not known"
            title="Cited instead"
            domains={[]}
            total={null}
            context="list"
          />
        </SpecimenRow>
      </div>
    </SpecimenGroup>
  );
}

// -------------------------------------------------------------------------------------------------
// ChangeFeed and FeedRow

const UP_DETECTABLE: MetricDeltaInput = {
  value: 0.053,
  unit: 'points',
  polarity: 'higher_is_better',
  isDetectable: true,
};
const DOWN_DETECTABLE: MetricDeltaInput = { ...UP_DETECTABLE, value: -0.041 };
const UP_UNDETECTABLE: MetricDeltaInput = { ...UP_DETECTABLE, value: 0.018, isDetectable: false };

function feedItem(
  id: string,
  glyph: LucideIcon,
  text: string,
  at: string,
  change?: FeedChange,
  labels?: { typeLabel: string; sourceLabel: string },
): FeedItem {
  return {
    id,
    glyph,
    text,
    at,
    href: anchor(`event-${id}`),
    change,
    typeLabel: labels?.typeLabel,
    sourceLabel: labels?.sourceLabel,
  };
}

const inGroup = (group: ChangeFeedGroup, item: FeedItem): ChangeFeedItem => ({ ...item, group });

const CHANGES: readonly ChangeFeedItem[] = [
  inGroup(
    'needs_attention',
    feedItem('a1', TriangleAlert, 'Collection failed for 3 prompts on Perplexity', '2026-11-13T11:40:00Z'),
  ),
  inGroup(
    'needs_attention',
    feedItem('a2', TrendingDown, 'Mention rate on ChatGPT fell', '2026-11-13T10:30:00Z', {
      kind: 'metric',
      input: DOWN_DETECTABLE,
    }),
  ),
  inGroup(
    'changes',
    feedItem('c1', TrendingUp, 'Citation rate on Gemini rose', '2026-11-13T09:10:00Z', {
      kind: 'metric',
      input: UP_DETECTABLE,
    }),
  ),
  inGroup(
    'changes',
    feedItem(
      'c2',
      ArrowUpRight,
      'northwind.com entered the top 20 for "best crm for startups"',
      '2026-11-13T08:00:00Z',
      { kind: 'rank', change: { kind: 'entered', positions: null, emphasized: true } },
    ),
  ),
  inGroup(
    'changes',
    feedItem('c3', TrendingUp, 'Share of voice on Google AI Mode moved', '2026-11-12T16:00:00Z', {
      kind: 'metric',
      input: UP_UNDETECTABLE,
    }),
  ),
  inGroup(
    'changes',
    feedItem('c4', ArrowUpRight, 'Ranking for "crm pricing" improved', '2026-11-12T14:00:00Z', {
      kind: 'rank',
      change: { kind: 'improved', positions: 3, emphasized: false },
    }),
  ),
  inGroup('notices', feedItem('n1', Globe, 'New competitor domain seen: zoho.com', '2026-11-12T09:00:00Z')),
  inGroup('notices', feedItem('n2', FileText, 'Prompt set updated: 12 prompts added', '2026-11-11T15:00:00Z')),
  inGroup('notices', feedItem('n3', Bell, 'The weekly report is ready', '2026-11-10T07:00:00Z')),
];

const FEED_TOTAL = 23;
const READY: ChangeFeedState = { status: 'ready', items: CHANGES, total: FEED_TOTAL };
const BASE_ITEMS: readonly ChangeFeedItem[] = CHANGES.filter((item) => ['a1', 'a2', 'c1', 'n1'].includes(item.id));
const ARRIVED_ITEMS: readonly ChangeFeedItem[] = [
  inGroup(
    'changes',
    feedItem('x1', TrendingDown, 'Citation rate on ChatGPT fell', '2026-11-13T11:55:00Z', {
      kind: 'metric',
      input: { ...DOWN_DETECTABLE, value: -0.037 },
    }),
  ),
  inGroup('notices', feedItem('x2', Globe, 'New cited domain seen: pipedrive.com', '2026-11-13T11:50:00Z')),
];

const COMMON = { windowText: 'the last 28 days', timeZone: TIME_ZONE, now: NOW } as const;

type RefetchPhase = 'idle' | 'refetching' | 'done';

/** A refetch keeps the rows and marks the feed busy; when it ends, the new rows are announced politely. */
function RefetchingFeed(): ReactElement {
  const [phase, setPhase] = useState<RefetchPhase>('idle');
  const items = phase === 'done' ? [...BASE_ITEMS, ...ARRIVED_ITEMS] : BASE_ITEMS;
  const state: ChangeFeedState =
    phase === 'refetching'
      ? { status: 'refetching', items, total: FEED_TOTAL }
      : { status: 'ready', items, total: FEED_TOTAL + (phase === 'done' ? ARRIVED_ITEMS.length : 0) };
  const next: Record<RefetchPhase, { label: string; phase: RefetchPhase }> = {
    idle: { label: 'Refetch', phase: 'refetching' },
    refetching: { label: 'Finish refetch', phase: 'done' },
    done: { label: 'Reset', phase: 'idle' },
  };
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button variant="secondary" size="sm" onClick={() => setPhase(next[phase].phase)}>
          {next[phase].label}
        </Button>
      </div>
      <ChangeFeed title="Key changes, refetching" headingLevel={2} state={state} {...COMMON} />
    </div>
  );
}

function ChangeFeedGroupSpecimens(): ReactElement {
  return (
    <SpecimenGroup
      title="ChangeFeed"
      note="23-application-patterns.md section 9.2. Needs attention, Changes and Notices, newest first, eight rows at most; the whole row is its link. A change is coloured only when it is detectable."
    >
      <div className="flex max-w-3xl flex-col gap-4">
        <ChangeFeed title="Key changes" headingLevel={2} state={READY} viewAllHref={anchor('events-all')} {...COMMON} />
        <ChangeFeed
          title="Key changes, partial data"
          headingLevel={2}
          state={READY}
          notice={{
            kind: 'partial',
            text: `Partial data: ${formatInteger(612)} of ${formatInteger(1000)} prompts asked`,
          }}
          viewAllHref={anchor('events-all-partial')}
          {...COMMON}
        />
        <ChangeFeed
          title="Key changes, stale data"
          headingLevel={2}
          state={READY}
          notice={{ kind: 'stale', text: 'Stale: last collected Nov 12, 18:30 UTC' }}
          viewAllHref={anchor('events-all-stale')}
          {...COMMON}
        />
        <ChangeFeed
          title="Key changes, held days"
          headingLevel={2}
          state={READY}
          holdText={`Anomaly hold: ${formatInteger(3)} days are not compared.`}
          viewAllHref={anchor('events-all-held')}
          {...COMMON}
        />
        <RefetchingFeed />
        <ChangeFeed title="Key changes, loading" headingLevel={2} state={{ status: 'loading' }} {...COMMON} />
        <ChangeFeed
          title="Key changes, empty"
          headingLevel={2}
          state={{ status: 'ready', items: [], total: 0 }}
          emptyAction={
            <Button variant="secondary" size="sm">
              Open alert rules
            </Button>
          }
          {...COMMON}
        />
        <ChangeFeed
          title="Key changes, error"
          headingLevel={2}
          state={{
            status: 'error',
            error: {
              title: 'Changes did not load',
              reason: 'The request failed. Try again.',
              errorId: null,
              onRetry: noop,
              retrying: false,
              retryLabel: 'Try again',
            },
          }}
          {...COMMON}
        />
      </div>
    </SpecimenGroup>
  );
}

const FULL_ROWS: readonly FeedItem[] = [
  feedItem(
    'f1',
    TrendingDown,
    'Mention rate on ChatGPT fell',
    '2026-11-13T10:30:00Z',
    {
      kind: 'metric',
      input: DOWN_DETECTABLE,
    },
    { typeLabel: 'Metric change', sourceLabel: 'Prompt run' },
  ),
  feedItem(
    'f2',
    ArrowUpRight,
    'northwind.com entered the top 20 for "best crm for startups"',
    '2026-11-13T08:00:00Z',
    {
      kind: 'rank',
      change: { kind: 'entered', positions: null, emphasized: true },
    },
    { typeLabel: 'Rank move', sourceLabel: 'SERP check' },
  ),
  feedItem(
    'f3',
    ArrowUpRight,
    'Ranking for "crm pricing" improved',
    '2026-11-13T07:00:00Z',
    {
      kind: 'rank',
      change: { kind: 'improved', positions: 3, emphasized: false },
    },
    { typeLabel: 'Rank move', sourceLabel: 'SERP check' },
  ),
  feedItem('f4', Globe, 'New competitor domain seen: zoho.com', '2026-11-13T06:00:00Z', undefined, {
    typeLabel: 'New source',
    sourceLabel: 'Prompt run',
  }),
];

/** A day panel (23 section 9.3) is the consumer's own box around full rows: a labelled group with a list. */
function DayPanel({ title, children }: { title: string; children: ReactNode }): ReactElement {
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} className="overflow-hidden rounded-lg border border-border bg-surface">
      <h3 id={titleId} className="flex h-9 items-center bg-surface-subtle px-4 type-subsection-title">
        {title}
      </h3>
      <ul>{children}</ul>
    </div>
  );
}

function FeedRowGroup(): ReactElement {
  return (
    <SpecimenGroup
      title="FeedRow full"
      note="Time, glyph, sentence, change, type, source and a View link named by the sentence. Type and source appear when the row has room."
    >
      <div className="max-w-5xl">
        <DayPanel title={`Today, ${formatInteger(FULL_ROWS.length)} events`}>
          {FULL_ROWS.map((item) => (
            <FeedRow key={item.id} item={item} form="full" timeZone={TIME_ZONE} now={NOW} />
          ))}
        </DayPanel>
      </div>
    </SpecimenGroup>
  );
}

const LONG_SENTENCE =
  'ChatGPT citation rate fell to 21.6% (143 of 662 answers) in the last 28 days, down from 29.9% (201 of 672)';
const COMPACT_ROWS: readonly FeedItem[] = [
  feedItem('k1', TrendingDown, LONG_SENTENCE, '2026-11-13T11:00:00Z', { kind: 'metric', input: DOWN_DETECTABLE }),
  {
    ...feedItem('k2', Globe, 'Perplexity cited 14 domains it did not cite before', '2026-11-13T11:00:00Z'),
    href: undefined,
  },
  {
    ...feedItem('k3', TrendingUp, 'Mention rate on Gemini rose across 28 days', '2026-11-13T11:00:00Z', {
      kind: 'metric',
      input: UP_DETECTABLE,
    }),
    href: undefined,
    atLabel: '28 days',
  },
];

function FeedRowCompactGroup(): ReactElement {
  return (
    <SpecimenGroup
      title="FeedRow compact"
      note="The sentence wraps to two lines and then ends in an ellipsis, with the full text in its title. A row without an href is plain text: no link, no hover fill, no focus stop. An atLabel replaces the time text for a row that covers a whole window. In a list narrower than 672 px the change and the time sit under the sentence."
    >
      <div className="flex flex-col gap-4">
        <div className="flex max-w-3xl flex-col gap-2">
          <p className="type-label">Wide list, beside the sentence</p>
          <ul className="overflow-hidden rounded-lg border border-border bg-surface">
            {COMPACT_ROWS.map((item) => (
              <FeedRow key={item.id} item={item} form="compact" timeZone={TIME_ZONE} now={NOW} />
            ))}
          </ul>
        </div>
        <div className="flex max-w-md flex-col gap-2">
          <p className="type-label">Narrow list, under the sentence</p>
          <ul className="overflow-hidden rounded-lg border border-border bg-surface">
            {COMPACT_ROWS.map((item) => (
              <FeedRow key={item.id} item={item} form="compact" timeZone={TIME_ZONE} now={NOW} />
            ))}
          </ul>
        </div>
      </div>
    </SpecimenGroup>
  );
}

// -------------------------------------------------------------------------------------------------
// CountTabs

type EventType = 'rank_move' | 'new_source' | 'lost_source';

const TAB_ITEMS: readonly CountTabsItem<EventType>[] = [
  { value: 'rank_move', label: 'Rank moves', countText: '12' },
  { value: 'new_source', label: 'New sources', countText: '7' },
  { value: 'lost_source', label: 'Lost sources', countText: '3' },
];
const TAB_ITEMS_ONE_DISABLED: readonly CountTabsItem<EventType>[] = TAB_ITEMS.map((item) =>
  item.value === 'lost_source' ? { ...item, disabledReason: 'No lost sources in this window' } : item,
);
const TAB_ITEMS_UNKNOWN: readonly CountTabsItem<EventType>[] = TAB_ITEMS.map((item) =>
  item.value === 'new_source' ? { ...item, countText: EMPTY_VALUE } : item,
);

function TabsSpecimen({
  label,
  size,
  initial,
  items,
  allCountText,
}: {
  label: string;
  size: 'sm' | 'md';
  initial: readonly EventType[];
  items: readonly CountTabsItem<EventType>[];
  allCountText: string;
}): ReactElement {
  const [value, setValue] = useState<readonly EventType[]>(initial);
  return (
    <CountTabs
      label={label}
      size={size}
      allLabel="All"
      allCountText={allCountText}
      items={items}
      value={value}
      onValueChange={setValue}
    />
  );
}

function CountTabsGroup(): ReactElement {
  return (
    <SpecimenGroup
      title="CountTabs"
      note="23-application-patterns.md section 9.3. One Tab stop; the arrows, Home and End move. A pressed type is solid and bold, so it is not told apart by colour alone. A disabled type says why."
    >
      <div className="flex flex-col gap-3">
        <SpecimenRow label="Medium, none pressed">
          <TabsSpecimen label="Event types" size="md" initial={[]} items={TAB_ITEMS} allCountText="22" />
        </SpecimenRow>
        <SpecimenRow label="Small">
          <TabsSpecimen label="Event types, small" size="sm" initial={[]} items={TAB_ITEMS} allCountText="22" />
        </SpecimenRow>
        <SpecimenRow label="Two pressed">
          <TabsSpecimen
            label="Event types, two pressed"
            size="md"
            initial={['rank_move', 'new_source']}
            items={TAB_ITEMS}
            allCountText="22"
          />
        </SpecimenRow>
        <SpecimenRow label="One disabled">
          <TabsSpecimen
            label="Event types, one disabled"
            size="md"
            initial={[]}
            items={TAB_ITEMS_ONE_DISABLED}
            allCountText="22"
          />
        </SpecimenRow>
        <SpecimenRow label="Unknown count">
          <TabsSpecimen
            label="Event types, unknown count"
            size="md"
            initial={[]}
            items={TAB_ITEMS_UNKNOWN}
            allCountText={EMPTY_VALUE}
          />
        </SpecimenRow>
      </div>
    </SpecimenGroup>
  );
}

// -------------------------------------------------------------------------------------------------
// Hostile input

function HostileBlock({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="type-subsection-title">{title}</h3>
      {children}
    </div>
  );
}

const HOSTILE_CHIPS: readonly DomainChipProps[] = HOSTILE_HOSTS.map((entry, index) => ({
  domain: displayDomain(entry.host),
  href: anchor(`hostile-chip-${String(index)}`),
}));
const HOSTILE_INSTEAD: readonly CountPopoverDomain[] = HOSTILE_HOSTS.map((entry, index) => ({
  id: `hostile-${String(index)}`,
  host: entry.host,
  registrable: entry.registrable,
  countText: formatInteger(HOSTILE_HOSTS.length - index),
  href: anchor(`hostile-instead-${String(index)}`),
}));
const HOSTILE_FEED: readonly FeedItem[] = HOSTILE_TITLES.map((title, index) =>
  feedItem(`h${String(index)}`, Globe, title, '2026-11-13T11:00:00Z'),
);

function HostileGroup(): ReactElement {
  return (
    <SpecimenGroup
      title="Hostile input"
      note="Hosts, addresses and titles an answer engine or a crawler could send. Each must come out as text; none may run, become a script link or reorder the text around it. The end-to-end test reads this page."
    >
      <div className="flex flex-col gap-6">
        <HostileBlock title="Hosts in DomainCell">
          <div className="flex flex-col gap-2">
            {HOSTILE_HOSTS.map((entry, index) => (
              <Slot key={entry.host} width="w-96">
                <DomainCell
                  host={entry.host}
                  registrable={entry.registrable}
                  favicon="show"
                  href={anchor(`hostile-host-${String(index)}`)}
                  context="list"
                />
              </Slot>
            ))}
          </div>
        </HostileBlock>
        <HostileBlock title="Addresses and titles in URLCell">
          <div className="flex flex-col gap-3">
            {HOSTILE_URLS.map((entry, index) => (
              <div key={entry.name} className="flex flex-col gap-1">
                <p className="type-meta">{entry.name}</p>
                <Slot width="w-96">
                  <URLCell
                    url={entry.url}
                    hostDisplay="show"
                    label="cited page"
                    title={HOSTILE_TITLES[index % HOSTILE_TITLES.length]}
                    context="list"
                  />
                </Slot>
              </div>
            ))}
          </div>
        </HostileBlock>
        <HostileBlock title="Hosts in DomainChipList">
          <DomainChipList label="Hostile cited sources" domains={HOSTILE_CHIPS} />
        </HostileBlock>
        <HostileBlock title="Hosts in CountPopover">
          <div>
            <CountPopover
              countText={formatInteger(HOSTILE_HOSTS.length)}
              label="Hostile domains, show them"
              title="Hostile domains"
              domains={HOSTILE_INSTEAD}
              total={HOSTILE_HOSTS.length}
              context="list"
            />
          </div>
        </HostileBlock>
        <HostileBlock title="Titles in a compact FeedRow">
          <ul className="max-w-3xl overflow-hidden rounded-lg border border-border bg-surface">
            {HOSTILE_FEED.map((item) => (
              <FeedRow key={item.id} item={item} form="compact" timeZone={TIME_ZONE} now={NOW} />
            ))}
          </ul>
        </HostileBlock>
      </div>
    </SpecimenGroup>
  );
}

/** The domain and URL cells, the count popover, the change feed and the inspector stepping of WP-08. */
export function DomainsFeedsSection(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <DomainCellGroup />
      <DomainRoleBadgeGroup />
      <DomainChipGroup />
      <URLCellGroup />
      <TableGroup />
      <CountPopoverGroup />
      <ChangeFeedGroupSpecimens />
      <FeedRowGroup />
      <FeedRowCompactGroup />
      <CountTabsGroup />
      <HostileGroup />
    </div>
  );
}
