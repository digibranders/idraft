'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { TextLink } from '@/components/ui/text-link';

/** The link under most auth panels. */
export function BackToSignIn(): ReactNode {
  const t = useTranslations('auth');
  return (
    <TextLink href="/login" className="type-body">
      {t('links.backToSignIn')}
    </TextLink>
  );
}
