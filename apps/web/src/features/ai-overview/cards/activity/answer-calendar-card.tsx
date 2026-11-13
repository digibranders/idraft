'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { calendarWeeks } from './model/calendar-model';
import { CalendarGrid } from './parts/calendar-grid';
import { DayTable, useDailyCsv } from './parts/daily-table';
import { useDailyCard } from './parts/use-daily-card';
import { useCardExport } from '../engines/use-card-seams';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import type { CardProps } from '@/features/layouts';
import { formatInteger } from '@/lib/format';

/**
 * CH-20: the days of one engine as a calendar, weekdays as rows and weeks as columns. A cell is filled by the valid
 * answers over the scheduled ones and carries the failure count and the budget-blocked glyph; a day with no known
 * schedule is the surface colour and says Schedule unknown. One engine at a time: engines are never added together.
 */
export default function AnswerCalendarCard({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.activity.calendar');
  const daily = useTranslations('aiOverview.activity.daily');
  const card = useDailyCard(live, t('subject'));
  const weeks = useMemo(() => calendarWeeks(card.days), [card.days]);
  const toCsv = useDailyCsv();
  const csv = toCsv(card.allRunDays);
  useCardExport(item.id, () => (card.shown ? { id: item.id, ...csv } : null));

  const summary = card.shown
    ? t('summary', {
        engine: card.engineName,
        runDays: card.runDays.length,
        valid: formatInteger(card.totals.valid),
        answers: formatInteger(card.totals.answers),
      })
    : t('title');
  return (
    <ChartFrame
      kind="html"
      variant="panel"
      height={240}
      title={t('title')}
      meta={card.meta}
      summary={summary}
      controls={card.controls}
      footnote={<p>{daily('footnote')}</p>}
      body={<CalendarGrid caption={t('caption', { engine: card.engineName })} weeks={weeks} />}
      table={<DayTable engine={card.engineName} days={card.runDays} />}
      menu={{ fileName: t('fileName'), csv }}
      {...card.frame}
    />
  );
}
