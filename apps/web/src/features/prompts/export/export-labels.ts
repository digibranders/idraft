import { useTranslations } from 'next-intl';

import type { PromptExportLabels } from '../export-rows';

/**
 * The words of the prompts file, as the bulk export writes them (`use-prompt-actions.tsx`, `exportPrompts`).
 * shortcut: repeated here because that file belongs to another package; `export-labels.test.tsx` spells the header
 * out so a drift in either place fails, and the two move to one place when that file is free.
 */
export function usePromptExportLabels(): PromptExportLabels {
  const t = useTranslations('prompts');
  return {
    prompt: t('columns.prompt'),
    topic: t('columns.topic'),
    country: t('columns.country'),
    branded: t('branded'),
    yes: t('bulk.yes'),
    no: t('bulk.no'),
    mentionRate: t('bulk.exportMentionRate'),
    mentionAnswers: t('bulk.exportMentionAnswers'),
    citationRate: t('bulk.exportCitationRate'),
    citationAnswers: t('bulk.exportCitationAnswers'),
    mentioned: (engine) => t('columns.mentioned', { engine }),
    cited: (engine) => t('columns.cited', { engine }),
    answers: (engine) => t('bulk.exportAnswers', { engine }),
  };
}
