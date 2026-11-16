'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Button } from '@/components/ui/button';
import { Truncate } from '@/components/ui/truncate';
import { averageChange } from '@/features/prompts/compare/average-change';
import { useChangeWords, useComparedWindow, useCompare } from '@/features/prompts/compare';
import { TippedChange } from '@/features/prompts/compare/tipped-change';
import { countText } from '@/features/prompts/prompt-model';
import { useRateWords } from '@/features/prompts/rate-view';
import { TrendIcon } from '@/features/prompts/trend-icon';
import type { ProjectEngine, PromptSummaryRow } from '@/lib/api/types';
import { EMPTY_VALUE, formatDateRange, formatList } from '@/lib/format';
import { averageRate, type CellMetric } from '@/lib/rates/rate-model';

export interface TopPromptsTableProps {
  /** The prompts to list, the most mentioned first. */
  prompts: readonly PromptSummaryRow[];
  /** The platforms the page shows: each rate is the equal weight average over them. */
  engines: readonly ProjectEngine[];
  onOpen: (promptId: string) => void;
}

/**
 * The prompts of a group as the preview's "Top prompts in this group" lists them (PR-DRAWER-12): the prompt as a button
 * that opens it, its Mention and Citation (the average over the platforms shown, with each platform's count in the
 * tooltip of the Mention) and its Mention change while the comparison is on. A change that cannot be told says n/a, as
 * the preview does, and nothing is drawn as a zero.
 */
export function TopPromptsTable({ prompts, engines, onOpen }: TopPromptsTableProps): ReactElement {
  const t = useTranslations('prompts.topicDrawer');
  const table = useTranslations('prompts.topicDrawer.topPromptsTable');
  const locale = useLocale();
  const words = useRateWords();
  const changeWords = useChangeWords();
  const { compare } = useCompare();
  const compared = useComparedWindow();
  const range = compared === null ? null : formatDateRange(compared.from, compared.to);
  const codes = engines.map(({ engine }) => engine.engine_code);

  const rateOf = (prompt: PromptSummaryRow, metric: CellMetric): string =>
    words.text(averageRate(codes.map((code) => prompt.engines.find((cell) => cell.engine_code === code)?.[metric])));
  /** What stands behind the Mention: each platform's own count, which a percent of an average cannot say. */
  const countsOf = (prompt: PromptSummaryRow): string =>
    formatList(
      engines.map(({ engine }) =>
        t('engineMentioned', {
          engine: engine.label,
          count:
            countText(prompt.engines.find((cell) => cell.engine_code === engine.engine_code)?.mentioned) ?? EMPTY_VALUE,
        }),
      ),
      locale,
    );

  const columns: PlainColumn<PromptSummaryRow>[] = [
    {
      id: 'prompt',
      header: table('prompt'),
      cell: (prompt) => (
        <Button
          variant="link"
          size="sm"
          className="block max-w-56 min-w-0 justify-start text-left text-foreground"
          onClick={() => onOpen(prompt.prompt_id)}
        >
          <Truncate text={prompt.text} />
        </Button>
      ),
    },
    {
      id: 'mention',
      header: table('mention'),
      cell: (prompt) => (
        <TippedChange tip={countsOf(prompt)}>
          <span>{rateOf(prompt, 'mentioned')}</span>
        </TippedChange>
      ),
    },
    { id: 'citation', header: table('citation'), cell: (prompt) => <span>{rateOf(prompt, 'cited')}</span> },
    {
      id: 'change',
      header: table('change'),
      cell: (prompt) => {
        const mention = compare
          ? averageChange({ cells: prompt.engines, engines, metric: 'mentioned', range, words: changeWords })
          : null;
        if (mention === null || mention.change === null) {
          return <span className="text-foreground-tertiary">{EMPTY_VALUE}</span>;
        }
        return (
          <TippedChange tip={mention.tip}>
            <TrendIcon change={mention.change} />
          </TippedChange>
        );
      },
    },
  ];

  return (
    <PlainTable<PromptSummaryRow>
      caption={t('topPrompts')}
      columns={columns}
      rows={prompts}
      rowKey={(prompt) => prompt.prompt_id}
      status="ready"
      errorState={null}
      emptyText={t('emptyTitle')}
    />
  );
}
