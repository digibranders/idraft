'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { isValidElement, type ReactElement, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';
import type { MenuItemDef } from '@/components/ui/menu';
import { SplitButton } from '@/components/ui/split-button';
import { Tooltip } from '@/components/ui/tooltip';

/** What `LinkButton` asks of the link it renders. */
interface LinkProps {
  className?: string | undefined;
  children?: ReactNode;
}

export interface AddEntryProps {
  onAdd: () => void;
  /** The registry's alternatives (`addMenuItems`). With none the entry is a plain button. */
  alternatives: readonly MenuItemDef[];
}

/**
 * Add prompts in the page header. A plain button, and a split button only when the registry has an alternative: its
 * menu never repeats the default action. In the plain button the label gives way to the icon below 640 px and stays
 * the accessible name. `SplitButton` takes a text label, so its label stays at every width.
 */
export function AddEntry({ onAdd, alternatives }: AddEntryProps): ReactElement {
  const t = useTranslations('prompts');
  if (alternatives.length > 0) {
    return (
      <SplitButton
        variant="primary"
        size="sm"
        icon={Plus}
        onClick={onAdd}
        groupLabel={t('add.entry.groupLabel')}
        menuLabel={t('add.entry.menuLabel')}
        items={alternatives}
      >
        {t('addPrompts')}
      </SplitButton>
    );
  }
  return (
    <Button variant="primary" size="sm" icon={Plus} onClick={onAdd}>
      <span className="sr-only sm:not-sr-only">{t('addPrompts')}</span>
    </Button>
  );
}

/** Add prompts as the one primary action of an empty state, with its label at every width. */
export function AddEmptyPrimary({ onAdd }: { onAdd: () => void }): ReactElement {
  const t = useTranslations('prompts');
  return (
    <Button variant="primary" size="sm" icon={Plus} onClick={onAdd}>
      {t('addPrompts')}
    </Button>
  );
}

/**
 * The registry's alternatives as text actions beside the primary action of an empty state: a link for an item that
 * navigates, a button for the rest. An item that is off stays reachable by keyboard and says why in a tooltip.
 */
export function AddEmptyAlternatives({ alternatives }: { alternatives: readonly MenuItemDef[] }): ReactElement {
  return (
    <>
      {alternatives.map((item) => {
        const { link } = item;
        if (item.kind === 'link' && isValidElement<LinkProps>(link) && item.disabledReason === undefined) {
          return (
            <LinkButton key={item.id} render={link} variant="link" size="sm">
              {item.label}
            </LinkButton>
          );
        }
        const off = item.disabledReason !== undefined;
        const button = (
          <Button key={item.id} variant="link" size="sm" onClick={item.onSelect} disabled={off} focusableWhenDisabled>
            {item.label}
          </Button>
        );
        return item.disabledReason === undefined ? (
          button
        ) : (
          <Tooltip key={item.id} content={item.disabledReason} purpose="description">
            {button}
          </Tooltip>
        );
      })}
    </>
  );
}
