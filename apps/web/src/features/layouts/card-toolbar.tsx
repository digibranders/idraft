'use client';

/**
 * The controls of one card in customize mode (docs/superpowers/plans/2026-11-13-ai-wp-15-layouts-core.md,
 * section 2.7): Width, Options, Hide and More, in that order after the handle. The frame names them as a group;
 * each is an ordinary tab stop. The provider says what each change did, so nothing is announced here.
 */
import { EllipsisVertical, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { CardOptionsPopover } from './card-options-popover';
import { useLayoutScreen } from './layout-provider';
import { MOVE_COMMANDS, moveTargetIndex, type MoveCommand } from './move-menu';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { Select, type SelectOption } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import { cardName, cardType, type CardItem, type Width } from '@/lib/layouts';

/** The `layouts.core.widths` key of each width. */
const WIDTH_KEY = { third: 'third', half: 'half', two_thirds: 'twoThirds', full: 'full' } as const satisfies Record<
  Width,
  string
>;

/** The words of each move, and what to say when it cannot be made. */
const MOVES = {
  earlier: { label: 'moveEarlier', reason: 'alreadyFirst' },
  later: { label: 'moveLater', reason: 'alreadyLast' },
  start: { label: 'moveStart', reason: 'alreadyFirst' },
  end: { label: 'moveEnd', reason: 'alreadyLast' },
} as const satisfies Record<MoveCommand, { label: string; reason: string }>;

const COARSE_ICON = 'pointer-coarse:size-control-touch';

/** Width, Options, Hide and More of one card; the frame's group wraps them. */
export function CardTools({ item }: { item: CardItem }): ReactElement {
  const t = useTranslations('layouts.core');
  const { actions, definition, document } = useLayoutScreen();
  const name = cardName(item);
  const widths = cardType(item.type)?.widths ?? [];
  const cards = document.cards ?? [];
  const index = cards.findIndex((card) => card.id === item.id);

  const widthOptions: SelectOption<Width>[] = widths.map((width) => ({
    value: width,
    label: t(`widths.${WIDTH_KEY[width]}`),
  }));
  const moveItems: MenuItemDef[] = MOVE_COMMANDS.map((command) => {
    const target = moveTargetIndex(command, index, cards.length);
    return {
      id: command,
      label: t(MOVES[command].label),
      // Kept in the menu and reachable, with the reason, so a person learns the card is already there
      disabledReason: target === null ? t(MOVES[command].reason) : undefined,
      onSelect: () => {
        if (target !== null) actions.moveCard(item.id, target, 'more');
      },
    };
  });

  return (
    <>
      {definition.zones.widths && widths.length > 1 ? (
        <Select
          size="sm"
          aria-label={t('widthOf', { card: name })}
          data-part="width"
          placeholder={t('widthOf', { card: name })}
          value={item.width ?? null}
          options={widthOptions}
          onValueChange={(width) => {
            actions.setCardWidth(item.id, width);
          }}
          className="w-36 pointer-coarse:h-control-touch"
        />
      ) : null}
      <CardOptionsPopover item={item} />
      <Tooltip content={t('hideTip')}>
        <Button
          variant="ghost"
          size="icon-sm"
          icon={EyeOff}
          aria-label={t('hide', { card: name })}
          className={COARSE_ICON}
          onClick={() => {
            actions.hideCard(item.id);
          }}
        />
      </Tooltip>
      <Menu
        align="end"
        items={moveItems}
        trigger={
          <IconButton
            icon={EllipsisVertical}
            label={t('moveOf', { card: name })}
            data-part="more"
            className={COARSE_ICON}
          />
        }
      />
    </>
  );
}
