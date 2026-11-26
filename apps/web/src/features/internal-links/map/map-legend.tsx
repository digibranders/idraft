'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { MapSwatch } from './map-swatch';
import { Button } from '@/components/ui/button';
import type { MapColourGroup, MapColourMode } from '@/lib/internal-links/map-graph';
import { formatInteger } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface MapLegendProps {
  mode: MapColourMode;
  groups: readonly MapColourGroup[];
  /** Keys of the groups switched off. */
  hidden: ReadonlySet<string>;
  /** The name of a tier group: its code and name, or Untiered. */
  tierName: (group: MapColourGroup) => string;
  onToggle: (key: string) => void;
}

/** The legend of the colours, which is also the switch of each group: a group off leaves the map with its links. */
export function MapLegend({ mode, groups, hidden, tierName, onToggle }: MapLegendProps): ReactElement {
  const t = useTranslations('internalLinks.map');
  const name = (group: MapColourGroup): string => {
    if (mode === 'tier') return tierName(group);
    if (group.key === 'home') return t('sectionHome');
    if (group.key === 'top') return t('sectionTop');
    if (group.key === 'other') return t('sectionOther');
    return group.key;
  };
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-border-subtle px-3 py-2">
      <div
        role="group"
        aria-label={t(mode === 'tier' ? 'tiersShown' : 'sectionsShown')}
        className="flex flex-wrap gap-1"
      >
        {groups.map((group) => {
          const off = hidden.has(group.key);
          return (
            <Button
              key={group.key}
              variant="secondary"
              size="sm"
              aria-pressed={!off}
              onClick={() => onToggle(group.key)}
              // A group on is a plain chip, not a selected one: only a group off looks different
              className={cn(
                'aria-pressed:border-border aria-pressed:bg-surface',
                off && 'bg-surface-subtle text-foreground-tertiary',
              )}
            >
              <MapSwatch colour={group.colour} off={off} />
              {name(group)}
              <span className="num type-meta text-foreground-tertiary">{formatInteger(group.count)}</span>
            </Button>
          );
        })}
      </div>
      <span className="ml-auto type-meta text-foreground-tertiary">{t('size')}</span>
    </div>
  );
}
