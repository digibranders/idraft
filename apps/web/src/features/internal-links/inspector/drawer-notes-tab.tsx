'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import type { PageDrawerContext } from './page-drawer-context';
import { NoteEditor, type NoteSuggestSource } from './note-editor';
import { NoteItem } from './note-item';
import { useNoteFileBox, type NoteFileBox } from './use-note-file-box';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import {
  clearNoteDraft,
  noteDraft,
  noteDraftFiles,
  noteDraftMentions,
  noteDraftPending,
  setNoteDraft,
  setNoteDraftFiles,
  setNoteDraftMentions,
  setNoteDraftPending,
} from '@/lib/pages/note-drafts';
import { keptMentions, type NoteMention } from '@/lib/pages/note-mentions';
import { attachmentIdsOf, usePageNoteWrites, usePageNotes } from '@/lib/pages/notes';

export interface DrawerNotesTabProps {
  context: PageDrawerContext;
  urlId: string;
  /** The path of the page, which names the box. */
  path: string;
  /** The tab is open: only then are the notes asked for. */
  active: boolean;
}

/**
 * The Notes tab of the page drawer (spec 9.7.3): the box that adds a note, the notes newest first with their own
 * edit and delete, and the line that says who can read them. Its state is per page, so a step to another page starts
 * it again, and the text typed and not saved is kept in `note-drafts`.
 */
export function DrawerNotesTab(props: DrawerNotesTabProps): ReactElement {
  return <NotesPanel key={props.urlId} {...props} />;
}

function NotesPanel({ context, urlId, path, active }: DrawerNotesTabProps): ReactElement {
  const t = useTranslations('pages.drawer.notes');
  const common = useTranslations('common');
  const inspector = useTranslations('internalLinks.inspector');
  const { scope, canNote } = context;
  const read = usePageNotes(scope, urlId, active);
  const writes = usePageNoteWrites(scope, urlId);

  const [text, setText] = useState(() => noteDraft(scope, urlId));
  const [mentions, setMentions] = useState<readonly NoteMention[]>(() => noteDraftMentions(scope, urlId));
  const source = useMemo<NoteSuggestSource>(
    () => ({ scope, urlId, view: { run: context.crawl.run, linkScope: context.linkScope } }),
    [scope, urlId, context.crawl.run, context.linkScope],
  );
  // The files of the box that adds a note: the draft keeps those chosen and those already uploaded for a failed save
  const files = useNoteFileBox({
    scope,
    urlId,
    initialPending: noteDraftPending(scope, urlId),
    initialKept: noteDraftFiles(scope, urlId),
    onPendingChange: (list) => setNoteDraftPending(scope, urlId, list),
    onKeptChange: (list) => setNoteDraftFiles(scope, urlId, list),
  });
  const textNow = useRef(text);
  const [editing, setEditing] = useState<string | null>(null);
  const focusEdit = useRef<string | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const restoring = useRef(new Set<string>());
  const list = useRef<HTMLOListElement | null>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const olderButton = useRef<HTMLButtonElement | null>(null);
  /** How many notes the list held when "Show older notes" was pressed, to find the first new one. */
  const olderFrom = useRef<number | null>(null);

  const change = (value: string): void => {
    textNow.current = value;
    setText(value);
    setNoteDraft(scope, urlId, value);
  };

  const changeMentions = (list: readonly NoteMention[]): void => {
    setMentions(list);
    setNoteDraftMentions(scope, urlId, list);
  };

  // After an edit ends the list is drawn again with the Edit buttons back, and the focus goes to the one of that note
  useEffect(() => {
    if (focusEdit.current === null) return;
    editButtons.current.get(focusEdit.current)?.focus();
    focusEdit.current = null;
  });

  const count = read.state === 'ready' ? read.notes.length : 0;
  useEffect(() => {
    const from = olderFrom.current;
    if (from === null || count <= from) return;
    olderFrom.current = null;
    // The button stays (and keeps the focus) while there is more; when it goes, the first new note takes the focus
    if (document.activeElement === olderButton.current) return;
    list.current?.querySelectorAll<HTMLElement>('[data-note-id]')[from]?.focus();
  }, [count]);

  const add = async (): Promise<void> => {
    const body = text.trim();
    if (body === '' && files.pending.length + files.kept.length === 0) return;
    // The files go up first, one by one; a refused one stops the save with its line under the box and loses nothing
    const stored = await files.upload();
    if (stored === null) return;
    try {
      // Only the entries whose label is still in the text go with the note
      await writes.add(body, { mentions: keptMentions(body, mentions), files: stored });
    } catch {
      toast({ type: 'error', title: t('addFailed') });
      return;
    }
    // Words typed while the note was on its way stay in the box
    if (textNow.current.trim() === body) {
      change('');
      setMentions([]);
      clearNoteDraft(scope, urlId);
    }
    files.reset();
    announce(t('added'));
    box.current?.focus();
  };

  const endEdit = (noteId: string): void => {
    focusEdit.current = noteId;
    setEditing(null);
  };

  const save = async (noteId: string, raw: string, picked: readonly NoteMention[], box: NoteFileBox): Promise<void> => {
    const body = raw.trim();
    if (body === '' && box.pending.length + box.kept.length === 0) {
      box.setNotice(t('saveNoText'));
      return;
    }
    const saved = read.state === 'ready' ? read.notes.find((note) => note.id === noteId) : undefined;
    // New files go up first; `next` is then the files that remain plus the new ones
    const next = await box.upload();
    if (next === null) return;
    // The files the note holds now: `change` leaves `attachment_ids` out unless the set differs (`[]` detaches all)
    const held = saved?.attachments ?? [];
    if (saved?.body === body && attachmentIdsOf({ held, next }) === undefined) {
      endEdit(noteId);
      return;
    }
    try {
      await writes.change(noteId, body, { mentions: keptMentions(body, picked), files: { held, next } });
    } catch {
      toast({ type: 'error', title: t('saveFailed') });
      return;
    }
    announce(t('saved'));
    endEdit(noteId);
  };

  const undo = async (noteId: string): Promise<void> => {
    // The put-back is not optimistic: a second press while one is on its way is ignored
    if (restoring.current.has(noteId)) return;
    restoring.current.add(noteId);
    announce(t('restoring'));
    try {
      await writes.restore(noteId);
    } catch {
      toast({ type: 'error', title: t('restoreFailed') });
      return;
    } finally {
      restoring.current.delete(noteId);
    }
    announce(t('restored'));
  };

  const remove = async (noteId: string): Promise<void> => {
    const done = writes.remove(noteId);
    // The note's own button goes with it, so the focus moves to the box at once, or to the tab when there is no box
    (box.current ?? panel.current)?.focus();
    try {
      await done;
    } catch {
      toast({ type: 'error', title: t('deleteFailed') });
      return;
    }
    announce(t('deleted'));
    toast({ type: 'success', title: t('deleted'), action: { label: t('undo'), onAction: () => void undo(noteId) } });
  };

  let notes: ReactElement;
  if (read.state === 'loading') {
    notes = (
      <div className="flex flex-col gap-3 py-3">
        <Skeleton shape="text-14" widthPct={48} />
        <Skeleton shape="text-14" />
        <Skeleton shape="text-14" widthPct={72} />
      </div>
    );
  } else if (read.state === 'error') {
    notes = (
      <InlineError
        title={t('loadFailed')}
        reason={inspector('loadFailedReason')}
        errorId={null}
        onRetry={read.retry}
        retrying={false}
        retryLabel={common('retry')}
      />
    );
  } else if (read.notes.length === 0) {
    notes = (
      <div className="flex flex-col gap-1 py-3">
        <p className="type-body-strong text-foreground">{t('empty')}</p>
        {canNote ? <p className="type-body text-foreground-secondary">{t('emptyWhy')}</p> : null}
      </div>
    );
  } else {
    notes = (
      <>
        <ol ref={list} aria-label={t('listLabel')} className="flex flex-col divide-y divide-border-subtle">
          {read.notes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              editing={editing === note.id}
              pending={writes.pending}
              onEdit={() => setEditing(note.id)}
              onCancel={() => endEdit(note.id)}
              onSave={(body, picked, box) => void save(note.id, body, picked, box)}
              source={source}
              onOpenPage={context.openPage}
              issueHref={context.hrefs.issueCheck}
              onDelete={() => void remove(note.id)}
              editButtonRef={(element) => {
                if (element === null) editButtons.current.delete(note.id);
                else editButtons.current.set(note.id, element);
              }}
            />
          ))}
        </ol>
        {read.hasMore ? (
          <Button
            ref={olderButton}
            variant="secondary"
            size="sm"
            className="self-start"
            loading={read.loadingMore}
            onClick={() => {
              olderFrom.current = read.notes.length;
              read.loadMore();
            }}
          >
            {t('showOlder')}
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <div ref={panel} tabIndex={-1} className="flex flex-col gap-3 outline-none">
      {canNote ? (
        <NoteEditor
          label={t('addLabel', { path })}
          value={text}
          onChange={change}
          mentions={mentions}
          onMentionsChange={changeMentions}
          source={source}
          files={files}
          onSave={() => void add()}
          saveLabel={t('add')}
          pending={writes.pending}
          area={box}
        />
      ) : null}
      {notes}
      <p className="type-meta text-foreground-tertiary">{t('footer')}</p>
    </div>
  );
}
