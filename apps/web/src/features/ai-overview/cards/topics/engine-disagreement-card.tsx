'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { useOverview } from '../../overview-context';
import { TopicCardFrame, useTopicEmpty, type TopicEmpty } from './card-frame';
import {
  DISAGREEMENT_EXPORT_HEADER,
  DISAGREEMENT_FILE_NAME,
  disagreementRows,
  PATH_SEPARATOR,
  type DisagreementRow,
} from './disagreement-model';
import { topicDrawerHref } from './links';
import type { TopicData } from './model-types';
import { countOf } from './options';
import { TopicFootnote } from './topic-footnote';
import { overlapCount } from './topic-nodes';
import { useTopicSummary } from './use-topic-reads';
import { useTopicWords } from './use-topic-words';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';
import { TextLink } from '@/components/ui/text-link';
import type { CardProps } from '@/features/layouts';
import { safeText, type CsvCell, type CsvTable } from '@/lib/csv/csv-write';
import { EMPTY_VALUE, formatList } from '@/lib/format';
import { projectPath } from '@/lib/routes/paths';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/**
 * Named by one engine, not another (CH-44, `ai.engine_disagreement`): the topics where one engine names you in a
 * prompt and another engine, with enough answers to tell, never does. The pair is ordered and the count is text:
 * the Prompts page has no filter for a pair, so the topic is the link.
 */
export default function EngineDisagreementCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.topics.disagreement');
  const common = useTranslations('aiOverview.topics.common');
  const words = useTopicWords();
  const empties = useTopicEmpty();
  const { workspaceSlug, project, enabledEngines, canManageEngines, setScope } = useOverview();
  const read = useTopicSummary({ subscribed: live });
  // The leaf topics depend on the vocabulary tree: until it is read, rows would be listed beside their parents
  const data: TopicData =
    read.tree.pending && (read.phase === 'ready' || read.phase === 'refetching') ? { ...read, phase: 'loading' } : read;
  const count = countOf(options.rows ?? '', 5);
  const { engines, scope } = data;
  const codes = engines.map((engine) => engine.code);
  const nameOf = (code: string): string => engines.find((engine) => engine.code === code)?.label ?? code;
  const context = { workspaceSlug, projectSlug: project.slug, scope };
  const model = disagreementRows(data.nodes, codes, count);

  const empty = ((): TopicEmpty | null => {
    if (engines.length < 2) {
      const title = t('needsTwoTitle');
      if (scope.engines !== null && enabledEngines.length > 1) {
        return {
          title,
          reason: t('needsTwoReason'),
          action: (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setScope({ engines: null });
              }}
            >
              {common('useAllEngines')}
            </Button>
          ),
        };
      }
      if (!canManageEngines) return { title, reason: t('needsTwoAdmin'), action: null };
      return {
        title,
        reason: t('needsTwoReason'),
        action: (
          <LinkButton
            variant="secondary"
            size="sm"
            render={<Link href={projectPath(workspaceSlug, project.slug, '/settings/engines')} />}
          >
            {common('turnOnEngines')}
          </LinkButton>
        ),
      };
    }
    if (model.topics === 0) return empties.noTopics;
    // Prompt rows left out of the read leave no member to count, which reads as no answer
    if (!model.answered) {
      return empties.noAnswers(
        engines.map((engine) => engine.label),
        scope.range.days,
      );
    }
    if (model.rows.length > 0) return null;
    // Good news, so the one action is to look at the topics
    return {
      title: t('noneTitle'),
      reason: t('noneReason', { min: MIN_OBSERVATIONS }),
      action: (
        <LinkButton
          variant="secondary"
          size="sm"
          render={<Link href={projectPath(workspaceSlug, project.slug, '/ai/prompts')} />}
        >
          {common('openTopics')}
        </LinkButton>
      ),
    };
  })();

  const topicText = (row: DisagreementRow): string => row.node.path.join(PATH_SEPARATOR);
  const pairText = (row: DisagreementRow): string => t('pair', { yes: nameOf(row.yes), no: nameOf(row.no) });
  const promptsText = (row: DisagreementRow): string => t('promptsOf', { count: row.count, total: row.total });
  const rowKey = (row: DisagreementRow): string => `${row.node.key}|${row.yes}|${row.no}`;

  const topicCell = (row: DisagreementRow): ReactNode => {
    const href = topicDrawerHref(context, row.node.key);
    return href === null ? topicText(row) : <TextLink render={<Link href={href} />}>{topicText(row)}</TextLink>;
  };
  const columns: PlainColumn<DisagreementRow>[] = [
    { id: 'topic', header: t('table.topic'), wrap: true, cell: topicCell },
    { id: 'pair', header: t('table.pair'), cell: pairText },
    { id: 'prompts', header: t('table.prompts'), cell: promptsText },
  ];
  const examples: PlainColumn<DisagreementRow> = {
    id: 'examples',
    header: t('table.examples'),
    wrap: true,
    cell: (row) => (
      <ul className="flex flex-col gap-1">
        {row.examples.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    ),
  };
  const tableOf = (shown: readonly PlainColumn<DisagreementRow>[]): ReactElement => (
    <PlainTable<DisagreementRow>
      caption={t('tableCaption')}
      columns={shown}
      rows={model.rows}
      rowKey={rowKey}
      status="ready"
      errorState={null}
      emptyText={EMPTY_VALUE}
    />
  );

  const csv: CsvTable = {
    header: [t('table.topic'), t('table.pair'), t('table.prompts'), t('table.examples')],
    rows: model.rows.map((row): CsvCell[] => [
      safeText(topicText(row)),
      pairText(row),
      promptsText(row),
      safeText(formatList(row.examples)),
    ]),
  };

  return (
    <TopicCardFrame
      cardKey="ai.engine_disagreement"
      title={t('title')}
      meta={words.window(scope.range)}
      summary={t('summary', { count: model.rows.length })}
      data={data}
      empty={empty}
      partialEngines={model.answered ? model.silent.map(nameOf) : []}
      footnote={
        <TopicFootnote
          overlapPrompts={data.promptsRead ? overlapCount(data.prompts, data.nodes) : null}
          pooled={false}
          weighting="prompt"
          extra={
            <>
              <span>{t('rule', { min: MIN_OBSERVATIONS })}</span>{' '}
              {model.undecided > 0 ? (
                <span>{t('undecided', { count: model.undecided, min: MIN_OBSERVATIONS })}</span>
              ) : null}
            </>
          }
        />
      }
      menu={{ fileName: DISAGREEMENT_FILE_NAME, csv }}
      exportBlock={{
        id: item.id,
        build: () => ({
          id: item.id,
          header: [...DISAGREEMENT_EXPORT_HEADER],
          rows: model.rows.map((row): CsvCell[] => [safeText(row.node.name), row.yes, row.no, row.count, row.total]),
        }),
      }}
      body={tableOf(columns)}
      table={tableOf([...columns, examples])}
    />
  );
}
