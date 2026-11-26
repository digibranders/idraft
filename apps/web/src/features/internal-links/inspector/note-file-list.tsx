'use client';

import { FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Icon } from '@/components/ui/icon';
import { formatBytes } from '@/lib/format';
import type { PageNoteFile } from '@/lib/internal-links/types';

/** A file is loaded and linked only from this app's own origin: the API answers with a path, never with another host. */
export function isOwnUrl(url: string): boolean {
  try {
    return new URL(url, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

function FileEntry({ file }: { file: PageNoteFile }): ReactElement {
  const t = useTranslations('pages.drawer.notes.files');
  const size = formatBytes(file.size);
  const own = isOwnUrl(file.url);
  const body =
    file.is_image && own ? (
      // A fixed square box: the page does not jump when the picture arrives, and nothing is wider than its box
      <span className="block size-12 overflow-hidden rounded-md border border-border-subtle bg-surface-subtle">
        {/* The file name is the alt text, set as an attribute: never markup */}
        {/* eslint-disable-next-line @next/next/no-img-element -- a stored user file from our own API, not a static asset */}
        <img src={file.url} alt={t('thumb', { name: file.name })} loading="lazy" className="size-full object-cover" />
      </span>
    ) : (
      <span className="flex max-w-full min-w-0 items-center gap-2 rounded-md border border-border-subtle px-2 py-1">
        <Icon icon={FileText} className="shrink-0 text-foreground-tertiary" />
        <span className="min-w-0 truncate type-body text-foreground">{file.name}</span>
        <span className="shrink-0 num type-meta text-foreground-tertiary">{size}</span>
      </span>
    );
  if (!own) return body;
  return (
    <a
      href={file.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('open', { name: file.name, size })}
      className="flex max-w-full min-w-0 rounded-md hover:bg-surface-hover focus-visible:focus-ring"
    >
      {body}
    </a>
  );
}

/** The files of a saved note: a thumbnail for each image, a row with the name and size for the others. */
export function NoteFileList({ files }: { files: readonly PageNoteFile[] }): ReactElement | null {
  const t = useTranslations('pages.drawer.notes.files');
  if (files.length === 0) return null;
  return (
    <ul aria-label={t('list')} className="flex min-w-0 flex-wrap gap-2 pl-10">
      {files.map((file) => (
        <li key={file.id} className="flex max-w-full min-w-0">
          <FileEntry file={file} />
        </li>
      ))}
    </ul>
  );
}
