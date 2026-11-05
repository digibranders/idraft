'use client';

import { ArrowDownUp, Layers, List } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, type ReactElement } from 'react';

import { GROUP_SORTS, type GroupSortId } from './use-grouped-table';
import type { KeywordsView } from './view-columns';
import { IconButton } from '@/components/ui/icon-button';
import { Menu } from '@/components/ui/menu';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Tooltip } from '@/components/ui/tooltip';

export interface ViewSwitchProps {
  view: KeywordsView;
  onViewChange: (view: KeywordsView) => void;
  /** By group cannot be chosen: the list is too long to read whole (server mode). */
  groupsDisabled: boolean;
  sort: GroupSortId;
  onSortChange: (sort: GroupSortId) => void;
}

const SORT_IDS = Object.keys(GROUP_SORTS) as GroupSortId[];

/**
 * The view switch of the Keywords table, at the start of its toolbar: By group or All keywords, and in By
 * group the order of the groups. When By group is off its reason is the switch's description, and a tooltip.
 */
export function ViewSwitch({ view, onViewChange, groupsDisabled, sort, onSortChange }: ViewSwitchProps): ReactElement {
  const t = useTranslations('rankings.grouped');
  const reasonId = useId();
  const control = (
    <SegmentedControl<KeywordsView>
      semantics="view"
      label={t('viewLabel')}
      value={view}
      onValueChange={onViewChange}
      size="sm"
      aria-describedby={groupsDisabled ? reasonId : undefined}
      items={[
        { value: 'groups', label: t('byGroup'), icon: Layers, disabled: groupsDisabled },
        { value: 'flat', label: t('allKeywords'), icon: List },
      ]}
    />
  );
  return (
    <div className="flex shrink-0 items-center gap-1">
      {groupsDisabled ? (
        <>
          <span id={reasonId} className="sr-only">
            {t('needsClientMode')}
          </span>
          <Tooltip content={t('needsClientMode')} purpose="label">
            <span className="inline-flex">{control}</span>
          </Tooltip>
        </>
      ) : (
        control
      )}
      {view === 'groups' ? (
        <Menu
          trigger={<IconButton icon={ArrowDownUp} variant="ghost" label={t('sortLabel')} />}
          items={SORT_IDS.map((id) => ({
            id,
            kind: 'radio' as const,
            group: t('sortLabel'),
            label: t(`sort.${id}`),
            checked: sort === id,
            onSelect: () => onSortChange(id),
          }))}
        />
      ) : null}
    </div>
  );
}
