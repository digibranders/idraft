'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { unlinkedPrompts, type UnlinkedPrompt } from './model/unlinked-model';
import { useCardExport } from '../engines/use-card-seams';
import { useFrameState } from '../engines/use-frame-state';
import type { CardPhase } from '../engines/card-phase';
import { promptHref, promptsTabHref, type LinkContext } from '../topics/links';
import { groupsOf } from '../topics/topic-nodes';
import { useTopicSummary } from '../topics/use-topic-reads';
import { useOverview } from '../../overview-context';
import { useScopeUnavailable } from '../../states/scope-unavailable';
import { ChartFrame, type ChartEmpty } from '@/components/app/chart/chart-frame';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Badge } from '@/components/ui/badge';
import { TextLink } from '@/components/ui/text-link';
import type { CardProps } from '@/features/layouts';
import { safeText, type CsvTable } from '@/lib/csv/csv-write';
import { formatList, formatPercent } from '@/lib/format';
import { engineLabel } from '@/lib/layouts';
import { projectPath } from '@/lib/routes/paths';

/**
 * OV-CIT-06: the prompts that mention your brand and cite none of your pages, up to six, each with the share of its
 * answers that do (a bar from 0 to all of them), the counts behind the share and its group. A prompt needs at least 4
 * valid answers, so a share is never drawn from fewer. The platforms in scope are added as counts, never as rates.
 */
export default function UnlinkedMentionsCard({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.sourcesTracking.unlinked');
  const locale = useLocale();
  const { workspaceSlug, project, scope } = useOverview();
  const data = useTopicSummary({ subscribed: live });
  const title = t('title');
  const unavailable = useScopeUnavailable(title);

  const codes = useMemo(() => data.engines.map((engine) => engine.code), [data.engines]);
  const rows = useMemo(() => unlinkedPrompts(data.prompts, codes), [data.prompts, codes]);
  const groupOf = useMemo(() => {
    const names = new Map<string, string>();
    for (const node of groupsOf(data.nodes)) {
      for (const member of node.members ?? []) if (!names.has(member.prompt_id)) names.set(member.prompt_id, node.name);
    }
    return names;
  }, [data.nodes]);

  const context: LinkContext = { workspaceSlug, projectSlug: project.slug, scope };
  const viewAll = promptsTabHref(context) ?? projectPath(workspaceSlug, project.slug, '/ai/prompts');
  // The groups come with the vocabulary trees: the list waits for them rather than show prompts without their group
  const waiting = data.tree.pending && (data.phase === 'ready' || data.phase === 'refetching');
  const phase: CardPhase = ((): CardPhase => {
    if (waiting || data.phase === 'loading') return 'loading';
    if (data.phase === 'error') return 'error';
    if (data.phase === 'idle') return 'empty';
    return data.prompts.length === 0 || rows.length === 0 ? 'empty' : data.phase;
  })();
  const empty = ((): ChartEmpty | null => {
    if (data.phase === 'idle') return unavailable;
    if (data.phase === 'ready' || data.phase === 'refetching') {
      return data.prompts.length === 0
        ? { title: t('emptyNoPromptsTitle'), reason: t('emptyNoPromptsReason') }
        : { title: t('emptyTitle'), reason: t('emptyReason') };
    }
    return null;
  })();
  const frame = useFrameState(
    { phase, stale: data.stale, partialPrevious: false, errorId: data.errorId, retry: data.retry },
    { name: title, empty },
  );
  const ready = frame.status === 'ready' || frame.status === 'refetching';

  // One platform with a rate: its own "x of y answers", which is the percent. Several: the average of their rates and how
  // many took part, with no pooled count beside it (the counts are in the tip, per platform)
  const figureOf = (row: UnlinkedPrompt): string => {
    const [only] = row.counts;
    return row.counts.length === 1 && only !== undefined
      ? t('answersOf', { unlinked: only.k, answers: only.n })
      : t('averageOf', { rate: formatPercent(row.rate, { decimals: 0 }), count: row.counts.length });
  };
  const tipOf = (row: UnlinkedPrompt): string => {
    const [only] = row.counts;
    const head =
      row.counts.length === 1 && only !== undefined
        ? t('rowTipOne', { platform: engineLabel(only.code), k: only.k, n: only.n })
        : t('rowTipAverage', {
            counts: countsText(row),
            platforms: formatList(
              row.counts.map((count) => engineLabel(count.code)),
              locale,
            ),
          });
    return row.leftOut.length === 0
      ? head
      : `${head}. ${t('leftOut', {
          platforms: formatList(
            row.leftOut.map((code) => engineLabel(code)),
            locale,
          ),
        })}`;
  };
  // Each platform's own counts, never added up: the average is of the platforms' rates (R3)
  const countsText = (row: UnlinkedPrompt): string =>
    formatList(
      row.counts.map((count) => t('platformCount', { platform: engineLabel(count.code), k: count.k, n: count.n })),
      locale,
    );
  const columns: PlainColumn<UnlinkedPrompt>[] = [
    { id: 'prompt', header: t('promptHeader'), wrap: true, cell: (row) => row.text },
    { id: 'group', header: t('groupHeader'), cell: (row) => groupOf.get(row.id) ?? '' },
    { id: 'rate', header: t('rateHeader'), cell: (row) => formatPercent(row.rate, { decimals: 0 }) },
    { id: 'platforms', header: t('platformsHeader'), cell: countsText },
  ];
  const csv: CsvTable = {
    header: ['prompt', 'group', 'share_of_answers_mentioning_without_citation', 'platform_counts'],
    rows: rows.map((row) => [
      safeText(row.text),
      safeText(groupOf.get(row.id) ?? ''),
      row.rate,
      safeText(countsText(row)),
    ]),
  };
  useCardExport(item.id, () => (!ready ? null : { id: item.id, ...csv }));

  const list = (
    <ul aria-label={t('caption')} className="flex flex-col">
      {rows.map((row) => {
        const href = promptHref(context, row.id);
        const group = groupOf.get(row.id);
        const text = <span className="truncate type-body text-foreground">{row.text}</span>;
        return (
          <li
            key={row.id}
            className="flex flex-col gap-1 border-t border-border-subtle py-2 first:border-t-0"
            title={tipOf(row)}
          >
            {href === null ? (
              text
            ) : (
              <Link
                href={href}
                className="flex min-w-0 rounded-sm outline-none hover:underline focus-visible:focus-ring"
              >
                {text}
              </Link>
            )}
            <div className="flex items-center gap-2">
              <div aria-hidden="true" className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-subtle">
                <div
                  data-slot="unlinked-bar"
                  className="h-full rounded-full"
                  style={{
                    // The sequential step by its custom property: the heat bins own the seq class names
                    backgroundColor: 'var(--seq-4)',
                    width: `${String(row.rate * 100)}%`,
                  }}
                />
              </div>
              <span className="num type-table whitespace-nowrap text-foreground-secondary">{figureOf(row)}</span>
              {group === undefined ? null : <Badge tone="neutral">{group}</Badge>}
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <ChartFrame
      kind="html"
      keepHeaderWhenEmpty
      variant="panel"
      title={title}
      meta={t('meta')}
      info={{ what: t('infoWhat'), how: t('infoHow') }}
      footnote={t('footnote')}
      height={240}
      controls={viewAll === null ? undefined : <TextLink render={<Link href={viewAll} />}>{t('viewPrompts')}</TextLink>}
      summary={ready ? (rows.length === 0 ? t('summaryNone') : t('summary', { count: rows.length })) : ''}
      body={list}
      table={
        <PlainTable<UnlinkedPrompt>
          caption={t('caption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          status="ready"
          errorState={null}
          emptyText={t('emptyTitle')}
        />
      }
      menu={{ fileName: t('fileName'), csv }}
      {...frame}
    />
  );
}
