'use client';

import { parseAsString, useQueryState } from 'nuqs';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { useDrawerMetric, useTopicDrawer } from './drawer-context';
import { promptsBehindCell } from './prompts-behind';
import { EmptyState } from '@/components/app/status/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/tag';
import { CELL_OF_METRIC } from '@/features/prompts/prompt-model';
import { useRateWords } from '@/features/prompts/rate-view';
import { ENGINE_PARAM, parseEngineParam } from '@/features/prompts/topics-by-engine/drill';
import { engineValue } from '@/features/prompts/topics-by-engine/engine-values';
import type { PromptSummaryRow } from '@/lib/api/types';

export interface EngineFilteredPromptsProps {
  /** Every prompt of the topic and of the topics below it, in the order the drawer lists them. */
  prompts: readonly PromptSummaryRow[];
  onOpen: (promptId: string) => void;
  /** The list of every prompt, drawn as the drawer always drew it, for an address that names no engine. */
  renderList: (prompts: readonly PromptSummaryRow[]) => ReactNode;
}

/**
 * The content of the topic drawer's Prompts tab (WB-TPE-12). With no engine in the address (`?eng=`, or one this project
 * does not show) it is the drawer's own list of every prompt. With one it lists the prompts that engine has answered,
 * ordered by the chosen metric on that engine, each with its value and the answers behind it; a removable chip names the
 * engine and the note says how many prompts the filter hides, so a prompt is never missing without a word. The engine goes
 * with the drawer: the inspector drops `eng` when it closes, changes tab or opens another record.
 */
export function EngineFilteredPrompts({ prompts, onOpen, renderList }: EngineFilteredPromptsProps): ReactElement {
  const { engines } = useTopicDrawer();
  const t = useTranslations('prompts.topicDrawer.promptsTab');
  const panel = useTranslations('prompts.topicDrawer.panel');
  const words = useTranslations('prompts');
  const rate = useRateWords();
  const { metric } = useDrawerMetric();
  const [engineText, setEngine] = useQueryState(ENGINE_PARAM, parseAsString);
  const code = parseEngineParam(
    engineText,
    engines.map(({ engine }) => engine.engine_code),
  );
  const label = engines.find(({ engine }) => engine.engine_code === code)?.engine.label;
  if (code === null || label === undefined) return <>{renderList(prompts)}</>;

  const key = CELL_OF_METRIC[metric];
  const behind = promptsBehindCell(prompts, code, key);
  const hidden = prompts.length - behind.length;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Tag
          label={t('engineChip', { engine: label })}
          removeLabel={t('engineChipRemove')}
          onRemove={() => void setEngine(null)}
        />
      </div>
      {behind.length === 0 ? (
        <EmptyState
          variant="inline"
          title={t('emptyTitle', { engine: label })}
          reason={t('emptyReason')}
          headingLevel={3}
        />
      ) : (
        <>
          <div className="flex flex-col gap-0.5 type-meta text-foreground-tertiary">
            <p>{t('note', { count: behind.length, engine: label, metric: words(`metric.${metric}`) })}</p>
            {hidden > 0 ? <p>{t('hidden', { count: hidden, engine: label })}</p> : null}
          </div>
          <ul className="flex flex-col">
            {behind.map((prompt) => {
              const value = engineValue(prompt.engines, code, key);
              return (
                <li
                  key={prompt.prompt_id}
                  className="flex flex-col gap-0.5 border-t border-border-subtle py-2 first:border-t-0 first:pt-0 last:pb-0"
                >
                  <span className="flex items-start gap-2">
                    <Button
                      variant="link"
                      className="max-w-full min-w-0 shrink justify-start"
                      onClick={() => onOpen(prompt.prompt_id)}
                    >
                      <span className="line-clamp-2 text-left whitespace-normal">{prompt.text}</span>
                    </Button>
                    {prompt.is_branded ? <Badge>{words('branded')}</Badge> : null}
                  </span>
                  <p className="num type-meta text-foreground-tertiary">
                    {value.state === 'none'
                      ? panel('rowNone', { engine: label, reason: rate.reason(value) ?? panel('noAnswers') })
                      : panel('rowName', {
                          engine: label,
                          value: rate.inline(value),
                          basis: rate.basis(value) ?? '',
                        })}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
