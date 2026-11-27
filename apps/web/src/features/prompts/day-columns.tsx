import { useTranslations } from 'next-intl';
import { useId, type ReactElement } from 'react';

import { changesOf, readingOf, type DayColumn, type DayReading } from './day-compare-model';
import { Badge } from '@/components/ui/badge';
import { formatChartDate, formatTableDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The tone of a day's reading: the brand named and cited is the good day, silence is the poor one. */
const READING_TONE = {
  namedAndCited: 'positive',
  namedOnly: 'neutral',
  citedOnly: 'neutral',
  neither: 'negative',
} as const satisfies Record<DayReading, 'positive' | 'neutral' | 'negative'>;

const ROW = 'flex min-h-8 items-center gap-2 border-t border-border-subtle px-3';

/** One day: the reading of the own brand, the brands in the answer, the sites it cited. */
function DayCard({
  column,
  previous,
  timeZone,
}: {
  column: DayColumn;
  previous: DayColumn | null;
  timeZone: string;
}): ReactElement {
  const t = useTranslations('prompts.dayCompare');
  const changes = changesOf(previous, column);
  const reading = readingOf(column);
  const id = useId();
  // The day the answer is grouped by, as the API gives it: the time line below is the instant in the project's zone
  const date = formatChartDate(column.observedDate);
  return (
    <article
      aria-labelledby={`${id}-day`}
      className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface"
    >
      <header className="flex flex-col gap-1 px-3 py-2">
        <h3 id={`${id}-day`} className="type-subsection-title">
          {date}
        </h3>
        <p className="type-meta">{formatTableDateTime(column.observedAt, timeZone)}</p>
        <Badge tone={READING_TONE[reading]}>{t(`reading.${reading}`)}</Badge>
      </header>

      <section aria-labelledby={`${id}-brands`}>
        <h4 id={`${id}-brands`} className="flex h-8 items-center bg-surface-subtle px-3 type-table-header">
          {t('brands')}
        </h4>
        {column.brands.length === 0 ? (
          <p className={cn(ROW, 'type-meta')}>{t('noBrands')}</p>
        ) : (
          <ol>
            {column.brands.map((brand, index) => (
              <li
                key={brand.entityId}
                className={cn(ROW, brand.role === 'own' && 'bg-surface-selected text-primary-text')}
              >
                <span className="w-4 shrink-0 num type-meta">{index + 1}</span>
                <span className={cn('min-w-0 truncate type-table', brand.role === 'own' && 'type-body-strong')}>
                  {brand.role === 'own' ? t('you', { name: brand.name }) : brand.name}
                </span>
                {changes.entered.has(brand.entityId) ? (
                  <span className="ml-auto">
                    <Badge tone="positive">{t('entered')}</Badge>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {changes.left.length === 0 || previous === null ? null : (
          <p className={cn(ROW, 'py-2 type-meta')}>
            {t('left', {
              date: formatChartDate(previous.observedDate),
              names: changes.left.map((brand) => brand.name).join(', '),
            })}
          </p>
        )}
      </section>

      <section aria-labelledby={`${id}-sources`}>
        <h4 id={`${id}-sources`} className="flex h-8 items-center bg-surface-subtle px-3 type-table-header">
          {t('sources')}
        </h4>
        {column.sources.length === 0 ? (
          <p className={cn(ROW, 'type-meta')}>{t('noSources')}</p>
        ) : (
          <ol>
            {column.sources.map((source, index) => (
              <li
                key={source.host}
                className={cn(ROW, source.role === 'own' && 'bg-surface-selected text-primary-text')}
              >
                <span className="w-4 shrink-0 num type-meta">{index + 1}</span>
                <span className={cn('min-w-0 truncate type-table', source.role === 'own' && 'type-body-strong')}>
                  {source.host}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}

/** The columns side by side, oldest day first; one under the other below the medium width. */
export function DayColumns({ columns, timeZone }: { columns: readonly DayColumn[]; timeZone: string }): ReactElement {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 items-start gap-3 @2xl:grid-cols-2 @4xl:grid-cols-4">
        {columns.map((column, index) => (
          <DayCard
            key={column.observationId}
            column={column}
            previous={index > 0 ? (columns[index - 1] ?? null) : null}
            timeZone={timeZone}
          />
        ))}
      </div>
    </div>
  );
}
