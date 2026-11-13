'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement, RefObject } from 'react';

import { useLayoutScreen } from '../layout-provider';
import { MEDIUM_MEDIA } from '../use-breakpoint';
import { useCustomize } from './customize-controller';
import { Button } from '@/components/ui/button';
import type { MenuItemDef } from '@/components/ui/menu';
import { Tooltip } from '@/components/ui/tooltip';
import { useMediaQuery } from '@/lib/dom/use-media-query';

/** What the control says: the whole page, only its cards, or only its numbers (a table page). */
export type CustomizeLabel = 'customize' | 'customizeCards' | 'customizeNumbers';

export interface CustomizeButtonProps {
  label?: CustomizeLabel | undefined;
}

/**
 * Pressed while the mode is on, with the primary tint the approved preview gives it. Customizing needs 768 px, so
 * below that there is no button at all. The classes after `aria-pressed:` replace the Button's own pressed look.
 */
const BUTTON_CLASS =
  'hidden md:inline-flex aria-pressed:border-primary-border aria-pressed:bg-primary-subtle aria-pressed:text-primary-text not-aria-busy:not-data-disabled:aria-pressed:hover:bg-primary-subtle';

/**
 * The toggle of customize mode, in the page header. While the layout has not loaded it is disabled and says why.
 * A second press leaves the mode, and asks first when there are changes.
 */
export function CustomizeButton({ label = 'customize' }: CustomizeButtonProps): ReactElement {
  const t = useTranslations('layouts.customize.mode');
  const { mode, canCustomize, saving } = useLayoutScreen();
  const { enter, requestExit, registerEntry } = useCustomize();
  const customizing = mode === 'customize';
  return (
    <Tooltip content={t('notLoaded')} disabled={canCustomize}>
      <Button
        ref={registerEntry}
        icon={SlidersHorizontal}
        aria-pressed={customizing}
        disabled={!canCustomize || saving}
        focusableWhenDisabled
        className={BUTTON_CLASS}
        onClick={(event) => {
          if (customizing) requestExit();
          else enter(event.currentTarget);
        }}
      >
        {t(label)}
      </Button>
    </Tooltip>
  );
}

/**
 * The same toggle as an item of a More menu, for a screen whose header has no room for the button (a table page,
 * a drawer). Null below 768 px, where there is no customize mode. `returnFocus` is the menu's trigger: the menu
 * has closed by the time the mode starts, so focus goes back to its trigger when the mode ends.
 */
export function useCustomizeMenuItem(
  label: CustomizeLabel = 'customize',
  returnFocus?: RefObject<HTMLElement | null>,
): MenuItemDef | null {
  const t = useTranslations('layouts.customize.mode');
  const wide = useMediaQuery(MEDIUM_MEDIA);
  const { mode, canCustomize, saving } = useLayoutScreen();
  const { enter, requestExit } = useCustomize();
  if (!wide) return null;
  return {
    id: 'customize',
    label: t(label),
    icon: SlidersHorizontal,
    ...(canCustomize ? {} : { disabledReason: t('notLoaded') }),
    onSelect: () => {
      if (saving) return;
      if (mode === 'customize') requestExit();
      else enter(returnFocus?.current);
    },
  };
}
