'use client';

import { SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type ReactElement } from 'react';

import { EmptyState } from '@/components/app/status/empty-state';
import { Button } from '@/components/ui/button';

/**
 * What the tabs show when the address names a crawl that cannot be shown: a malformed id, an id that is no crawl of
 * the project (or one too old to be listed), or a crawl without data. A plain fact with the way back, not an error.
 * Its heading takes focus when it appears, so a person who followed such an address is told where they are.
 */
export function CrawlNotFound({ onBack }: { onBack: () => void }): ReactElement {
  const t = useTranslations('internalLinks');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const heading = box.current?.querySelector<HTMLElement>('h2');
    if (heading == null) return;
    heading.tabIndex = -1;
    heading.classList.add('outline-none');
    heading.focus();
  }, []);
  return (
    <div ref={box}>
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
    </div>
  );
}
