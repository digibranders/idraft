'use client';

/**
 * The card catalog (spec section 5.4, plan T2): a 720 px dialog with a search field and the card types of the
 * screen in four groups. Adding a card closes it and hands focus to the new card; closing any other way
 * returns focus to what opened it.
 */
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type ChangeEvent, type ReactElement, type RefObject } from 'react';

import { useLayoutAnnouncer } from '../announcements';
import { useLayoutScreen } from '../layout-provider';
import { CardSchematic } from './card-schematic';
import { catalogEntries, type CatalogEntry, type CatalogState } from './catalog-entries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogHeader } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { browserTimeZone, formatIsoDate } from '@/lib/format';

export interface CardCatalogDialogProps {
  open: boolean;
  /** Where the card goes in the document: the slot that opened the catalog. */
  index: number;
  onOpenChange: (open: boolean) => void;
  /** ISO business date for the New badge; today by default, fixed by a test. */
  today?: string | undefined;
}

/** The label of the button of each state. */
const STATE_LABEL = {
  add: 'add',
  addAnother: 'addAnother',
  added: 'added',
  unavailable: 'unavailable',
  pageFull: 'pageFull',
} as const satisfies Record<CatalogState, string>;

interface EntryRowProps {
  entry: CatalogEntry;
  onAdd: (typeKey: string) => void;
}

function EntryRow({ entry, onAdd }: EntryRowProps): ReactElement {
  const t = useTranslations('layouts.customize.catalog');
  const id = useId();
  const titleId = `${id}-title`;
  const reasonId = `${id}-reason`;
  const { type, state, reason } = entry;
  const acts = state === 'add' || state === 'addAnother';
  return (
    <li className="flex items-start gap-3 border-t border-border-subtle py-2">
      <CardSchematic typeKey={type.key} />
      <div className="flex min-w-0 flex-1 flex-col">
        <p id={titleId} className="flex flex-wrap items-center gap-x-2 type-body-strong text-foreground">
          {type.title}
          {entry.isNew ? <Badge tone="info">{t('isNew')}</Badge> : null}
        </p>
        <p className="type-meta">{type.description}</p>
        {reason === undefined ? null : (
          <p id={reasonId} className="type-meta text-warning-text">
            {reason}
          </p>
        )}
      </div>
      <Button
        size="sm"
        variant="secondary"
        disabled={!acts}
        // A button that acts says which card; one that does not points at the card or at why it cannot
        {...(acts
          ? { 'aria-label': t(state === 'add' ? 'addLabel' : 'addAnotherLabel', { card: type.title }) }
          : { 'aria-describedby': reason === undefined ? titleId : reasonId })}
        onClick={() => {
          onAdd(type.key);
        }}
        className="whitespace-nowrap"
      >
        {t(STATE_LABEL[state])}
      </Button>
    </li>
  );
}

interface CatalogContentProps {
  index: number;
  today: string | undefined;
  searchRef: RefObject<HTMLInputElement | null>;
  /** The person added a card: focus belongs to it, not to what opened the dialog. */
  onAdded: () => void;
  onClose: () => void;
}

/** Everything inside the dialog. It goes with the popup, so the search starts empty each time. */
function CatalogContent({ index, today, searchRef, onAdded, onClose }: CatalogContentProps): ReactElement {
  const t = useTranslations('layouts.customize.catalog');
  const { screen, document, availabilityOf, actions } = useLayoutScreen();
  const announcer = useLayoutAnnouncer();
  const [query, setQuery] = useState('');
  // What the last announcement said, so typing that changes nothing is not read out again
  const announced = useRef<string | null>(null);
  const date = today ?? formatIsoDate(new Date(), browserTimeZone());
  const groupsFor = (text: string): ReturnType<typeof catalogEntries> =>
    catalogEntries({ screen, document, availabilityOf, query: text, today: date });
  const groups = groupsFor(query);

  const search = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = event.target.value;
    setQuery(next);
    const count = groupsFor(next).reduce((sum, group) => sum + group.entries.length, 0);
    const message = count === 0 ? t('noMatch', { query: next.trim() }) : t('results', { count });
    if (message === announced.current) return;
    announced.current = message;
    announcer.say(message);
  };

  return (
    <>
      <DialogHeader title={t('title')} description={t('description')} closeLabel={t('close')} />
      <div className="shrink-0 px-6 pb-3">
        <Input
          ref={searchRef}
          type="search"
          aria-label={t('search')}
          placeholder={t('search')}
          autoComplete="off"
          value={query}
          onChange={search}
        />
      </div>
      <DialogBody>
        {groups.length === 0 ? (
          <p className="py-6 text-center type-meta">{t('noMatch', { query: query.trim() })}</p>
        ) : (
          groups.map(({ group, entries }) => (
            <section key={group} aria-labelledby={`catalog-group-${group}`} className="flex flex-col">
              <h3 id={`catalog-group-${group}`} className="pb-1 type-label">
                {t(`groups.${group}`)}
              </h3>
              <ul className="flex flex-col">
                {entries.map((entry) => (
                  <EntryRow
                    key={entry.type.key}
                    entry={entry}
                    onAdd={(typeKey) => {
                      onAdded();
                      actions.addCard(typeKey, index);
                      onClose();
                    }}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </DialogBody>
    </>
  );
}

/** Inside a `LayoutProvider`, in customize mode. The customize controller owns when it is open. */
export function CardCatalogDialog({ open, index, onOpenChange, today }: CardCatalogDialogProps): ReactElement {
  const searchRef = useRef<HTMLInputElement>(null);
  const added = useRef(false);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      initialFocus={searchRef}
      // After an add the provider has asked the grid to focus the new card; every other way out goes back to the opener
      finalFocus={() => {
        const restore = !added.current;
        added.current = false;
        return restore;
      }}
    >
      <CatalogContent
        index={index}
        today={today}
        searchRef={searchRef}
        onAdded={() => {
          added.current = true;
        }}
        onClose={() => {
          onOpenChange(false);
        }}
      />
    </Dialog>
  );
}
