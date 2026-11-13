'use client';

/**
 * The options of one card (docs/superpowers/plans/2026-11-13-ai-wp-15-layouts-core.md, section 2.7, WB-LAY-19):
 * one radio group per option of its type, each choice applied to the draft at once. The option that tells the
 * instances of a reusable type apart (the engine of a trend card) cannot take a value another instance has.
 */
import { Settings2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useLayoutScreen } from './layout-provider';
import { IconButton } from '@/components/ui/icon-button';
import { Popover } from '@/components/ui/popover';
import { RadioGroup, type RadioOption } from '@/components/ui/radio-group';
import { cardName, cardType, identityOption, takenIdentityValues, type CardItem } from '@/lib/layouts';

export interface CardOptionsPopoverProps {
  item: CardItem;
}

/** The Options button of a card and the popover it opens. Renders nothing for a type without options. */
export function CardOptionsPopover({ item }: CardOptionsPopoverProps): ReactElement | null {
  const t = useTranslations('layouts.core');
  const { actions, document } = useLayoutScreen();
  const type = cardType(item.type);
  if (type === undefined || Object.keys(type.options).length === 0) return null;

  const name = cardName(item);
  const identity = identityOption(type);
  const taken = takenIdentityValues(document, type, item.id);
  return (
    <Popover
      title={t('optionsFor', { card: name })}
      trigger={
        <IconButton
          icon={Settings2}
          label={t('optionsFor', { card: name })}
          data-part="options"
          className="pointer-coarse:size-control-touch"
        />
      }
      align="end"
    >
      {Object.entries(type.options).map(([key, option]) => {
        const values: RadioOption<string>[] = option.values.map((value) => {
          const isTaken = key === identity && taken.has(value.value);
          return {
            value: value.value,
            label: value.label,
            disabled: isTaken,
            description: isTaken ? t('optionTaken') : undefined,
          };
        });
        return (
          <RadioGroup
            key={key}
            legend={option.label}
            value={item.options?.[key] ?? option.default}
            options={values}
            onValueChange={(value) => {
              actions.setCardOption(item.id, key, value);
            }}
          />
        );
      })}
    </Popover>
  );
}
