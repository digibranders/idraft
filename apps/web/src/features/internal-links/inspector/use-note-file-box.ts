'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { announce } from '@/lib/a11y/announcer';
import { formatBytes, formatInteger } from '@/lib/format';
import type { LinksScope, PageNoteFile } from '@/lib/internal-links/types';
import { NOTE_FILES_MAX, NOTE_FILE_MAX_BYTES, checkNewFiles } from '@/lib/pages/note-files';
import { isNoteFileRefusal, useNoteFileUpload, type NoteFileRefusalKind } from '@/lib/pages/note-uploads';

export interface NoteFileBoxOptions {
  scope: LinksScope;
  urlId: string;
  /** Files chosen and not uploaded yet. */
  initialPending?: readonly File[] | undefined;
  /** Files already stored: the ones a note in edit holds, or the ones a draft uploaded before a failed save. */
  initialKept?: readonly PageNoteFile[] | undefined;
  onPendingChange?: ((files: readonly File[]) => void) | undefined;
  onKeptChange?: ((files: readonly PageNoteFile[]) => void) | undefined;
}

/** What one note box holds as files, and how they go up. */
export interface NoteFileBox {
  pending: readonly File[];
  kept: readonly PageNoteFile[];
  /** The stored files the box opened with: the baseline an edit is compared to, however the note changes meanwhile. */
  began: readonly PageNoteFile[];
  /** The one refusal line under the box. */
  notice: string | null;
  setNotice: (text: string | null) => void;
  /** Share of each file sent, 0 to 1, for the files of the upload that is running. */
  progress: ReadonlyMap<File, number>;
  uploading: boolean;
  /** Takes the files the pre-check accepts and words the others in `notice`. */
  add: (incoming: readonly File[]) => void;
  /** Removing a file that is being uploaded stops the upload. */
  removePending: (file: File) => void;
  removeKept: (id: string) => void;
  /**
   * Uploads what is pending, one file at a time. Resolves with every stored file of the box (the kept ones and the new
   * ones, in that order), or `null` when a file was refused (`notice` says so) or the upload was stopped. A file that
   * went up stays in `kept`, so a retry sends only the rest.
   */
  upload: () => Promise<readonly PageNoteFile[] | null>;
  /** After a save: nothing is held any more. */
  reset: () => void;
}

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

/** The state of the files in one note box (the box that adds a note and the box of each edit). */
export function useNoteFileBox({
  scope,
  urlId,
  initialPending = [],
  initialKept = [],
  onPendingChange,
  onKeptChange,
}: NoteFileBoxOptions): NoteFileBox {
  const t = useTranslations('pages.drawer.notes.files');
  const sender = useNoteFileUpload(scope, urlId);
  const [pending, setPendingState] = useState<readonly File[]>(initialPending);
  const [kept, setKeptState] = useState<readonly PageNoteFile[]>(initialKept);
  // What the box held when it opened: for an edit, the files the note had when the edit began
  const [began] = useState<readonly PageNoteFile[]>(initialKept);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<ReadonlyMap<File, number>>(new Map());
  const [uploading, setUploading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef<File | null>(null);
  // The live lists: a run that awaits a file must not write back the lists it started with
  const pendingRef = useRef(initialPending);
  const keptRef = useRef(initialKept);

  // A box that goes away (Cancel, Escape, the drawer closing) stops its upload, and the save that awaits it does not go on
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  const setPending = (files: readonly File[]): void => {
    pendingRef.current = files;
    setPendingState(files);
    onPendingChange?.(files);
  };
  const setKept = (files: readonly PageNoteFile[]): void => {
    keptRef.current = files;
    setKeptState(files);
    onKeptChange?.(files);
  };

  const wording = (kind: NoteFileRefusalKind | 'duplicate', name: string): string => {
    switch (kind) {
      case 'count':
        return t('tooMany', { max: formatInteger(NOTE_FILES_MAX) });
      case 'type':
        return t('wrongType', { name });
      case 'size':
        return t('tooBig', { name, max: formatBytes(NOTE_FILE_MAX_BYTES) });
      case 'empty':
        return t('empty', { name });
      case 'duplicate':
        return t('duplicate', { name });
      case 'quota':
        return t('quota');
      case 'storage':
        return t('storage');
      case 'failed':
        return t('failed', { name });
    }
  };

  const add = (incoming: readonly File[]): void => {
    if (incoming.length === 0) return;
    // Files go in a batch: more are taken once it is done, and the box says so
    if (controller.current !== null) {
      setNotice(t('busy'));
      return;
    }
    const { accepted, refused } = checkNewFiles(
      pendingRef.current.length + keptRef.current.length,
      incoming,
      pendingRef.current,
    );
    // One line: a new accepted file with nothing refused clears the last one
    setNotice(
      refused.length === 0
        ? null
        : refused.map((item) => wording(item.kind, 'name' in item ? item.name : '')).join(' '),
    );
    if (accepted.length > 0) setPending([...pendingRef.current, ...accepted]);
  };

  const removePending = (file: File): void => {
    // Only the file on its way stops the request; the others are skipped when their turn comes
    if (inFlight.current === file) controller.current?.abort();
    setPending(pendingRef.current.filter((held) => held !== file));
  };

  const upload = async (): Promise<readonly PageNoteFile[] | null> => {
    if (pendingRef.current.length === 0) return keptRef.current;
    const run = new AbortController();
    controller.current = run;
    setUploading(true);
    setNotice(null);
    const batch = [...pendingRef.current];
    try {
      for (const [index, file] of batch.entries()) {
        if (!pendingRef.current.includes(file)) continue;
        announce(t('uploading', { done: index + 1, total: batch.length }), { key: 'note-files-upload' });
        inFlight.current = file;
        try {
          const done = await sender.upload(file, {
            signal: run.signal,
            onProgress: ({ loaded, total }) =>
              setProgress((held) => new Map(held).set(file, total === null || total === 0 ? 0 : loaded / total)),
          });
          // Stopped while the last bytes were on their way: the caller must not go on to write
          if (run.signal.aborted) return null;
          setKept([...keptRef.current, done]);
          setPending(pendingRef.current.filter((held) => held !== file));
        } catch (error) {
          if (isAbort(error)) return null;
          if (!isNoteFileRefusal(error)) throw error;
          setNotice(wording(error.kind, file.name));
          return null;
        }
      }
      return run.signal.aborted ? null : keptRef.current;
    } finally {
      setUploading(false);
      setProgress(new Map());
      inFlight.current = null;
      controller.current = null;
    }
  };

  return {
    pending,
    kept,
    began,
    notice,
    setNotice,
    progress,
    uploading,
    add,
    removePending,
    removeKept: (id) => setKept(keptRef.current.filter((file) => file.id !== id)),
    upload,
    reset: () => {
      setPending([]);
      setKept([]);
      setNotice(null);
    },
  };
}
