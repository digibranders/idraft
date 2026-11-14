'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { usePageShortcuts } from '@/components/app/shell/page-shortcuts';
import { useBreakpoint, useCustomize, useLayoutScreen } from '@/features/layouts';
import { useShortcut } from '@/lib/a11y/use-shortcut';

/** The key of Customize in the shortcuts dialog. */
const CUSTOMIZE_SHORTCUT = 'ai-overview-customize';

/**
 * `c` does what the Customize button does: it turns the mode on, and off again (which asks first when there are
 * changes). The button is hidden below 768 px, so the key and its line in the shortcuts dialog go with it; and it
 * does nothing while the layout is not read or is being saved, as the disabled button does not. It sits inside
 * `CustomizableScreen`, where the controller is.
 */
export function CustomizeShortcut(): null {
  const t = useTranslations('aiOverview.shortcuts');
  const wide = useBreakpoint() !== 'narrow';
  const { mode, canCustomize, saving } = useLayoutScreen();
  const { enter, requestExit } = useCustomize();
  const entries = useMemo(
    () => (wide ? [{ id: CUSTOMIZE_SHORTCUT, label: t('customize'), keys: ['c'] }] : []),
    [wide, t],
  );
  usePageShortcuts(entries);
  useShortcut(
    'c',
    () => {
      if (mode === 'customize') requestExit();
      else enter();
    },
    { kind: 'single-key', enabled: wide && canCustomize && !saving },
  );
  return null;
}
