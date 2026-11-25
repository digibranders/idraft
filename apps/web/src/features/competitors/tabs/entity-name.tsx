import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { EntityRow } from '../model/competitor-model';
import { Badge } from '@/components/ui/badge';

/** The name of a tracked entity in a table cell; the own brand carries a "You" mark. */
export function EntityName({ row }: { row: EntityRow }): ReactElement {
  const t = useTranslations('competitors.columns');
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate type-body-strong">{row.name}</span>
      {row.role === 'own' ? <Badge tone="info">{t('you')}</Badge> : null}
    </span>
  );
}
