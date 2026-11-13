'use client';

/**
 * What a screen says when its layout could not be read (it shows the default meanwhile), with the one action that
 * reads again. The card grid draws it; a page with no grid draws it with its `NumberStrip`.
 */
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useLayoutScreen } from './layout-provider';
import { Banner } from '@/components/app/status/banner';
import { Button } from '@/components/ui/button';

/** Inside a `LayoutProvider`. Draws nothing unless the read has failed. */
export function LayoutReadBanner(): ReactElement | null {
  const t = useTranslations('layouts.core');
  const tCommon = useTranslations('common');
  const { status, retry } = useLayoutScreen();
  if (status !== 'error') return null;
  return (
    <Banner
      tone="warning"
      placement="region"
      live
      message={t('readFailed')}
      actions={
        <Button size="sm" onClick={retry}>
          {tCommon('retry')}
        </Button>
      }
      className="mb-4"
    />
  );
}
