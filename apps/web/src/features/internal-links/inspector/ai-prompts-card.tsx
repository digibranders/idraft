'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { EngineLogo } from '@/components/app/engine/engine-logo';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { Tooltip } from '@/components/ui/tooltip';
import { formatInteger } from '@/lib/format';
import type { PageAi } from '@/lib/internal-links/types';
import { citingPlatformsOf, platformSummaryText, promptIdsOf } from '@/lib/pages/ai-model';

export interface AiPromptsCardProps {
  ai: PageAi;
  /** Opens a citing prompt in the shared prompt inspector, passing the table's row order for J/K stepping. */
  onOpenPrompt: (promptId: string, order?: readonly string[]) => void;
}

const HEADER_CLASS = 'py-1 type-table-header whitespace-nowrap';

/** Prompts that cited the open page, with citing platform marks and cited answer counts. */
export function AiPromptsCard({ ai, onOpenPrompt }: AiPromptsCardProps): ReactElement {
  const t = useTranslations('pages.drawer.ai.prompts');
  const order = promptIdsOf(ai);
  const meta =
    ai.prompts.length === 0
      ? undefined
      : ai.prompts_total > ai.prompts.length
        ? t('metaCut', { shown: ai.prompts.length, total: ai.prompts_total })
        : t('meta', { count: ai.prompts.length, total: ai.prompts_total });

  return (
    <InspectorSection
      title={t('title')}
      meta={meta}
      flush
      status={ai.prompts.length === 0 ? 'empty' : 'ready'}
      empty={<EmptyState variant="card" headingLevel={3} title={t('emptyTitle')} reason={t('emptyReason')} />}
    >
      <table className="w-full type-table">
        <caption className="sr-only">{t('caption')}</caption>
        <thead>
          <tr className="h-row-compact border-t border-border-subtle bg-surface-subtle">
            <th scope="col" className={`${HEADER_CLASS} w-full pr-2 pl-4 text-left`}>
              {t('columnPrompt')}
            </th>
            <th scope="col" className={`${HEADER_CLASS} px-2 text-left`}>
              {t('columnPlatforms')}
            </th>
            <th scope="col" className={`${HEADER_CLASS} pr-4 pl-2 text-right`}>
              {t('columnCited')}
            </th>
          </tr>
        </thead>
        <tbody>
          {ai.prompts.map((prompt) => {
            const citing = citingPlatformsOf(prompt.platforms);
            return (
              <tr key={prompt.prompt_id} className="h-row-compact border-t border-border-subtle hover:bg-surface-hover">
                <td className="w-full max-w-0 pr-2 pl-4">
                  <Tooltip content={t('rowTip', { text: prompt.text })}>
                    <button
                      type="button"
                      className="block w-full min-w-0 truncate rounded-sm text-left text-foreground outline-none hover:underline focus-visible:focus-ring-inset"
                      onClick={() => onOpenPrompt(prompt.prompt_id, order)}
                    >
                      {prompt.text}
                    </button>
                  </Tooltip>
                </td>
                <td className="px-2 whitespace-nowrap">
                  <Tooltip
                    content={platformSummaryText(citing, (engine, cited, answers) =>
                      t('platformTip', { engine, cited, answers }),
                    )}
                    purpose="label"
                    disabled={citing.length === 0}
                  >
                    <span className="inline-flex items-center gap-1">
                      {citing.map((platform) => (
                        <EngineLogo
                          key={platform.engine_code}
                          engine={platform.engine_code}
                          name={platform.label}
                          nameDisplay="visually-hidden"
                        />
                      ))}
                    </span>
                  </Tooltip>
                </td>
                <td className="pr-4 pl-2 text-right num whitespace-nowrap">
                  <Tooltip
                    content={t('citedTip', { cited: prompt.answers_citing, answers: prompt.answers })}
                    purpose="label"
                  >
                    <span className="text-foreground">{formatInteger(prompt.answers_citing)}</span>
                  </Tooltip>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </InspectorSection>
  );
}
