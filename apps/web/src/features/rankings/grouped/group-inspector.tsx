'use client';

import { ChartColumn, ListOrdered } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { keywordsInOrder, type GroupData } from './grouped-rows';
import type { Device, PairedRow } from '../keyword-pairs';
import { RankCellView } from '../rank-cells';
import { rankDisplayOf } from '../rank-columns';
import { Inspector } from '@/components/app/inspector/inspector';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { InspectorBody } from '@/components/app/inspector/inspector-tabs';
import { KeyValues, type KeyValue } from '@/components/app/inspector/key-values';
import { EmptyState } from '@/components/app/status/empty-state';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Button } from '@/components/ui/button';
import type { MenuItemDef } from '@/components/ui/menu';
import { formatInteger, formatRelative, rowChangeDisplay } from '@/lib/format';

export interface GroupInspectorProps {
  /** The group's keywords in view (device, country, filters and search applied); `null` when none is. */
  group: GroupData | null;
  /** The group's path, or "Not grouped"; shown while the group has no keyword in view too. */
  label: string;
  /** The device whose ranks the figures count. */
  device: Device;
  /** The project's time zone, for when the group was last checked. */
  timeZone: string;
  onClose: () => void;
  /** Switches the inspector to one of the group's keywords. */
  onOpenKeyword: (trackedKeywordId: string) => void;
  /** Check now, the group's frequent command. */
  frequentAction: ReactNode;
  /** Add keywords, Rename group and Delete group, as the person may. */
  moreActions: readonly MenuItemDef[];
}

/**
 * The drawer of one keyword group (16-drawers-dialogs-popovers.md section 2; the mock's group drawer): its
 * path and keyword count in the header with Check now, the figures of the device shown, and its keywords with
 * their rank, each of which opens in the inspector. The group's other actions are in the More menu.
 */
export function GroupInspector({
  group,
  label,
  device,
  timeZone,
  onClose,
  onOpenKeyword,
  frequentAction,
  moreActions,
}: GroupInspectorProps): ReactElement {
  const t = useTranslations('rankings.groupInspector');
  const grouped = useTranslations('rankings.grouped');
  const keywordInspector = useTranslations('rankings.inspector');
  const devices = useTranslations('rankings.filters.devices');
  const size = group?.measures.size ?? 0;

  return (
    <Inspector
      type="group"
      backLabel={keywordInspector('back')}
      onClose={onClose}
      header={{
        title: label,
        typeLabel: t('type'),
        typeNoun: t('noun'),
        positionText: grouped('keywordCount', { count: size }),
        frequentAction: group === null ? null : frequentAction,
        moreActions,
      }}
    >
      <InspectorBody>
        {group === null ? (
          <EmptyState variant="inline" title={t('emptyTitle')} reason={t('emptyReason')} headingLevel={3} />
        ) : (
          <>
            <InspectorSection title={t('figures', { device: devices(device) })} icon={ChartColumn} status="ready">
              <GroupFigures group={group} timeZone={timeZone} />
            </InspectorSection>
            <InspectorSection title={t('list')} icon={ListOrdered} status="ready">
              <GroupKeywords group={group} timeZone={timeZone} onOpenKeyword={onOpenKeyword} />
            </InspectorSection>
          </>
        )}
      </InspectorBody>
    </Inspector>
  );
}

function GroupFigures({ group, timeZone }: { group: GroupData; timeZone: string }): ReactElement {
  const t = useTranslations('rankings.groupInspector');
  const { measures } = group;
  const share = (count: number): ReactNode => (
    <span className="num">{t('ofKeywords', { count, total: measures.size })}</span>
  );
  const facts: KeyValue[] = [
    { id: 'keywords', label: t('keywords'), value: <span className="num">{formatInteger(measures.size)}</span> },
    { id: 'top3', label: t('top3'), value: share(measures.top3) },
    { id: 'top10', label: t('top10'), value: share(measures.top10) },
    { id: 'top20', label: t('top20'), value: share(measures.top20) },
    { id: 'volume', label: t('volume'), value: <span className="num">{formatInteger(measures.volume)}</span> },
    { id: 'cited', label: t('cited'), value: share(measures.cited) },
    {
      id: 'updated',
      label: t('updated'),
      value:
        measures.updated === null ? (
          <span className="text-foreground-tertiary">{t('notChecked')}</span>
        ) : (
          formatRelative(measures.updated, timeZone)
        ),
    },
  ];
  return <KeyValues items={facts} />;
}

function GroupKeywords({
  group,
  timeZone,
  onOpenKeyword,
}: {
  group: GroupData;
  timeZone: string;
  onOpenKeyword: (trackedKeywordId: string) => void;
}): ReactElement {
  const t = useTranslations('rankings.groupInspector');
  const columns: PlainColumn<PairedRow>[] = [
    {
      id: 'keyword',
      header: t('keyword'),
      wrap: true,
      cell: (row) => (
        <Button
          variant="link"
          size="sm"
          aria-label={t('openKeyword', { keyword: row.keyword.text })}
          onClick={() => onOpenKeyword(row.tracked_keyword_id)}
        >
          {row.keyword.text}
        </Button>
      ),
    },
    {
      id: 'rank',
      header: t('rank'),
      cell: (row) => (
        <RankCellView
          display={rankDisplayOf(row)}
          change={rowChangeDisplay(row.state.current, row.state.change)}
          timeZone={timeZone}
        />
      ),
    },
  ];
  return (
    <PlainTable<PairedRow>
      caption={t('list')}
      rows={keywordsInOrder(group)}
      rowKey={(row) => row.tracked_keyword_id}
      status="ready"
      errorState={null}
      emptyText={t('emptyTitle')}
      columns={columns}
    />
  );
}
