'use client';

import { useState } from 'react';
import { z } from 'zod';

import { isApiProblem } from '@/lib/api/problem';
import { uploadForm, type UploadProgress } from '@/lib/api/upload';
import { noteFilesPath } from '@/lib/internal-links/queries';
import type { LinksScope, PageNoteFile } from '@/lib/internal-links/types';

/**
 * What the box can word when a file is refused: `size` (over 10 MB), `type` (not one of the seven), `empty`, `quota`
 * (the workspace has used its space), `storage` (the server could not store it), `failed` (anything else, a lost
 * connection included), and `count` (a note write named more than 5 files). Only the server reads the bytes, so its
 * answer is the one that counts.
 */
export type NoteFileRefusalKind = 'size' | 'type' | 'empty' | 'quota' | 'storage' | 'count' | 'failed';

/** An upload that was refused. An abort is not one: it rejects with the browser's own `AbortError`. */
export class NoteFileRefusal extends Error {
  override readonly name = 'NoteFileRefusal';
  constructor(readonly kind: NoteFileRefusalKind) {
    super(`The note file was refused: ${kind}`);
  }
}

export const isNoteFileRefusal = (error: unknown): error is NoteFileRefusal => error instanceof NoteFileRefusal;

/** The refusal an API error stands for, from its status first (a proxy may drop the body) and its codes after. */
export function refusalKindOf(error: unknown): NoteFileRefusalKind {
  if (!isApiProblem(error)) return 'failed';
  if (error.status === 413) return 'size';
  if (error.status === 415) return 'type';
  if (error.status === 503) return 'storage';
  if (error.code === 'quota_exceeded') return 'quota';
  if (error.errors.some((item) => item.path === 'file' && item.code === 'file_empty')) return 'empty';
  // The list is capped by the schema (`too_long`); the service has its own code for the same limit
  if (
    error.errors.some(
      (item) => item.path === 'attachment_ids' && (item.code === 'too_long' || item.code === 'too_many_attachments'),
    )
  ) {
    return 'count';
  }
  return 'failed';
}

const STORED = z.object({
  data: z.object({
    id: z.string(),
    name: z.string(),
    size: z.number(),
    content_type: z.string(),
    is_image: z.boolean(),
    url: z.string(),
  }),
});

export interface NoteFileUploadOptions {
  onProgress?: ((progress: UploadProgress) => void) | undefined;
  signal?: AbortSignal | undefined;
}

export interface NoteFileUpload {
  /**
   * Sends one file in its own request, before the note exists, and resolves with the stored file (attach it to a note
   * by its id). Rejects with a `NoteFileRefusal`, or with an `AbortError` when `options.signal` stopped it. A file that
   * is uploaded and never attached stays stored, counted against the quota: orphans are bounded by it, and no purge is
   * built (decision D27).
   */
  upload: (file: File, options?: NoteFileUploadOptions) => Promise<PageNoteFile>;
  /** An upload is running. */
  pending: boolean;
}

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

/** Uploads the files of the note box for one page. Throws `UrlIdError` for a bad id. */
export function useNoteFileUpload(scope: LinksScope, urlId: string): NoteFileUpload {
  const path = noteFilesPath(scope, urlId);
  const [running, setRunning] = useState(0);

  const upload = async (file: File, options: NoteFileUploadOptions = {}): Promise<PageNoteFile> => {
    // No content type is set: the browser writes the multipart boundary itself
    const form = new FormData();
    form.append('file', file);
    setRunning((count) => count + 1);
    try {
      const stored = STORED.safeParse(await uploadForm(path, form, options));
      if (!stored.success) throw new NoteFileRefusal('failed');
      return stored.data.data;
    } catch (error) {
      if (isNoteFileRefusal(error) || isAbort(error)) throw error;
      throw new NoteFileRefusal(refusalKindOf(error));
    } finally {
      setRunning((count) => count - 1);
    }
  };

  return { upload, pending: running > 0 };
}
