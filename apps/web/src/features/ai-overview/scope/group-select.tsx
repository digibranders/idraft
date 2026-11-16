'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { chosenGroup, groupChoices, type GroupChoice } from './group-options';
import { buttonVariants } from '@/components/ui/button-variants';
import { Combobox } from '@/components/ui/combobox';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';
import { cn } from '@/lib/utils';

export interface GroupSelectProps {
  /** Every topic of the project, depth first. */
  tree: readonly NamedTerm[];
  /** The trees are loading or failed: the name of a group of a link is not known yet. */
  pending: boolean;
  /** The topic term id chosen, or `null` for All groups. */
  selected: string | null;
  onChange: (termId: string | null) => void;
  className?: string | undefined;
}

/**
 * The Group of the page: All groups or one group, one flat list found by typing. The button has the width of the
 * Platform select and keeps it whatever the choice is, so nothing beside it moves.
 */
export function GroupSelect({ tree, pending, selected, onChange, className }: GroupSelectProps): ReactElement {
  const t = useTranslations('aiOverview.shell');
  const choices = useMemo(() => groupChoices(tree, t('allGroups')), [tree, t]);
  const current = chosenGroup(choices, selected, t('groupUnknown'));
  // A group of a link whose name has not arrived is a placeholder, not "All groups" and not an id
  const unnamed = pending && selected !== null && !choices.some((choice) => choice.termId === selected);
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
          className={cn(buttonVariants({ variant: 'secondary' }), 'justify-start type-body', className)}
        >
          <span className="shrink-0 text-foreground-secondary">{t('group')}:</span>
          {unnamed ? (
            <Skeleton shape="text-14" className="w-24" />
          ) : (
            <span className="min-w-0 flex-1 truncate text-left">{current.label}</span>
          )}
          <Icon icon={ChevronDown} size="sm" className="shrink-0 text-foreground-muted" />
        </button>
      }
      triggerLabel={t('groupLabel', { group: unnamed ? t('groupLoading') : current.label })}
    />
  );
}
