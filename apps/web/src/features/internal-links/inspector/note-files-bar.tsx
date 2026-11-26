'use client';

import { FileText, Paperclip, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ComponentProps, type DragEvent, type ReactElement } from 'react';

import { isOwnUrl } from './note-file-list';
import type { NoteFileBox } from './use-note-file-box';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { formatBytes } from '@/lib/format';

/** The seven types the box takes (spec 9.8.4); the server decides by content, this only narrows the chooser. */
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv';

/** The preview of a file the browser holds: an object URL that is revoked when the chip goes. */
function useObjectUrl(file: File, wanted: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted) return undefined;
    const made = URL.createObjectURL(file);
    // The URL is a resource made in the effect and freed by its cleanup: it cannot be made during render
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(made);
    return () => {
      URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [file, wanted]);
  return url;
}

interface ChipProps {
  name: string;
  size: number;
  /** The thumbnail source, `null` for a file that is not an image. */
  thumb: string | null;
  onRemove: () => void;
  /** The share sent, while the file is on its way. */
  progress?: number | undefined;
}

function Chip({ name, size, thumb, onRemove, progress }: ChipProps): ReactElement {
  const t = useTranslations('pages.drawer.notes.files');
  return (
    <li className="flex max-w-full min-w-0 flex-col gap-1 rounded-md border border-border bg-surface-subtle py-1 pr-1 pl-2">
      <div className="flex min-w-0 items-center gap-2">
        {thumb === null ? (
          <Icon icon={FileText} size="sm" className="shrink-0 text-foreground-tertiary" />
        ) : (
          // The name is beside it, so the picture adds nothing for assistive technology
          // eslint-disable-next-line @next/next/no-img-element -- a local preview of the file being attached
          <img src={thumb} alt="" className="size-8 shrink-0 rounded-sm object-cover" />
        )}
        <span className="min-w-0 truncate type-body text-foreground">{name}</span>
        <span className="shrink-0 num type-micro text-foreground-tertiary">{formatBytes(size)}</span>
        <IconButton icon={X} size="icon-xs" label={t('remove', { name })} onClick={onRemove} />
      </div>
      {progress === undefined ? null : (
        <div
          role="progressbar"
          aria-label={t('progress', { name })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="h-0.5 w-full overflow-hidden rounded-full bg-border-subtle"
        >
          <div className="h-full bg-primary" style={{ width: `${String(Math.round(progress * 100))}%` }} />
        </div>
      )}
    </li>
  );
}

function PendingChip({ file, box }: { file: File; box: NoteFileBox }): ReactElement {
  const thumb = useObjectUrl(file, file.type.startsWith('image/'));
  return (
    <Chip
      name={file.name}
      size={file.size}
      thumb={thumb}
      onRemove={() => box.removePending(file)}
      progress={box.uploading ? (box.progress.get(file) ?? 0) : undefined}
    />
  );
}

export interface NoteFilesBarProps {
  box: NoteFileBox;
  /** Called after a stored file was taken out of the box, with how many files are left. */
  onKeptRemoved?: ((left: number) => void) | undefined;
}

/** The files held by the box, above its buttons, and the one line that says what was refused. */
export function NoteFilesBar({ box, onKeptRemoved }: NoteFilesBarProps): ReactElement {
  const t = useTranslations('pages.drawer.notes.files');
  const held = box.kept.length + box.pending.length;
  return (
    <>
      {held === 0 ? null : (
        <ul aria-label={t('list')} className="flex min-w-0 flex-wrap gap-2">
          {box.kept.map((file) => (
            <Chip
              key={file.id}
              name={file.name}
              size={file.size}
              thumb={file.is_image && isOwnUrl(file.url) ? file.url : null}
              onRemove={() => {
                box.removeKept(file.id);
                onKeptRemoved?.(held - 1);
              }}
            />
          ))}
          {box.pending.map((file) => (
            // The pre-check refuses a second file with the same name, size and date, so these three are unique
            <PendingChip key={`${file.name}:${String(file.size)}:${String(file.lastModified)}`} file={file} box={box} />
          ))}
        </ul>
      )}
      {/* Always in the page, so a screen reader that watches the region hears the text arrive */}
      <p role="alert" className={box.notice === null ? 'sr-only' : 'type-meta text-negative-text'}>
        {box.notice}
      </p>
    </>
  );
}

/** The paperclip, and the file chooser it opens (the keyboard way to attach, as drop and paste are for the pointer). */
export function AttachButton({ box }: { box: NoteFileBox }): ReactElement {
  const t = useTranslations('pages.drawer.notes.files');
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <IconButton
        icon={Paperclip}
        label={t('attach')}
        disabled={box.uploading}
        onClick={() => input.current?.click()}
      />
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        tabIndex={-1}
        aria-label={t('attach')}
        className="hidden"
        onChange={(event) => {
          box.add([...(event.currentTarget.files ?? [])]);
          // The same file can be chosen again after it was removed
          event.currentTarget.value = '';
        }}
      />
    </>
  );
}

const carriesFiles = (event: DragEvent): boolean => event.dataTransfer.types.includes('Files');

export interface NoteDropZone {
  /** Spread on the element that holds the box (it must be `relative`). */
  zoneProps: Pick<DragProps, 'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'>;
  /** The affordance drawn over the box while files are dragged across it, else `null`. */
  overlay: ReactElement | null;
}

type DragProps = ComponentProps<'div'>;

/** Files dropped anywhere on the box are attached; a drop of text is left to the text area. */
export function useNoteDropZone(box: NoteFileBox): NoteDropZone {
  const t = useTranslations('pages.drawer.notes.files');
  // Enter and leave fire for every child the pointer crosses, so they are counted
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  return {
    zoneProps: {
      onDragEnter: (event) => {
        if (!carriesFiles(event)) return;
        depth.current += 1;
        setOver(true);
      },
      onDragOver: (event) => {
        if (carriesFiles(event)) event.preventDefault();
      },
      onDragLeave: (event) => {
        if (!carriesFiles(event)) return;
        depth.current = Math.max(depth.current - 1, 0);
        if (depth.current === 0) setOver(false);
      },
      onDrop: (event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        box.add([...event.dataTransfer.files]);
      },
    },
    overlay: over ? (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md border border-dashed border-primary bg-surface-subtle type-body text-foreground">
        {t('drop')}
      </div>
    ) : null,
  };
}
