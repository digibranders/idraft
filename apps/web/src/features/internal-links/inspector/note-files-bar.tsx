'use client';

import { FileText, Paperclip, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type DragEvent,
  type ReactElement,
  type RefObject,
} from 'react';

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
  /** A stored file cannot be taken out while files go up: the upload would write the old list back. */
  removeDisabled?: boolean | undefined;
  /** The share sent, while the file is on its way. */
  progress?: number | undefined;
}

function Chip({ name, size, thumb, onRemove, removeDisabled, progress }: ChipProps): ReactElement {
  const t = useTranslations('pages.drawer.notes.files');
  // A picture that does not load falls back to the file icon
  const [broken, setBroken] = useState(false);
  return (
    <li className="flex max-w-full min-w-0 flex-col gap-1 rounded-md border border-border bg-surface-subtle py-1 pr-1 pl-2">
      <div className="flex min-w-0 items-center gap-2">
        {thumb === null || broken ? (
          <Icon icon={FileText} size="sm" className="shrink-0 text-foreground-tertiary" />
        ) : (
          // The name is beside it, so the picture adds nothing for assistive technology
          // eslint-disable-next-line @next/next/no-img-element -- a local preview of the file being attached
          <img src={thumb} alt="" onError={() => setBroken(true)} className="size-8 shrink-0 rounded-sm object-cover" />
        )}
        <span className="min-w-0 truncate type-body text-foreground">{name}</span>
        <span className="shrink-0 num type-micro text-foreground-tertiary">{formatBytes(size)}</span>
        <IconButton
          icon={X}
          size="icon-xs"
          label={t('remove', { name })}
          disabled={removeDisabled === true}
          data-chip-remove=""
          onClick={onRemove}
        />
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

function PendingChip({ file, box, onRemove }: { file: File; box: NoteFileBox; onRemove: () => void }): ReactElement {
  const thumb = useObjectUrl(file, file.type.startsWith('image/'));
  return (
    <Chip
      name={file.name}
      size={file.size}
      thumb={thumb}
      onRemove={onRemove}
      progress={box.uploading ? (box.progress.get(file) ?? 0) : undefined}
    />
  );
}

export interface NoteFilesBarProps {
  box: NoteFileBox;
  /** Called after a stored file was taken out of the box, with how many files are left. */
  onKeptRemoved?: ((left: number) => void) | undefined;
  /** Takes the focus when a chip was removed and no chip is after it (the paperclip, else the text area). */
  focusFallback: () => void;
}

/** The files held by the box, above its buttons, and the one line that says what was refused. */
export function NoteFilesBar({ box, onKeptRemoved, focusFallback }: NoteFilesBarProps): ReactElement {
  const t = useTranslations('pages.drawer.notes.files');
  const held = box.kept.length + box.pending.length;
  const list = useRef<HTMLUListElement | null>(null);
  // The place in the list of the chip that was removed: its Remove button is gone, so the focus moves on
  const focusAt = useRef<number | null>(null);
  useEffect(() => {
    const at = focusAt.current;
    if (at === null) return;
    focusAt.current = null;
    const next = list.current?.querySelectorAll<HTMLButtonElement>('button[data-chip-remove]')[at];
    if (next === undefined) focusFallback();
    else next.focus();
  }, [held, focusFallback]);
  return (
    <>
      {held === 0 ? null : (
        <ul ref={list} aria-label={t('list')} className="flex min-w-0 flex-wrap gap-2">
          {box.kept.map((file, index) => (
            <Chip
              key={file.id}
              name={file.name}
              size={file.size}
              thumb={file.is_image && isOwnUrl(file.url) ? file.url : null}
              removeDisabled={box.uploading}
              onRemove={() => {
                focusAt.current = index;
                box.removeKept(file.id);
                onKeptRemoved?.(held - 1);
              }}
            />
          ))}
          {box.pending.map((file, index) => (
            // The pre-check refuses a second file with the same name, size and date, so these three are unique
            <PendingChip
              key={`${file.name}:${String(file.size)}:${String(file.lastModified)}`}
              file={file}
              box={box}
              onRemove={() => {
                focusAt.current = box.kept.length + index;
                box.removePending(file);
              }}
            />
          ))}
        </ul>
      )}
      {/* Always in the page, so a screen reader that watches the region hears the text arrive; polite, as a refusal
          is not an emergency and the person is still typing */}
      <p role="status" className={box.notice === null ? 'sr-only' : 'type-meta text-negative-text'}>
        {box.notice}
      </p>
    </>
  );
}

/** The paperclip, and the file chooser it opens (the keyboard way to attach, as drop and paste are for the pointer). */
export function AttachButton({
  box,
  buttonRef,
}: {
  box: NoteFileBox;
  /** The caller's handle on the paperclip, so it can take the focus. */
  buttonRef: RefObject<HTMLButtonElement | null>;
}): ReactElement {
  const t = useTranslations('pages.drawer.notes.files');
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <IconButton
        ref={buttonRef}
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
  // The box hears nothing when the drag ends, is dropped elsewhere or leaves the window, so the window is asked
  useEffect(() => {
    if (!over) return undefined;
    const clear = (): void => {
      depth.current = 0;
      setOver(false);
    };
    // Some browsers give a null `relatedTarget` on every leave, so the pointer must be outside the window itself
    const leftWindow = (event: globalThis.DragEvent): void => {
      const { clientX: x, clientY: y } = event;
      if (x <= 0 || y <= 0 || x >= window.innerWidth || y >= window.innerHeight) clear();
    };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    window.addEventListener('dragleave', leftWindow);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
      window.removeEventListener('dragleave', leftWindow);
    };
  }, [over]);
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
