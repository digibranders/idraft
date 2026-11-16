'use client';

import { Globe, Link2, Unlink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import type { CompetitorRead } from './data/use-competitor-read';
import { SOURCES_COLLECTED, useCompetitorSources } from './data/use-competitor-sources';
import { DrawerCard } from './drawer-card';
import { compareSources, TOP, type CitedDomain } from './model/sources';
import { colorSlots } from '../cards/competitors/model/tracked-set';
import type { TrackedEntity } from '../cards/competitors/model/types';
import { Badge } from '@/components/ui/badge';
import { formatPercent } from '@/lib/format';

const OWN_COLOR = 'var(--chart-1)';

function SourceList({
  rows,
  color,
  caption,
}: {
  rows: readonly CitedDomain[];
  color: string;
  caption: string;
}): ReactElement {
  const top = rows[0]?.share ?? 1;
  return (
    <table aria-label={caption} className="w-full type-table">
      <tbody>
        {rows.slice(0, TOP).map((row) => (
          <tr key={row.domain} className="h-9">
            <th scope="row" className="pr-2 pl-4 text-left font-normal whitespace-nowrap text-foreground">
              {row.domain}
            </th>
            <td className="w-full pr-3">
              <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-neutral-subtle">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${String((row.share / top) * 100)}%`, background: color }}
                />
              </div>
            </td>
            <td className="pr-4 text-right num whitespace-nowrap">{formatPercent(row.share, { decimals: 1 })}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The Cited domains tab (OV-DRW-40 to OV-DRW-42): which domains AI cites when each of you is mentioned. */
export function SourcesTab({ read, competitor }: { read: CompetitorRead; competitor: TrackedEntity }): ReactElement {
  const t = useTranslations('aiOverview.competitorDrawer');
  const sources = useCompetitorSources(competitor.entityId, true);
  const slot = read.set === null ? undefined : colorSlots(read.set).get(competitor.entityId);
  const comparison = useMemo(() => (sources.data === undefined ? null : compareSources(sources.data)), [sources.data]);
  const single = (state: Parameters<typeof DrawerCard>[0]['state']): ReactElement => (
    <DrawerCard
      title={t('sources.title')}
      icon={Globe}
      info={{ what: t('sources.info.gap.what'), how: t('sources.info.gap.how') }}
      state={state}
      errorTitle={t('errorTitle')}
    />
  );
  if (!SOURCES_COLLECTED) {
    return single({ status: 'empty', title: t('notCollectedTitle'), reason: t('sources.notCollectedReason') });
  }
  if (sources.status === 'loading' || sources.status === 'idle') return single({ status: 'loading' });
  if (sources.status === 'error') return single({ status: 'error', errorId: sources.errorId, retry: sources.refetch });
  if (sources.data === undefined || comparison === null || sources.data.theirs.length === 0) {
    return single({ status: 'empty', title: t('sources.emptyTitle'), reason: t('sources.emptyReason') });
  }
  const { theirs, yours } = sources.data;
  const color = slot === undefined ? 'var(--chart-other)' : `var(--chart-${String(slot)})`;
  return (
    <>
      <DrawerCard
        title={t('sources.gapTitle')}
        icon={Unlink}
        info={{ what: t('sources.info.gap.what'), how: t('sources.info.gap.how') }}
        state={{ status: 'ready' }}
        errorTitle={t('errorTitle')}
      >
        <div className="flex flex-col gap-3">
          <p className="type-body text-foreground-secondary">
            {t('sources.overlap', { percent: formatPercent(comparison.overlap, { decimals: 0 }) })}
          </p>
          <p className="type-label text-foreground-secondary">{t('sources.onlyTheirs')}</p>
          {comparison.onlyTheirs.length === 0 ? (
            <p className="type-meta">{t('sources.allShared')}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {comparison.onlyTheirs.map((domain) => (
                <li key={domain}>
                  <Badge>{domain}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DrawerCard>
      <DrawerCard
        title={t('sources.theirsTitle', { name: competitor.name })}
        icon={Link2}
        meta={t('sources.meta')}
        info={{ what: t('sources.info.theirs.what'), how: t('sources.info.theirs.how') }}
        state={{ status: 'ready' }}
        errorTitle={t('errorTitle')}
        flush
      >
        <SourceList rows={theirs} color={color} caption={t('sources.theirsTitle', { name: competitor.name })} />
      </DrawerCard>
      <DrawerCard
        title={t('sources.yoursTitle')}
        icon={Link2}
        meta={t('sources.meta')}
        info={{ what: t('sources.info.yours.what'), how: t('sources.info.yours.how') }}
        state={{ status: 'ready' }}
        errorTitle={t('errorTitle')}
        flush
      >
        <SourceList rows={yours} color={OWN_COLOR} caption={t('sources.yoursTitle')} />
      </DrawerCard>
    </>
  );
}
