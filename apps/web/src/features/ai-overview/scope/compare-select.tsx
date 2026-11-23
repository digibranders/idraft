'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { comparedWindowOf, type DateWindow, type OverviewScope } from './scope-model';
import { isBeforeFirstDay } from '@/components/app/date-range/business-date';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import type { CompareKind } from '@/lib/compare/compare-model';
import { formatDateRange } from '@/lib/format';

/** What the select writes: the comparison off, or on with what it is with. */
export type CompareChoice = { compare: false } | { compare: true; compareKind: CompareKind };

export interface CompareSelectProps {
  scope: OverviewScope;
  onCompareChange: (choice: CompareChoice) => void;
}

/**
 * The comparison of the page: "vs previous period" (the default, as many days just before the window), "vs same
 * period last year" (the same dates a year earlier) or none. The head of the menu writes both windows out, so the
 * person never has to work out what is being compared. A choice whose window starts before the year 2000 has nothing
 * to compare with: it says so and stays off.
 */
export function CompareSelect({ scope, onCompareChange }: CompareSelectProps): ReactElement {
  const t = useTranslations('aiOverview.scope');
  const tShell = useTranslations('aiOverview.shell');
  // Whether there is a window to compare with, whatever the choice is now: a choice must stay possible once off
  const windowOf = (kind: CompareKind): DateWindow | null => {
    const found = comparedWindowOf(kind, scope.range.from, scope.range.to);
    return isBeforeFirstDay(found.from) ? null : found;
  };
  const previous = windowOf('previous_period');
  const year = windowOf('previous_year');
  const previousChecked = scope.compare && scope.compareKind === 'previous_period' && previous !== null;
  const yearChecked = scope.compare && scope.compareKind === 'previous_year' && year !== null;
  const compared = previousChecked || yearChecked;
  const shown = yearChecked ? year : previousChecked ? previous : null;
  const label = yearChecked ? t('compareYear') : previousChecked ? t('comparePrevious') : t('compareOff');
  const current = formatDateRange(scope.range.from, scope.range.to);
  // A radio item leaves its menu open; choosing the comparison is the whole job of this one, so it closes
  const [open, setOpen] = useState(false);
  const choose = (choice: CompareChoice): void => {
    onCompareChange(choice);
    setOpen(false);
  };
  const items: MenuItemDef[] = [
    {
      id: 'previous',
      label: t('comparePrevious'),
      kind: 'radio',
      checked: previousChecked,
      ...(previous === null ? { disabledReason: t('compareUnavailable') } : {}),
      onSelect: () => choose({ compare: true, compareKind: 'previous_period' }),
    },
    {
      id: 'year',
      label: t('compareYear'),
      kind: 'radio',
      checked: yearChecked,
      ...(year === null ? { disabledReason: t('compareUnavailableYear') } : {}),
      onSelect: () => choose({ compare: true, compareKind: 'previous_year' }),
    },
    {
      id: 'off',
      label: t('compareOff'),
      kind: 'radio',
      checked: !compared,
      onSelect: () => choose({ compare: false }),
    },
  ];
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      aria-label={t('compare')}
      items={items}
      header={
        <p className="type-meta">
          {shown !== null
            ? t('compareWindow', { current, previous: formatDateRange(shown.from, shown.to) })
            : t('compareWindowOff', { current })}
        </p>
      }
      trigger={
        <Button
          variant="secondary"
          aria-label={tShell('compareLabel', { value: label })}
          className="w-full justify-start type-body sm:w-80"
        >
          <span className="shrink-0 text-foreground-secondary">{tShell('compare')}:</span>
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <Icon icon={ChevronDown} size="sm" className="shrink-0 text-foreground-muted" />
        </Button>
      }
    />
  );
}
