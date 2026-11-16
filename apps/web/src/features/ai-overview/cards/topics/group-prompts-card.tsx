'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { TopicCardFrame, useTopicEmpty, type TopicEmpty } from './card-frame';
import { platformForBack } from './group-drill';
import { groupPrompts, type GroupPrompt } from './group-prompts-model';
import { GroupVersus } from './group-versus';
import { promptHref, promptsTabHref, type LinkContext } from './links';
import type { TopicData } from './model-types';
import { TopicFootnote } from './topic-footnote';
import { useGroupVersus } from './use-group-versus';
import { useChosenGroupName } from './use-group-name';
import { useTopicSummary } from './use-topic-reads';
import { useOverview } from '../../overview-context';
import { singlePlatform } from '../../scope/scope-model';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import type { CardProps } from '@/features/layouts';
import { EMPTY_VALUE, formatInteger, formatPercent } from '@/lib/format';
import type { AverageRate } from '@/lib/rates/rate-model';
import { projectPath } from '@/lib/routes/paths';

/**
 * The prompts of the chosen group (OV-GRP-09 to OV-GRP-11), in the slot of the groups heat map: up to 15 prompts with
 * their visibility, mention and citation rate, the group against all groups beside them, a Back button to all groups
 * and a link to every prompt of the group on the Prompts page. A row opens the prompt there with the group and the
 * platform carried. Prompts with fewer than 4 valid answers are not listed.
 */
export function GroupPromptsCard({ live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.topics.groups');
  const prompts = useTranslations('aiOverview.topics.groups.prompts');
  const common = useTranslations('common');
  const empties = useTopicEmpty();
  const { workspaceSlug, project, scope, setScope } = useOverview();
  const read = useTopicSummary({ subscribed: live });
  // The prompts of a group are its members: a read that waits for the vocabulary trees does not list them early
  const data: TopicData =
    read.tree.pending && (read.phase === 'ready' || read.phase === 'refetching') ? { ...read, phase: 'loading' } : read;
  const versus = useGroupVersus(live);
  const group = useChosenGroupName() ?? '';
  const platform = singlePlatform(scope);
  const { engines } = data;
  const platformLabel = engines.length === 1 ? (engines[0]?.label ?? '') : null;
  const list = useMemo(
    () =>
      groupPrompts(
        data.prompts,
        engines.map((engine) => engine.code),
      ),
    [data.prompts, engines],
  );

  const context: LinkContext = { workspaceSlug, projectSlug: project.slug, scope };
  // A link carries the platform of the scope, and the Prompts page cannot show a platform that is off
  const holdsOffEngine = platform !== null && !engines.some((engine) => engine.code === platform);
  const openAll: Route | null = holdsOffEngine
    ? null
    : (promptsTabHref(context) ?? projectPath(workspaceSlug, project.slug, '/ai/prompts'));

  const percent = (rate: AverageRate): string =>
    rate.state === 'ok' ? formatPercent(rate.value, { decimals: 0 }) : EMPTY_VALUE;
  const tipOf = (rate: AverageRate): string => {
    const text = percent(rate);
    if (rate.engines === 1 && rate.successes !== null) {
      return prompts('tipSingle', { percent: text, successes: rate.successes, answers: rate.answers });
    }
    return rate.engines > 1
      ? prompts('tipAverage', { percent: text, platforms: rate.engines, answers: rate.answers })
      : prompts('tipAnswers', { percent: text, answers: rate.answers });
  };
  const rateCell = (rate: AverageRate): ReactElement => (
    <Tooltip content={tipOf(rate)} purpose="label">
      <span>{percent(rate)}</span>
    </Tooltip>
  );

  const columns: PlainColumn<GroupPrompt>[] = [
    {
      id: 'prompt',
      header: prompts('prompt'),
      wrap: true,
      cell: (row) => {
        const href = holdsOffEngine ? null : promptHref(context, row.prompt.prompt_id);
        return href === null ? (
          row.prompt.text
        ) : (
          <Link href={href} className="hover:underline">
            {row.prompt.text}
          </Link>
        );
      },
    },
    { id: 'visibility', header: prompts('visibility'), cell: (row) => rateCell(row.visibility) },
    { id: 'mention', header: prompts('mention'), cell: (row) => rateCell(row.mention) },
    { id: 'citation', header: prompts('citation'), cell: (row) => rateCell(row.citation) },
    { id: 'answers', header: prompts('answers'), cell: (row) => formatInteger(row.mention.answers) },
  ];
  const table = (
    <PlainTable<GroupPrompt>
      caption={prompts('tableCaption', { group })}
      columns={columns}
      rows={list.listed}
      rowKey={(row) => row.prompt.prompt_id}
      status="ready"
      errorState={null}
      emptyText={EMPTY_VALUE}
    />
  );

  const back = (
    <Button
      variant="secondary"
      size="sm"
      aria-label={prompts('backLabel')}
      onClick={() => {
        // Back from a heat map click returns to the platform the person came from
        setScope({
          topic: null,
          engines: ((): readonly string[] | null => {
            const next = platformForBack(scope.topic ?? '', platform);
            return next === null ? null : [next];
          })(),
        });
      }}
    >
      <Icon icon={ChevronLeft} size="sm" />
      {prompts('back')}
    </Button>
  );

  const empty = ((): TopicEmpty | null => {
    if (data.prompts.length === 0) return empties.noTopics;
    if (list.ranked.length > 0) return null;
    return {
      title: prompts('emptyTitle'),
      reason:
        platformLabel === null ? prompts('emptyReason') : prompts('emptyReasonPlatform', { platform: platformLabel }),
      action: back,
    };
  })();

  const side = (
    <div className="border-t border-border-subtle p-4 @3xl:w-80 @3xl:shrink-0 @3xl:border-t-0 @3xl:border-l">
      <h3 className="mb-1 type-label text-foreground-secondary">{t('versus.title', { group })}</h3>
      {versus.data.phase === 'error' ? (
        <div className="flex flex-col items-start gap-2">
          <p className="type-meta">{t('versus.failed')}</p>
          <Button variant="secondary" size="sm" onClick={versus.data.retry}>
            {common('retry')}
          </Button>
        </div>
      ) : versus.data.phase === 'loading' ? (
        <Skeleton shape="block" className="h-40 w-full" />
      ) : (
        <GroupVersus rows={versus.rows} unavailable={versus.unavailable} counted={versus.counted} />
      )}
    </div>
  );

  return (
    <TopicCardFrame
      cardKey="ai.topic_heatmap"
      title={prompts('title', { group })}
      meta={
        data.summary === undefined
          ? null
          : platformLabel === null
            ? prompts('metaAll', { count: list.ranked.length })
            : prompts('metaPlatform', { count: list.ranked.length, platform: platformLabel })
      }
      summary={prompts('summary', { group })}
      data={data}
      empty={empty}
      partialEngines={[]}
      info={{ what: t('info.prompts.what'), how: t('info.prompts.how') }}
      footnote={
        <TopicFootnote
          overlapPrompts={null}
          pooled={false}
          weighting="prompt"
          extra={
            <>
              {prompts('footnote')} {prompts('listed')}
            </>
          }
        />
      }
      controls={back}
      body={
        <div className="@container flex flex-col @3xl:flex-row">
          <div className="min-w-0 flex-1">{table}</div>
          {side}
        </div>
      }
      table={table}
      menu={undefined}
      link={openAll === null ? null : { href: openAll, label: prompts('viewAll', { count: list.ranked.length }) }}
    />
  );
}
