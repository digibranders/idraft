'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { comparisonWindow } from '../data/overview-queries';
import type { OverviewScope } from './scope-model';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { formatDateRange } from '@/lib/format';

export interface CompareSelectProps {
  scope: OverviewScope;
  onCompareChange: (compare: boolean) => void;
}

/**
 * The comparison of the page: "vs previous period" (the default, as many days just before the window) or none. The
 * head of the menu writes both windows out, so the person never has to work out what is being compared. A window
 * whose previous days start before the year 2000 has nothing to compare with: that choice says so and stays off.
 */
export function CompareSelect({ scope, onCompareChange }: CompareSelectProps): ReactElement {
  const t = useTranslations('aiOverview.scope');
  // Whether there is a window to compare with, whatever the choice is now: the choice must stay possible once off
  const available = comparisonWindow({ ...scope, compare: true });
  const compared = scope.compare && available !== null;
  const previous = compared ? available : null;
  const current = formatDateRange(scope.range.from, scope.range.to);
  // A radio item leaves its menu open; choosing the comparison is the whole job of this one, so it closes
  const [open, setOpen] = useState(false);
  const choose = (next: boolean): void => {
    onCompareChange(next);
    setOpen(false);
  };
  const items: MenuItemDef[] = [
    {
      id: 'previous',
      label: t('comparePrevious'),
      kind: 'radio',
      checked: compared,
      ...(available === null ? { disabledReason: t('compareUnavailable') } : {}),
      onSelect: () => choose(true),
    },
    { id: 'off', label: t('compareOff'), kind: 'radio', checked: !compared, onSelect: () => choose(false) },
  ];
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      aria-label={t('compare')}
      items={items}
      header={
        <p className="type-meta">
          {previous !== null
            ? t('compareWindow', { current, previous: formatDateRange(previous.from, previous.to) })
            : t('compareWindowOff', { current })}
        </p>
      }
      trigger={
        <Button variant="secondary" className="type-body">
          {compared ? t('comparePrevious') : t('compareOff')}
          <Icon icon={ChevronDown} size="sm" className="text-foreground-tertiary" />
        </Button>
      }
    />
  );
}
