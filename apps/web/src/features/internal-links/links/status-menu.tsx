'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { LinkStatus } from '../url-state';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Menu } from '@/components/ui/menu';

const STATUSES: readonly LinkStatus[] = ['active', 'lost', 'all'];

/** The Links tab's Status chip: the links the crawl has (Active), the ones it lost since the crawl before, or both. */
export function StatusMenu({
  status,
  onChange,
}: {
  status: LinkStatus;
  onChange: (status: LinkStatus) => void;
}): ReactElement {
  const t = useTranslations('internalLinks.links.status');
  return (
    <Menu
      trigger={
        <Button variant="secondary" size="sm" aria-label={t('menuName', { status: t(status) })}>
          {t('label', { status: t(status) })}
          <Icon icon={ChevronDown} size="sm" className="text-foreground-tertiary" />
        </Button>
      }
      items={STATUSES.map((value) => ({
        id: value,
        kind: 'radio' as const,
        label: t(value),
        checked: value === status,
        closeOnClick: true,
        onSelect: () => onChange(value),
      }))}
    />
  );
}
