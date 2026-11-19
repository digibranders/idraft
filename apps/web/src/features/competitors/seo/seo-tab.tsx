'use client';

import { SearchX } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { EmptyState } from '@/components/app/status/empty-state';
import { LinkButton } from '@/components/ui/link-button';
import { rankingsPath } from '@/lib/routes/paths';

/**
 * The SEO tab (plan section 3.14): search share of voice is not measured, because it needs keyword volumes and a
 * click-through model and no read of competitor rankings exists. It says so, reads nothing and shows no number: an
 * unmeasured figure is never a zero.
 */
export function SeoTab({ workspaceSlug, projectSlug }: { workspaceSlug: string; projectSlug: string }): ReactElement {
  const t = useTranslations('competitors.seo');
  return (
    <EmptyState
      icon={SearchX}
      title={t('title')}
      reason={t('reason')}
      headingLevel={2}
      primaryAction={
        <LinkButton render={<Link href={rankingsPath(workspaceSlug, projectSlug)} />} variant="secondary">
          {t('action')}
        </LinkButton>
      }
      details={<p className="type-meta">{t('hint')}</p>}
    />
  );
}
