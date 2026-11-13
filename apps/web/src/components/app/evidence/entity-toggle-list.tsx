'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { EntityColorIndex } from './evidence-highlight';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

export interface EntityToggleItem {
  entityId: string;
  name: string;
  /** The own brand is always color 1, whatever its role row says. */
  own: boolean;
  /** `null` past the sixth entity: `chart-other`, with a dashed edge, as its marks in the text. */
  colorIndex: EntityColorIndex | null;
  /** How many marks the entity has in the answer text. */
  spanCount: number;
  /** Its marks are drawn. */
  visible: boolean;
}

export interface EntityToggleListProps {
  items: readonly EntityToggleItem[];
  onToggle: (entityId: string, visible: boolean) => void;
}

const SWATCH: Readonly<Record<EntityColorIndex | 'other', string>> = {
  1: cn('bg-chart-1'),
  2: cn('bg-chart-2'),
  3: cn('bg-chart-3'),
  4: cn('bg-chart-4'),
  5: cn('bg-chart-5'),
  6: cn('bg-chart-6'),
  other: cn('border border-dashed border-chart-other bg-chart-other'),
};

const swatchOf = (item: EntityToggleItem): string => SWATCH[item.own ? 1 : (item.colorIndex ?? 'other')];

/**
 * The entities an answer's text marks, each a checkbox with its color and its number of marks; unchecking one takes
 * its marks out of the text (23-application-patterns.md section 5.1, inventory 15.15). A group named Entities. The
 * names are the project's own words, and are only ever shown as text.
 */
export function EntityToggleList({ items, onToggle }: EntityToggleListProps): ReactElement | null {
  const t = useTranslations('evidence.entityToggle');
  if (items.length === 0) return null;
  return (
    <fieldset data-slot="entity-toggle-list" className="flex min-w-0 flex-col gap-1">
      <legend className="type-label">{t('legend')}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {items.map((item) => (
          <div key={item.entityId} data-slot="entity-toggle" className="flex min-w-0 items-start gap-2">
            <span data-swatch="" aria-hidden="true" className={cn('mt-2 size-3 shrink-0 rounded-xs', swatchOf(item))} />
            <Checkbox
              checked={item.visible}
              label={item.name}
              description={t('spanCount', { count: item.spanCount })}
              onCheckedChange={(checked) => onToggle(item.entityId, checked)}
              className="wrap-anywhere"
            />
          </div>
        ))}
      </div>
    </fieldset>
  );
}
