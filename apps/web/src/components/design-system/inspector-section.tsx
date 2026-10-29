'use client';

import { ChartLine, History, RefreshCw } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { SpecimenGroup } from './specimen';
import { col } from '@/components/app/data-table/columns';
import { DataTable } from '@/components/app/data-table/data-table';
import { Inspector } from '@/components/app/inspector/inspector';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { InspectorPanel, InspectorTabs } from '@/components/app/inspector/inspector-tabs';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatInteger } from '@/lib/format';
import { DEFAULT_DENSITY, type Density, type SortKey } from '@/lib/tables/table-state';

interface SampleKeyword {
  id: string;
  keyword: string;
  volume: number;
}

const KEYWORDS: SampleKeyword[] = [
  { id: 'kw-1', keyword: 'best crm for startups', volume: 8100 },
  { id: 'kw-2', keyword: 'crm pricing', volume: 5400 },
  { id: 'kw-3', keyword: 'crm for agencies', volume: 1900 },
  { id: 'kw-4', keyword: 'free crm software', volume: 14_800 },
  { id: 'kw-5', keyword: 'hubspot alternatives', volume: 2900 },
];
const COLUMNS = [
  col.keyword<SampleKeyword>('keyword', (row) => row.keyword, { header: 'Keyword' }),
  col.volume<SampleKeyword>('search_volume', (row) => row.volume, { header: 'Volume' }),
];
const DEFAULT_SORT: SortKey[] = [{ id: 'search_volume', desc: true }];
const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'settings', label: 'Settings' },
] as const;
type Tab = (typeof TABS)[number]['value'];
const rowId = (row: SampleKeyword): string => row.id;
const keywordOf = (row: SampleKeyword): string => row.keyword;
const isTab = (value: string): value is Tab => TABS.some((tab) => tab.value === value);

/** A list with its inspector, as Rankings will hold them; the open record is in the URL. */
function InspectorSpecimen(): ReactNode {
  const inspector = useInspector();
  const [sort, setSort] = useState<readonly SortKey[]>(DEFAULT_SORT);
  const [density, setDensity] = useState<Density>(DEFAULT_DENSITY);
  const [search, setSearch] = useState('');
  const ordered = [...KEYWORDS].sort((a, b) => b.volume - a.volume).map(rowId);
  const open = KEYWORDS.find((row) => row.id === inspector.target?.id) ?? null;
  const position = inspector.position(ordered);
  const tab: Tab = isTab(inspector.tab) ? inspector.tab : 'overview';
  return (
    <div className="flex h-120 overflow-hidden rounded-lg border border-border-subtle">
      <InspectorLayout
        inspector={
          open === null ? null : (
            <Inspector
              type="keyword"
              backLabel="Back to the list"
              onClose={inspector.close}
              onStep={(direction) => inspector.step(direction, ordered)}
              header={{
                title: open.keyword,
                typeLabel: 'Keyword',
                typeNoun: 'keyword',
                positionText:
                  position === null ? null : `${formatInteger(position.index + 1)} of ${formatInteger(position.count)}`,
                freshness: 'Updated 12m ago',
                badges: <Badge tone="neutral">United States, Desktop</Badge>,
                frequentAction: (
                  <Button variant="secondary" size="sm" icon={RefreshCw}>
                    Refresh metrics
                  </Button>
                ),
                navigation:
                  position === null
                    ? null
                    : {
                        onPrevious: () => inspector.step('previous', ordered),
                        onNext: () => inspector.step('next', ordered),
                        atFirst: position.index === 0,
                        atLast: position.index === position.count - 1,
                      },
              }}
            >
              <InspectorTabs label="Keyword sections" value={tab} onValueChange={inspector.setTab} items={TABS}>
                <InspectorPanel value="overview">
                  <InspectorSection title="Demand" icon={ChartLine} status="ready">
                    <p className="num type-body">{`${formatInteger(open.volume)} searches a month`}</p>
                  </InspectorSection>
                  <InspectorSection title="Changes" icon={History} status="loading" />
                </InspectorPanel>
                <InspectorPanel value="settings">
                  <InspectorSection
                    title="Settings"
                    icon={History}
                    status="empty"
                    empty={<p className="type-meta">No settings changed yet.</p>}
                  />
                </InspectorPanel>
              </InspectorTabs>
            </Inspector>
          )
        }
      >
        <DataTable<SampleKeyword>
          caption="Keywords with an inspector"
          itemNoun={{ one: 'keyword', other: 'keywords' }}
          columns={COLUMNS}
          getRowId={rowId}
          rows={KEYWORDS}
          total={KEYWORDS.length}
          sort={sort}
          onSortChange={setSort}
          defaultSort={DEFAULT_SORT}
          density={density}
          onDensityChange={setDensity}
          columnState={{ visible: null, onChange: () => undefined }}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search keywords"
          searchText={keywordOf}
          rowName={keywordOf}
          onRowOpen={(row) => inspector.open({ type: 'keyword', id: row.id })}
          activeRowId={inspector.target?.id ?? null}
          status="ready"
          errorState={null}
          emptyState={null}
          filteredEmptyState={<p className="p-4 type-meta">No keywords match.</p>}
        />
      </InspectorLayout>
    </div>
  );
}

export function InspectorPreviewSection(): ReactNode {
  return (
    <SpecimenGroup
      title="Inspector"
      note="16 section 2. Open a row: the inspector docks beside the list when the main column keeps 720 px, lays over it otherwise, and is a sheet below 768 px. J and K step, Escape closes and returns to the row, the left edge resizes (arrows, Home, End, Enter), and the record and tab are in the URL."
    >
      <InspectorSpecimen />
    </SpecimenGroup>
  );
}
