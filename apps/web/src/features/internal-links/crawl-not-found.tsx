'use client';

import { SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { EmptyState } from '@/components/app/status/empty-state';
import { Button } from '@/components/ui/button';

/**
 * What the tabs show when the address names a crawl that cannot be shown: a malformed id, an id that is no crawl of
 * the project, or a crawl without data (queued, failed, cancelled). A plain fact with the way back, not an error.
 */
export function CrawlNotFound({ onBack }: { onBack: () => void }): ReactElement {
  const t = useTranslations('internalLinks');
  return (
    <EmptyState
      icon={SearchX}
      title={t('notFound.title')}
      reason={t('notFound.reason')}
      headingLevel={2}
      primaryAction={
        <Button variant="secondary" onClick={onBack}>
          {t('picker.backToLatest')}
        </Button>
      }
    />
  );
}
