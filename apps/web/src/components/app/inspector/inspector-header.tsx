'use client';

import { ChevronDown, ChevronLeft, ChevronUp, EllipsisVertical, Maximize2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, type ReactElement, type ReactNode, type Ref } from 'react';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';

/** The keys the tooltips name: Escape closes, K and J step (16 sections 2.1 and 2.10). */
const CLOSE_KEYS = ['esc'];
const PREVIOUS_KEYS = ['k'];
const NEXT_KEYS = ['j'];

export interface InspectorNavigation {
  onPrevious: () => void;
  onNext: () => void;
  atFirst: boolean;
  atLast: boolean;
}

export interface InspectorHeaderProps {
  titleId: string;
  /** The title takes focus when the inspector opens (16 section 2.8). */
  titleRef?: Ref<HTMLHeadingElement> | undefined;
  /**
   * The record's name, clamped to two lines; the first card repeats it in full when it is long. Empty while
   * the name is not known: the type label stands in.
   */
  title: string;
  /** The title's language, when it is not the interface's (a keyword in German). */
  lang?: string | undefined;
  /** "Keyword", first in the context line. */
  typeLabel: string;
  /** "keyword", in the names of Previous and Next. */
  typeNoun: string;
  /** "12 of 986"; left out for a record that is not in the list (a shared link). */
  positionText?: string | null | undefined;
  /** A `FreshnessIndicator`, or a compact `CollectionProgress` while a collection runs. */
  freshness?: ReactNode;
  /** At most 4 status badges, 8 px under the title. */
  badges?: ReactNode;
  /** The object's most frequent command, a 32 px secondary button: "Check now". */
  frequentAction?: ReactNode;
  /** "Open page", for objects that have a full page. */
  onOpenPage?: (() => void) | null | undefined;
  /** Previous and Next in the list's order; left out with the position counter. */
  navigation?: InspectorNavigation | null | undefined;
  moreActions: readonly MenuItemDef[];
  /** The More button, for a dialog that opens from its menu to give focus back to. */
  moreButtonRef?: Ref<HTMLButtonElement> | undefined;
  onClose: () => void;
  /** The sheet below 768 px goes back to the list instead of closing: "Back to Rankings". */
  backLabel?: string | null | undefined;
}

/**
 * The inspector's header (16-drawers-dialogs-popovers.md section 2.1, 25 deviations 30 and 131): the title
 * with Open page, More and Close; the badges with the frequent command; then the context line (type,
 * position, freshness) with Previous and Next. Five actions at most besides Open page.
 */
export function InspectorHeader({
  titleId,
  titleRef,
  title,
  lang,
  typeLabel,
  typeNoun,
  positionText,
  freshness,
  badges,
  frequentAction,
  onOpenPage,
  navigation,
  moreActions,
  moreButtonRef,
  onClose,
  backLabel,
}: InspectorHeaderProps): ReactElement {
  const t = useTranslations('inspector');
  const context = [typeLabel, positionText ?? null].filter((part): part is string => part !== null);
  // A record with no name yet (a link to one that is gone, or a list that has not reached it) is named by
  // its type: the title takes focus and labels the landmark, so it is never empty
  const heading = title.trim() === '' ? typeLabel : title;
  return (
    <div className="flex flex-col gap-2 px-4 pt-4">
      {backLabel === null || backLabel === undefined ? null : (
        <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={onClose} className="-ml-2 self-start">
          {backLabel}
        </Button>
      )}
      <div className="flex items-start gap-2">
        <h2
          ref={titleRef}
          id={titleId}
          tabIndex={-1}
          lang={lang}
          className="line-clamp-2 min-w-0 flex-1 type-inspector-title text-balance text-foreground outline-none"
        >
          {heading}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {onOpenPage === null || onOpenPage === undefined ? null : (
            <IconButton icon={Maximize2} variant="ghost" label={t('openPage')} onClick={onOpenPage} />
          )}
          {moreActions.length === 0 ? null : (
            <Menu
              align="end"
              // Named by the record: the page's own More actions button may be on screen beside it
              trigger={
                <IconButton
                  ref={moreButtonRef}
                  icon={EllipsisVertical}
                  variant="ghost"
                  label={t('moreActionsFor', { name: heading })}
                />
              }
              items={moreActions}
            />
          )}
          {backLabel === null || backLabel === undefined ? (
            <IconButton icon={X} variant="ghost" label={t('close')} shortcut={CLOSE_KEYS} onClick={onClose} />
          ) : null}
        </div>
      </div>
      {/* The frequent command sits beside the badges, not beside the title, so a 400 px card keeps the
          title on one line where it fits (25 deviation 131) */}
      {(badges === undefined || badges === null) && (frequentAction === undefined || frequentAction === null) ? null : (
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">{badges}</div>
          {frequentAction === undefined || frequentAction === null ? null : (
            <div className="shrink-0">{frequentAction}</div>
          )}
        </div>
      )}
      <div className="flex min-h-control-sm items-center gap-2">
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 type-meta">
          {context.map((part, index) => (
            <Fragment key={part}>
              {index > 0 ? <span aria-hidden="true">{t('separator')}</span> : null}
              <span className="num">{part}</span>
            </Fragment>
          ))}
          {freshness === undefined || freshness === null ? null : (
            <>
              <span aria-hidden="true">{t('separator')}</span>
              {freshness}
            </>
          )}
        </p>
        {navigation === null || navigation === undefined ? null : (
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              icon={ChevronUp}
              variant="ghost"
              label={navigation.atFirst ? t('firstInList', { type: typeNoun }) : t('previous', { type: typeNoun })}
              shortcut={PREVIOUS_KEYS}
              disabled={navigation.atFirst}
              focusableWhenDisabled
              onClick={navigation.onPrevious}
            />
            <IconButton
              icon={ChevronDown}
              variant="ghost"
              label={navigation.atLast ? t('lastInList', { type: typeNoun }) : t('next', { type: typeNoun })}
              shortcut={NEXT_KEYS}
              disabled={navigation.atLast}
              focusableWhenDisabled
              onClick={navigation.onNext}
            />
          </div>
        )}
      </div>
    </div>
  );
}
