'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Menu } from '@/components/ui/menu';
import { LINK_SCOPES, SCOPE_KEY, type LinkScope } from '@/lib/internal-links/scopes';

/** The link scope chip of every tab (spec 7.2: one chip, Editorial by default; mock "Links: Editorial"). */
export function ScopeMenu({
  scope,
  onChange,
}: {
  scope: LinkScope;
  onChange: (scope: LinkScope) => void;
}): ReactElement {
  const t = useTranslations('internalLinks.scope');
  return (
    <Menu
      trigger={
        <Button variant="secondary" size="sm" aria-label={t('menuName', { scope: t(SCOPE_KEY[scope]) })}>
          {t('chip', { scope: t(SCOPE_KEY[scope]) })}
          <Icon icon={ChevronDown} size="sm" className="text-foreground-tertiary" />
        </Button>
      }
      items={LINK_SCOPES.map((value) => ({
        id: value,
        kind: 'radio' as const,
        label: t(SCOPE_KEY[value]),
        checked: value === scope,
        closeOnClick: true,
        onSelect: () => onChange(value),
      }))}
    />
  );
}
