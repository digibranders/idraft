'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from 'react';

import { AttachButton, NoteFilesBar, useNoteDropZone } from './note-files-bar';
import { NoteSuggestList, NoteSuggestStatus, suggestOptionId } from './note-suggest-list';
import type { NoteFileBox } from './use-note-file-box';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { announce } from '@/lib/a11y/announcer';
import { browserTimeZone, formatInteger, formatTableDate } from '@/lib/format';
import type { LinksScope } from '@/lib/internal-links/types';
import { useNoteSources, type NoteSourceView } from '@/lib/pages/note-sources';
import { pickInto, suggestionsFor, triggerAt, type NoteMention, type Suggestion } from '@/lib/pages/note-mentions';
import { NOTE_COUNT_FROM, NOTE_MAX } from '@/lib/pages/notes';

/** What the box needs to offer mentions: the page it writes about and the crawl in view. */
export interface NoteSuggestSource {
  scope: LinksScope;
  urlId: string;
  view: NoteSourceView;
}

export interface NoteEditorProps {
  /** The name of the box. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The mentions picked into the text; some may have lost their label since (a save sends only the ones that kept it). */
  mentions: readonly NoteMention[];
  onMentionsChange: (mentions: readonly NoteMention[]) => void;
  source: NoteSuggestSource;
  /** The files of the box: chosen, dropped or pasted into it, and the ones a note already holds. */
  files: NoteFileBox;
  onSave: () => void;
  /** Given for an edit: Escape and a Cancel button then leave it. The box that adds a note has none. */
  onCancel?: (() => void) | undefined;
  saveLabel: string;
  /** A write is running. */
  pending: boolean;
  /** The text area takes the focus when the editor mounts. */
  focusOnOpen?: boolean | undefined;
  /** The caller's handle on the text area: it moves the focus there, and the key listener reads it. */
  area: RefObject<HTMLTextAreaElement | null>;
}

/** The pause before the number of suggestions is spoken, so typing is not read out letter by letter. */
const ANNOUNCE_DELAY_MS = 300;

/**
 * The text box of a note, for a new one and for an edit: a named text area with its count from 1,800 characters, its
 * hint, and Save (or Add note) and Cancel under it. It is a combobox (ARIA 1.2): an at sign or a slash that starts a
 * word opens a list of suggestions under it, and the focus stays in the text area throughout.
 */
export function NoteEditor({
  label,
  value,
  onChange,
  mentions,
  onMentionsChange,
  source,
  files,
  onSave,
  onCancel,
  saveLabel,
  pending,
  focusOnOpen = false,
  area,
}: NoteEditorProps): ReactElement {
  const t = useTranslations('pages.drawer.notes');
  const listId = useId();
  // A note needs text or a file
  const empty = value.trim() === '' && files.pending.length + files.kept.length === 0;
  const busy = pending || files.uploading;
  const drop = useNoteDropZone(files);

  const [caret, setCaret] = useState(value.length);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  // Escape closes the list for the word it was open on; typing opens it again
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const found = focused ? triggerAt(value, caret) : null;
  const trigger = found !== null && found.start === dismissedAt ? null : found;
  // A slash command offers only its own names, so nothing is asked of the API for it
  const { sources, loading, failed, retry } = useNoteSources(
    source.scope,
    source.urlId,
    trigger?.query ?? '',
    trigger !== null && trigger.kind !== 'command',
    source.view,
  );
  const rows = trigger === null ? [] : suggestionsFor(trigger, sources);
  const open = rows.length > 0;
  const activeIndex = Math.min(active, Math.max(rows.length - 1, 0));
  // A source that is still being read or failed is said, not left as a list that is quietly short
  const status = trigger === null ? null : failed ? 'failed' : loading ? 'loading' : null;
  const retryButton = useRef<HTMLButtonElement | null>(null);

  const rowCount = rows.length;
  useEffect(() => {
    const options = { key: 'note-suggestions', debounceMs: ANNOUNCE_DELAY_MS };
    if (status === 'failed') announce(t('suggestions.failed'), options);
    else if (status === 'loading') announce(t('suggestions.searching'), options);
    else if (rowCount > 0) announce(t('suggestions.count', { count: rowCount }), options);
  }, [rowCount, status, t]);

  // Where the caret goes once the text a pick wrote is in the box
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = area.current;
    const at = pendingCaret.current;
    if (element === null || at === null) return;
    pendingCaret.current = null;
    element.setSelectionRange(at, at);
  }, [value, area]);

  const pick = (suggestion: Suggestion): void => {
    if (trigger === null) return;
    const next = pickInto(value, mentions, trigger, suggestion, formatTableDate(new Date(), browserTimeZone()));
    if (next.text.length > NOTE_MAX) {
      announce(t('suggestions.tooLong'), { politeness: 'assertive' });
      return;
    }
    pendingCaret.current = next.caret;
    onChange(next.text);
    onMentionsChange(next.mentions);
    setCaret(next.caret);
    setActive(0);
    setDismissedAt(null);
  };

  // The key handler is bound once and reads what is current through this ref
  const latest = useRef({ onSave, onCancel, blocked: empty || busy, rows, activeIndex, trigger, pick });
  useEffect(() => {
    latest.current = { onSave, onCancel, blocked: empty || busy, rows, activeIndex, trigger, pick };
  });

  // Native, not React's `onKeyDown`: the drawer closes on Escape from a native listener on its card, which runs
  // before a React handler. A listener on the text area itself runs first and can stop the event there. (While the
  // list is open the box is a combobox with `aria-expanded`, which the drawer's own Escape rule leaves alone too.)
  useEffect(() => {
    const element = area.current;
    if (element === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing) return;
      const {
        onSave: save,
        onCancel: cancel,
        blocked,
        rows: shown,
        activeIndex: current,
        trigger: word,
        pick: choose,
      } = latest.current;
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
      if (shown.length > 0 && word !== null) {
        const row = shown[current];
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const step = event.key === 'ArrowDown' ? 1 : -1;
          setActive((current + step + shown.length) % shown.length);
          return;
        }
        if (row !== undefined && plain && !event.shiftKey && (event.key === 'Enter' || event.key === 'Tab')) {
          event.preventDefault();
          choose(row);
          return;
        }
        if (event.key === 'Escape') {
          // The list goes first: not the text, the edit or the drawer
          event.preventDefault();
          event.stopPropagation();
          setDismissedAt(word.start);
          return;
        }
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (!blocked) save();
      } else if (event.key === 'Escape' && cancel !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    element.addEventListener('keydown', onKeyDown);
    return () => element.removeEventListener('keydown', onKeyDown);
  }, [area]);

  // The box of an edit takes the focus when it opens
  useEffect(() => {
    if (focusOnOpen) area.current?.focus();
  }, [focusOnOpen, area]);

  return (
    <Field className="relative" {...drop.zoneProps}>
      <FieldLabel display="visually-hidden">{label}</FieldLabel>
      <Textarea
        ref={area}
        value={value}
        // ARIA 1.2 allows a combobox on a multi-line text box; axe's `aria-allowed-role` does not list a textarea for it
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? suggestOptionId(listId, activeIndex) : undefined}
        // The box counts UTF-16 units, so it is stricter than the server's code point count (an emoji takes two here)
        maxLength={NOTE_MAX}
        placeholder={t('placeholder')}
        counter={
          value.length >= NOTE_COUNT_FROM
            ? t('count', { count: formatInteger(value.length), max: formatInteger(NOTE_MAX) })
            : null
        }
        onChange={(event) => {
          onChange(event.currentTarget.value);
          setCaret(event.currentTarget.selectionStart);
          setActive(0);
          setDismissedAt(null);
        }}
        onPaste={(event) => {
          // A picture from the clipboard becomes a file; text that comes with it (a copied cell) is pasted as text
          const pasted = [...event.clipboardData.files];
          if (pasted.length === 0 || event.clipboardData.getData('text/plain') !== '') return;
          event.preventDefault();
          files.add(pasted);
        }}
        onClick={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyUp={(event) => setCaret(event.currentTarget.selectionStart)}
        onFocus={() => setFocused(true)}
        // The list stays while the focus goes to the retry button of the status row
        onBlur={(event) => setFocused(retryButton.current !== null && event.relatedTarget === retryButton.current)}
      />
      {open ? (
        <NoteSuggestList
          id={listId}
          suggestions={rows}
          activeIndex={activeIndex}
          onPick={pick}
          label={t('suggestions.label')}
        />
      ) : null}
      {status === null ? null : (
        <NoteSuggestStatus
          kind={status}
          retryRef={retryButton}
          onRetry={() => {
            retry();
            area.current?.focus();
          }}
          onRetryBlur={(next) => setFocused(next === area.current)}
        />
      )}
      <NoteFilesBar
        box={files}
        onKeptRemoved={(left) => {
          // The last file of a note with no text: the note cannot be saved, and the box says why
          if (left === 0 && value.trim() === '') files.setNotice(t('saveNoText'));
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={empty || busy} loading={files.uploading} onClick={onSave}>
          {saveLabel}
        </Button>
        {onCancel === undefined ? null : (
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {t('cancel')}
          </Button>
        )}
        <AttachButton box={files} />
        <FieldDescription>{t('hint')}</FieldDescription>
      </div>
      {drop.overlay}
    </Field>
  );
}
