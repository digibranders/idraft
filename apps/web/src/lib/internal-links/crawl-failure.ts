import type { useTranslations } from 'next-intl';

import type { CrawlRun } from './types';

type StatesTranslate = ReturnType<typeof useTranslations<'internalLinks.states'>>;

/**
 * The words of a failed crawl, by its error code: every code the backend sets (`collectors/crawl_runs.py`), and a
 * generic sentence for any other. The run's own `error_message` is never shown: for a provider error it is the
 * provider's text. Shared by the Internal links page and the crawl list of the project settings.
 */
export function failedText(t: StatesTranslate, run: CrawlRun, host: string): string {
  switch (run.error_code) {
    case 'site_blocked':
      return t('failedSiteBlocked', { host });
    case 'site_unreachable':
      return t('failedUnreachable', { host });
    case 'budget_exceeded':
      return t('failedBudget');
    case 'provider_error':
      return t('failedProvider');
    case 'submit_unknown':
      return t('failedSubmitUnknown');
    default:
      return t('failedOther');
  }
}
