import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import { isBlockedStatus } from '@/lib/internal-links/status';

/**
 * The chip of a status code that is not 200. A refusal of the crawler (401, 403, 429) reads "Blocked" in neutral
 * grey, never red, because the page may be fine for a visitor; other 4xx and 5xx are red and a redirect is amber.
 * `label` replaces the number where the cell says more (a redirect and where it goes).
 */
export function StatusBadge({ status, label }: { status: number; label?: string | undefined }): ReactElement {
  const t = useTranslations('internalLinks.status');
  if (isBlockedStatus(status)) {
    return (
      <Badge tone="neutral" title={t('blockedTip', { status })}>
        {t('blocked')}
      </Badge>
    );
  }
  return <Badge tone={status >= 400 ? 'negative' : 'warning'}>{label ?? String(status)}</Badge>;
}
