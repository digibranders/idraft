'use client';

import { LayoutTemplate } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useCustomize } from '../customize/customize-controller';
import { useLayoutScreen } from '../layout-provider';
import { presetItems } from './presets';
import { Button } from '@/components/ui/button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';

/**
 * The Start from menu of the save bar (plan T9, owner decision D-01): the built-in layout, the team default while
 * one exists, and the presets of the page. Choosing one replaces the draft, the way Reset to default does: it is a
 * change like any other, counted and undoable, and nothing is stored until Save. So it asks nothing, and a choice
 * the draft already shows changes nothing and says nothing (`replaceDraft`). A screen with no presets and no team
 * default has only the built-in layout to offer, which is what Reset to default already does: no menu then.
 */
export function StartFromMenu(): ReactElement | null {
  const t = useTranslations('layouts.customize');
  const { screen, resolved, saving, actions } = useLayoutScreen();
  const { presets } = useCustomize();
  if (presets.length === 0 && !resolved.teamDefaultExists) return null;

  const items: MenuItemDef[] = presetItems(resolved, screen, presets, {
    builtin: t('presets.builtin'),
    team: t('presets.team'),
  }).map(({ id, label, document }) => ({
    id,
    label,
    onSelect: () => {
      actions.replaceDraft(document, t('announce.preset', { preset: label }));
    },
  }));

  return (
    <Menu
      align="end"
      items={items}
      trigger={
        <Button icon={LayoutTemplate} disabled={saving} focusableWhenDisabled>
          {t('presets.startFrom')}
        </Button>
      }
    />
  );
}
