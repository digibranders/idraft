'use client';

import { ChevronRight, History, ListOrdered } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { CellKind, Lane, SwitchItem } from './cann-evidence';
import { PageLine, PageMark, pageFill } from './cann-parts';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { formatChartDate, formatInteger } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface InspectorTimelineProps {
  lanes: readonly Lane[];
  switches: readonly SwitchItem[];
  /** Changes that lasted one check and so are not switches. */
  oneCheckChanges: number;
}

const CELL: Readonly<Record<CellKind, string>> = {
  ranking: '',
  beside: 'opacity-40',
  none: 'bg-surface-subtle',
  unreadable: 'border border-border-strong',
};

/** Timeline (docs/33 section 7.2): which page ranked on each check, one lane per page, and the confirmed switches. */
export function InspectorTimeline({ lanes, switches, oneCheckChanges }: InspectorTimelineProps): ReactElement {
  const t = useTranslations('cannibalization.inspector.timeline');
  const checks = lanes[0]?.cells ?? [];
  const first = checks[0];
  const middle = checks[Math.floor(checks.length / 2)];
  const last = checks.at(-1);
  const cellText = (kind: CellKind, date: string, rank: number | null): string =>
    t(
      kind === 'ranking'
        ? 'cellRanking'
        : kind === 'beside'
          ? 'cellBeside'
          : kind === 'none'
            ? 'cellNone'
            : 'cellUnreadable',
      { date: formatChartDate(date), rank: rank ?? 0 },
    );
  return (
    <>
      <InspectorSection
        title={t('lanesTitle')}
        icon={History}
        meta={t('lanesMeta', { count: checks.length })}
        status="ready"
      >
        <div className="flex flex-col gap-2">
          {/* The lanes are a picture; the list of switches below is its text */}
          <div
            role="img"
            aria-label={t('lanesLabel', {
              count: checks.length,
              pages: lanes
                .map((lane) =>
                  t('laneText', { letter: lane.page.letter, path: lane.page.path, count: lane.rankingChecks }),
                )
                .join(' '),
            })}
            className="flex flex-col gap-1.5"
          >
            {lanes.map((lane) => (
              <div key={lane.page.id} className="flex items-center gap-2">
                <span
                  className="flex w-30 shrink-0 items-center gap-1.5 type-meta text-foreground"
                  title={lane.page.path}
                >
                  <PageMark letter={lane.page.letter} />
                  <span className="truncate">{lane.page.path}</span>
                </span>
                <span className="flex h-4 min-w-0 flex-1 items-stretch gap-px">
                  {lane.cells.map((cell) => (
                    <span
                      key={cell.date}
                      title={cellText(cell.kind, cell.date, cell.rank)}
                      className={cn(
                        'min-w-px flex-1 rounded-xs',
                        cell.kind === 'ranking' || cell.kind === 'beside' ? pageFill(lane.page.token) : '',
                        CELL[cell.kind],
                      )}
                    />
                  ))}
                </span>
              </div>
            ))}
          </div>
          {first === undefined || middle === undefined || last === undefined ? null : (
            <div className="flex gap-2" aria-hidden="true">
              <span className="w-30 shrink-0" />
              <span className="flex min-w-0 flex-1 justify-between num type-meta">
                <span>{formatChartDate(first.date)}</span>
                <span>{formatChartDate(middle.date)}</span>
                <span>{formatChartDate(last.date)}</span>
              </span>
            </div>
          )}
          <p className="type-meta">{t('key')}</p>
        </div>
      </InspectorSection>
      <InspectorSection
        title={t('switchesTitle')}
        icon={ListOrdered}
        meta={t('switchesMeta', { count: switches.length })}
        flush={switches.length > 0}
        status={switches.length === 0 ? 'empty' : 'ready'}
        empty={
          <EmptyState
            variant="inline"
            title={t('emptyTitle')}
            reason={oneCheckChanges > 0 ? t('emptyOneCheck', { count: oneCheckChanges }) : t('emptyReason')}
            headingLevel={3}
          />
        }
      >
        <SwitchTable switches={switches} />
      </InspectorSection>
    </>
  );
}

function SwitchTable({ switches }: { switches: readonly SwitchItem[] }): ReactElement {
  const t = useTranslations('cannibalization.inspector.timeline');
  const columns = useTranslations('cannibalization.columns');
  const cells = useTranslations('cannibalization.cells');
  const head = 'px-2 py-2 text-left font-normal type-label text-foreground-tertiary first:pl-4 last:pr-4';
  return (
    <table className="w-full type-table">
      <caption className="sr-only">{t('caption')}</caption>
      <thead>
        <tr className="border-t border-border-subtle bg-surface-subtle">
          <th scope="col" className={head}>
            {columns('when')}
          </th>
          <th scope="col" className={head}>
            {columns('switch')}
          </th>
          <th scope="col" className={head}>
            {columns('rankChange')}
          </th>
          <th scope="col" className={head}>
            {columns('held')}
          </th>
          <th scope="col" className={head}>
            {columns('type')}
          </th>
        </tr>
      </thead>
      <tbody>
        {switches.map((item) => (
          <tr key={`${item.date}:${item.from.id}:${item.to.id}`} className="border-t border-border-subtle align-top">
            <td className="py-2 pr-2 pl-4 whitespace-nowrap text-foreground-secondary">{formatChartDate(item.date)}</td>
            <td className="min-w-0 px-2 py-2">
              <span className="flex flex-col gap-0.5">
                <PageLine page={item.from} />
                <span className="flex items-center gap-1.5">
                  <Icon icon={ChevronRight} size="sm" className="shrink-0 text-foreground-tertiary" />
                  <span className="sr-only">{t('changedTo')}</span>
                  <PageLine page={item.to} strong />
                </span>
              </span>
            </td>
            <td className="px-2 py-2 num whitespace-nowrap text-foreground-secondary">
              {cells('rankBefore', { before: formatInteger(item.before), after: formatInteger(item.after) })}
            </td>
            <td className="px-2 py-2 num whitespace-nowrap text-foreground-secondary">
              {cells('heldDays', { count: item.heldDays })}
            </td>
            <td className="py-2 pr-4 pl-2">
              <Badge>{item.flipFlop ? cells('flipFlop') : cells('moved')}</Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
