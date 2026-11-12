'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { announce } from '@/lib/a11y/announcer';
import { seriesColorVar, type SeriesRole } from '@/lib/charts/category-chart';

export type LegendSymbol = 'circle' | 'rect' | 'triangle' | 'diamond';
export type LegendSwatch = 'dot' | 'line' | { marker: LegendSymbol };

export interface LegendItem {
  id: string;
  name: string;
  role: SeriesRole;
  /** Left out: `line` for reference and other roles, `dot` otherwise. */
  swatch?: LegendSwatch | undefined;
  /** Shown; `false` reads as turned off. */
  pressed: boolean;
}

export interface ChartLegendProps {
  /** The chart's title: the list is named "Series in {title}" (`chart.legend`). */
  title: string;
  items: readonly LegendItem[];
  /** Given: each item is a toggle button with `aria-pressed`, and a change is announced. */
  onToggle?: ((id: string) => void) | undefined;
}

/** The 8 px marker shapes of 15-data-visualization.md section 2, in a 8 x 8 box. */
const MARKER_PATH: Readonly<Record<LegendSymbol, string>> = {
  circle: 'M4 0a4 4 0 1 0 0 8a4 4 0 1 0 0-8z',
  rect: 'M0 0h8v8H0z',
  triangle: 'M4 0L8 8H0z',
  diamond: 'M4 0L8 4L4 8L0 4z',
};

const DASHED_ROLES: ReadonlySet<SeriesRole['kind']> = new Set(['reference', 'other']);

function defaultSwatch(role: SeriesRole): LegendSwatch {
  return DASHED_ROLES.has(role.kind) ? 'line' : 'dot';
}

function Swatch({ role, swatch }: { role: SeriesRole; swatch: LegendSwatch }): ReactElement {
  const color = seriesColorVar(role);
  if (swatch === 'dot') {
    return <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: color }} />;
  }
  if (swatch === 'line') {
    // A dashed series shows a 12 x 2 px line in its dash, not a dot (15 section 2)
    return (
      <span
        aria-hidden="true"
        className={DASHED_ROLES.has(role.kind) ? 'w-3 border-t-2 border-dashed' : 'w-3 border-t-2'}
        style={{ borderColor: color }}
      />
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 8 8" width={8} height={8} fill={color} className="shrink-0">
      <path d={MARKER_PATH[swatch.marker]} />
    </svg>
  );
}

/** The legend of a chart, in React and not in the canvas (DS 15 section 2). Renders nothing for fewer than two items. */
export function ChartLegend({ title, items, onToggle }: ChartLegendProps): ReactElement | null {
  const t = useTranslations('chart');
  if (items.length < 2) return null;
  const toggle = (item: LegendItem): void => {
    if (onToggle === undefined) return;
    onToggle(item.id);
    announce(t(item.pressed ? 'seriesHidden' : 'seriesShown', { name: item.name }));
  };
  return (
    <ul aria-label={t('legend', { title })} className="flex flex-wrap items-center gap-3">
      {items.map((item) => {
        const content = (
          <>
            <Swatch role={item.role} swatch={item.swatch ?? defaultSwatch(item.role)} />
            {item.name}
          </>
        );
        return (
          <li key={item.id}>
            {onToggle === undefined ? (
              <span
                className={
                  item.pressed
                    ? 'inline-flex items-center gap-1.5 rounded-xs type-label'
                    : 'inline-flex items-center gap-1.5 rounded-xs type-label text-foreground-tertiary line-through'
                }
              >
                {content}
              </span>
            ) : (
              <button
                type="button"
                aria-pressed={item.pressed}
                onClick={() => toggle(item)}
                className="inline-flex items-center gap-1.5 rounded-xs type-label outline-none focus-visible:focus-ring aria-[pressed=false]:text-foreground-tertiary aria-[pressed=false]:line-through"
              >
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
