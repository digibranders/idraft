'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { chosenGroup, groupChoices, type GroupChoice } from './group-options';
import { buttonVariants } from '@/components/ui/button-variants';
import { Combobox } from '@/components/ui/combobox';
import { Icon } from '@/components/ui/icon';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';
import { cn } from '@/lib/utils';

export interface GroupSelectProps {
  /** Every topic of the project, depth first. */
  tree: readonly NamedTerm[];
  /** The topic term id chosen, or `null` for All groups. */
  selected: string | null;
  onChange: (termId: string | null) => void;
  className?: string | undefined;
}

/**
 * The Group of the page: All groups or one group, one flat list found by typing. The button has the width of the
 * Platform select and keeps it whatever the choice is, so nothing beside it moves.
 */
export function GroupSelect({ tree, selected, onChange, className }: GroupSelectProps): ReactElement {
  const t = useTranslations('aiOverview.shell');
  const choices = useMemo(() => groupChoices(tree, t('allGroups')), [tree, t]);
  const current = chosenGroup(choices, selected);
  return (
    <Combobox<GroupChoice>
      value={current}
      onValueChange={(next) => {
        if (next !== null) onChange(next.termId);
      }}
      items={choices}
      itemToString={(choice) => choice.label}
      itemKey={(choice) => choice.termId ?? ''}
      emptyText={(query) => t('groupEmpty', { query })}
      placeholder={t('groupSearch')}
      clearLabel={t('groupClear')}
      openLabel={t('groupOpen')}
      trigger={
        <button
          type="button"
          className={cn(buttonVariants({ variant: 'secondary' }), 'justify-between type-body', className)}
        >
          <span className="min-w-0 truncate">{current.label}</span>
          <Icon icon={ChevronDown} size="sm" className="shrink-0 text-foreground-tertiary" />
        </button>
      }
      triggerLabel={t('groupLabel', { group: current.label })}
    />
  );
}
