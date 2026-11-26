'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

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
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<ReadonlyMap<File, number>>(new Map());
  const [uploading, setUploading] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const setPending = (files: readonly File[]): void => {
    setPendingState(files);
    onPendingChange?.(files);
  };
  const setKept = (files: readonly PageNoteFile[]): void => {
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
    if (uploading || incoming.length === 0) return;
    const { accepted, refused } = checkNewFiles(pending.length + kept.length, incoming, pending);
    // One line: a new accepted file with nothing refused clears the last one
    setNotice(
      refused.length === 0
        ? null
        : refused.map((item) => wording(item.kind, 'name' in item ? item.name : '')).join(' '),
    );
    if (accepted.length > 0) setPending([...pending, ...accepted]);
  };

  const removePending = (file: File): void => {
    controller.current?.abort();
    setPending(pending.filter((held) => held !== file));
  };

  const upload = async (): Promise<readonly PageNoteFile[] | null> => {
    if (pending.length === 0) return kept;
    const run = new AbortController();
    controller.current = run;
    setUploading(true);
    setNotice(null);
    let stored = [...kept];
    let left = [...pending];
    try {
      for (const [index, file] of pending.entries()) {
        announce(t('uploading', { done: index + 1, total: pending.length }), { key: 'note-files-upload' });
        try {
          const done = await sender.upload(file, {
            signal: run.signal,
            onProgress: ({ loaded, total }) =>
              setProgress((held) => new Map(held).set(file, total === null || total === 0 ? 0 : loaded / total)),
          });
          stored = [...stored, done];
          left = left.filter((held) => held !== file);
          setKept(stored);
          setPending(left);
        } catch (error) {
          if (isAbort(error)) return null;
          if (!isNoteFileRefusal(error)) throw error;
          setNotice(wording(error.kind, file.name));
          return null;
        }
      }
      return stored;
    } finally {
      setUploading(false);
      setProgress(new Map());
      controller.current = null;
    }
  };

  return {
    pending,
    kept,
    notice,
    setNotice,
    progress,
    uploading,
    add,
    removePending,
    removeKept: (id) => setKept(kept.filter((file) => file.id !== id)),
    upload,
    reset: () => {
      setPending([]);
      setKept([]);
      setNotice(null);
    },
  };
}
