'use client';

import { FileText, Hash, Slash, TriangleAlert, User, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Icon } from '@/components/ui/icon';
import { POPUP_ITEM, POPUP_SURFACE } from '@/components/ui/popup-styles';
import type { MentionType, Suggestion } from '@/lib/pages/note-mentions';
import { cn } from '@/lib/utils';

export interface NoteSuggestListProps {
  /** The id of the list: the text area names it in `aria-controls`, and every option's id is built from it. */
  id: string;
  suggestions: readonly Suggestion[];
  activeIndex: number;
  /** A row is picked on `mousedown`, so the text area keeps its focus and its caret. */
  onPick: (suggestion: Suggestion) => void;
  /** The accessible name of the list. */
  label: string;
}

/** The id of the option at `index`, which the text area names in `aria-activedescendant`. */
export const suggestOptionId = (listId: string, index: number): string => `${listId}-option-${String(index)}`;

const TYPE_ICON: Readonly<Record<MentionType, LucideIcon>> = {
  user: User,
  page: FileText,
  issue: TriangleAlert,
  keyword: Hash,
};
const TYPE_WORD: Readonly<Record<MentionType, 'teammate' | 'page' | 'issue' | 'keyword'>> = {
  user: 'teammate',
  page: 'page',
  issue: 'issue',
  keyword: 'keyword',
};

const keyOf = (suggestion: Suggestion): string =>
  suggestion.kind === 'command'
    ? `command:${suggestion.name}`
    : `${suggestion.mention.type}:${suggestion.mention.target}`;

function RowText({ suggestion }: { suggestion: Suggestion }): ReactElement {
  const t = useTranslations('pages.drawer.notes');
  if (suggestion.kind === 'command') {
    return (
      <>
        <Icon icon={Slash} size="sm" className="text-foreground-secondary" />
        <span className="type-body-strong">{`/${suggestion.name}`}</span>
        <span className="type-meta text-foreground-secondary">{t(`commands.${suggestion.name}`)}</span>
      </>
    );
  }
  const { mention, detail } = suggestion;
  return (
    <>
      <Icon icon={TYPE_ICON[mention.type]} size="sm" className="text-foreground-secondary" />
      <span className="min-w-0 type-body break-all">{mention.label}</span>
      {detail === null ? null : (
        <span className="min-w-0 type-meta break-words text-foreground-secondary">{detail}</span>
      )}
      <span className="ml-auto type-meta text-foreground-tertiary">{t(`suggestions.${TYPE_WORD[mention.type]}`)}</span>
    </>
  );
}

/**
 * The suggestions under a note box: a listbox of at most eight rows. It stays in the flow of the tab, under the text
 * area, so the drawer never clips it and it cannot run past the drawer's width. The focus never leaves the text area:
 * the rows are not focusable, the text area points at the active one.
 */
export function NoteSuggestList({ id, suggestions, activeIndex, onPick, label }: NoteSuggestListProps): ReactElement {
  return (
    <div
      id={id}
      role="listbox"
      aria-label={label}
      className={cn(POPUP_SURFACE, 'flex max-h-60 flex-col overflow-y-auto p-1')}
    >
      {suggestions.map((suggestion, index) => (
        <div
          key={keyOf(suggestion)}
          id={suggestOptionId(id, index)}
          role="option"
          aria-selected={index === activeIndex}
          // Not in the tab order: the text area keeps the focus and points at the active row
          tabIndex={-1}
          data-highlighted={index === activeIndex ? '' : undefined}
          className={cn(POPUP_ITEM, 'h-auto min-h-8 flex-wrap py-1')}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(suggestion);
          }}
        >
          <RowText suggestion={suggestion} />
        </div>
      ))}
    </div>
  );
}
