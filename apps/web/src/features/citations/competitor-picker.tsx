'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { TrackedCompetitor } from './board-reads';
import { MAX_COMPETITORS } from './board-state';
import { EntitySwatch } from '@/components/app/entity/entity-swatch';
import { Checkbox } from '@/components/ui/checkbox';
import { Icon } from '@/components/ui/icon';
import { inputVariants } from '@/components/ui/input-variants';
import { Popover } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface CompetitorPickerProps {
  tracked: readonly TrackedCompetitor[];
  chosen: readonly string[];
  onChange: (ids: readonly string[]) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Competitors (C 118 to 173): a multi-select of the tracked competitors, at most five, the columns of the gap analysis.
 * The popover stays open after a change; its count and the disabled rows follow the choice, which keeps the tracked
 * order so the columns never jump (C 156 to 157).
 */
export function CompetitorPicker({
  tracked,
  chosen,
  onChange,
  open,
  onOpenChange,
}: CompetitorPickerProps): ReactElement {
  const t = useTranslations('citations');
  const names = chosen.flatMap((id) => tracked.find((competitor) => competitor.id === id)?.name ?? []);
  const shown =
    names.length === 0
      ? t('toolbar.competitorsNone')
      : names.length <= 2
        ? names.join(', ')
        : t('toolbar.competitorsMore', { names: names.slice(0, 2).join(', '), count: names.length - 2 });
  const full = chosen.length >= MAX_COMPETITORS;
  const toggle = (id: string, on: boolean): void => {
    const next = on ? [...chosen, id] : chosen.filter((value) => value !== id);
    onChange(tracked.map((competitor) => competitor.id).filter((value) => next.includes(value)));
  };
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      aria-label={t('competitorPicker.label')}
      width="narrow"
      padding="menu"
      align="start"
      trigger={
        <button
          type="button"
          aria-label={
            names.length === 0
              ? t('toolbar.competitorsLabelNone')
              : t('toolbar.competitorsLabel', { names: names.join(', ') })
          }
          className={cn(
            inputVariants({ variant: 'outline', size: 'md' }),
            'flex w-full max-w-full min-w-0 items-center gap-2 text-left whitespace-nowrap hover:bg-surface-hover aria-expanded:bg-surface-hover sm:w-60',
          )}
        >
          <span className="text-foreground-secondary">{t('toolbar.competitors')}</span>
          <span className="truncate">{shown}</span>
          <Icon icon={ChevronDown} size="sm" className="ml-auto shrink-0 text-foreground-tertiary" />
        </button>
      }
    >
      <div className="flex items-center gap-2 px-2 pt-1.5 pb-2">
        <span className="type-label text-foreground-secondary">{t('competitorPicker.head')}</span>
        <span className="ml-auto num type-meta">
          {t('competitorPicker.count', { count: chosen.length, max: MAX_COMPETITORS })}
        </span>
      </div>
      <div className="flex flex-col">
        {tracked.map((competitor) => {
          const on = chosen.includes(competitor.id);
          const disabled = !on && full;
          return (
            <div
              key={competitor.id}
              className={cn(
                'flex h-control-sm items-center gap-2 rounded-md px-2 type-body text-foreground',
                disabled ? 'opacity-50' : 'hover:bg-surface-hover',
              )}
            >
              <Checkbox
                checked={on}
                disabled={disabled}
                label={competitor.name}
                labelDisplay="visually-hidden"
                onCheckedChange={(next) => toggle(competitor.id, next)}
              />
              <EntitySwatch colorIndex={competitor.colorIndex} own={false} shape="dot" />
              <span aria-hidden="true" className="truncate">
                {competitor.name}
              </span>
              {competitor.domain === null ? null : <span className="ml-auto type-meta">{competitor.domain}</span>}
            </div>
          );
        })}
      </div>
      <p className="mt-1 border-t border-border-subtle px-2 pt-2 pb-1.5 type-meta">
        {t('competitorPicker.foot', { max: MAX_COMPETITORS })}
      </p>
    </Popover>
  );
}
