'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { MAX_CHART_COMPETITORS, type ChartLayer } from './detail-url-state';
import { WINDOW_KEYS, type DetailWindow } from './detail-window';
import { competitorPalette } from '../rank-history/rank-history-model';
import { EntitySwatch } from '@/components/app/entity/entity-swatch';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Popover } from '@/components/ui/popover';
import { Select } from '@/components/ui/select';

/** A competitor the chart can draw. */
export interface CompetitorChoice {
  id: string;
  name: string;
  /** The entity's chart colour, as the project's entities give it. */
  colorIndex: number | null;
}

/** The window of the chart. Also shown where the window leaves nothing to draw, so a longer one can be chosen. */
export function WindowSelect({
  win,
  onWinChange,
}: {
  win: DetailWindow;
  onWinChange: (win: DetailWindow) => void;
}): ReactElement {
  const t = useTranslations('keywordDetail.history');
  const windows = WINDOW_KEYS.map((value) => ({ value, label: t(`window.${value}`) }));
  return (
    <Field width="short" className="w-36 sm:w-40">
      <FieldLabel display="visually-hidden">{t('window.label')}</FieldLabel>
      <Select<DetailWindow>
        size="sm"
        value={win}
        onValueChange={onWinChange}
        placeholder={t('window.label')}
        options={windows}
      />
    </Field>
  );
}

/**
 * The competitors drawn, in a popover so the toolbar stays one row: the chosen ones first, in the order
 * chosen (the legend's order), then the rest by name. At the limit an unchosen one is disabled and says why.
 */
function CompetitorPicker({
  competitors,
  chosen,
  onChosenChange,
}: {
  competitors: readonly CompetitorChoice[];
  chosen: readonly CompetitorChoice[];
  onChosenChange: (ids: string[]) => void;
}): ReactElement {
  const t = useTranslations('keywordDetail.history.competitors');
  const atLimit = chosen.length >= MAX_CHART_COMPETITORS;
  const chosenIds = new Set(chosen.map((choice) => choice.id));
  // The colours the chart gives them: the same function, over the same competitors
  const palette = competitorPalette(competitors.map((choice) => ({ id: choice.id, colorIndex: choice.colorIndex })));
  const rows = [...chosen, ...competitors.filter((choice) => !chosenIds.has(choice.id))];
  return (
    <Popover
      trigger={
        <Button size="sm" variant="secondary">
          {t('button', { count: chosen.length })}
        </Button>
      }
      title={t('label')}
      width="min"
    >
      <ul aria-label={t('label')} className="flex flex-col gap-1">
        {rows.map((choice) => {
          const on = chosenIds.has(choice.id);
          return (
            <li key={choice.id} className="flex min-w-0 items-start gap-2">
              <span className="flex h-6 items-center">
                <EntitySwatch colorIndex={palette.get(choice.id) ?? null} own={false} />
              </span>
              <Checkbox
                checked={on}
                label={choice.name}
                disabled={!on && atLimit}
                description={!on && atLimit ? t('limit') : undefined}
                onCheckedChange={(next) =>
                  onChosenChange(
                    next
                      ? [...chosen.map((entry) => entry.id), choice.id]
                      : chosen.flatMap((entry) => (entry.id === choice.id ? [] : [entry.id])),
                  )
                }
              />
            </li>
          );
        })}
      </ul>
    </Popover>
  );
}

export interface RankHistoryControlsProps {
  win: DetailWindow;
  onWinChange: (win: DetailWindow) => void;
  /** The competitors the history was asked for. */
  competitors: readonly CompetitorChoice[];
  /** The ones drawn, in the order chosen. */
  chosen: readonly CompetitorChoice[];
  onChosenChange: (ids: string[]) => void;
  layers: readonly ChartLayer[];
  onToggleLayer: (layer: ChartLayer) => void;
  /** Own checks the chart leaves out while deep checks are off. */
  deepHidden: number;
}

/**
 * The controls of the chart (24-page-templates.md section 9.4), laid in `ChartFrame`'s toolbar row with its
 * Table toggle: the window, the competitors drawn (five at most) and the layers on top of the organic rank.
 * Tab order is the reading order.
 */
export function RankHistoryControls({
  win,
  onWinChange,
  competitors,
  chosen,
  onChosenChange,
  layers,
  onToggleLayer,
  deepHidden,
}: RankHistoryControlsProps): ReactElement {
  const t = useTranslations('keywordDetail.history');
  const toggle = (layer: ChartLayer, label: string): ReactElement => (
    <Button size="sm" variant="ghost" aria-pressed={layers.includes(layer)} onClick={() => onToggleLayer(layer)}>
      {label}
    </Button>
  );
  return (
    <>
      <WindowSelect win={win} onWinChange={onWinChange} />
      <CompetitorPicker competitors={competitors} chosen={chosen} onChosenChange={onChosenChange} />
      <div role="group" aria-label={t('layers.label')} className="flex items-center gap-1">
        {toggle('absolute', t('layers.absolute'))}
        {toggle(
          'deep',
          !layers.includes('deep') && deepHidden > 0 ? t('layers.deepHidden', { count: deepHidden }) : t('layers.deep'),
        )}
      </div>
    </>
  );
}
