'use client';

import { FileText, Upload, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { GroupError } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';

export interface FileDropzoneProps {
  /** The `accept` of the file input: ".csv,text/csv". */
  accept: string;
  /** The rules of the file in one line: "CSV, UTF-8, up to 50 MB." */
  constraints: string;
  /** The chosen file, its size already formatted. */
  file: { name: string; sizeText: string } | null;
  onFile: (file: File) => void;
  onRemove: () => void;
  error: string | null;
  /** 0 to 100 while uploading; `null` otherwise. */
  progress: number | null;
  /** The bar's value for assistive technology: "42% uploaded". */
  progressText: string | null;
  disabled: boolean;
}

/**
 * Where a file is dropped or chosen (10-forms.md section 15.1): a dashed box with the instruction and a real
 * "Choose file" button, which is the keyboard's way in. A chosen file replaces the box with one row that holds
 * its name and size and a way to remove it; while it uploads, a bar shows how far it has gone. The file input
 * itself is hidden: the button opens it.
 */
export function FileDropzone({
  accept,
  constraints,
  file,
  onFile,
  onRemove,
  error,
  progress,
  progressText,
  disabled,
}: FileDropzoneProps): ReactElement {
  const t = useTranslations('rankings.import');
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const errorId = useId();
  const constraintsId = useId();
  const showsBox = file === null;

  const take = (files: FileList | null): void => {
    const first = files?.item(0);
    if (first !== null && first !== undefined) onFile(first);
  };
  // What the listeners below use, as it is at the time of the drop
  const latest = useRef({ disabled, take });
  useEffect(() => {
    latest.current = { disabled, take };
  });

  // Dropping is an enhancement of the button, and the box is not an interactive element, so its drag events
  // are listened to here and not as props of a `div`
  useEffect(() => {
    const element = box.current;
    if (element === null) return undefined;
    const over = (event: Event): void => {
      if (latest.current.disabled) return;
      event.preventDefault();
      setDragging(true);
    };
    const leave = (event: DragEvent): void => {
      // Moving over the box's own children fires a leave and an enter: only leaving the box counts
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !element.contains(next)) setDragging(false);
    };
    const drop = (event: DragEvent): void => {
      event.preventDefault();
      setDragging(false);
      if (!latest.current.disabled) latest.current.take(event.dataTransfer?.files ?? null);
    };
    element.addEventListener('dragenter', over);
    element.addEventListener('dragover', over);
    element.addEventListener('dragleave', leave);
    element.addEventListener('drop', drop);
    return () => {
      element.removeEventListener('dragenter', over);
      element.removeEventListener('dragover', over);
      element.removeEventListener('dragleave', leave);
      element.removeEventListener('drop', drop);
    };
  }, [showsBox]);

  return (
    <div className="flex flex-col gap-1.5">
      {showsBox ? (
        <div
          ref={box}
          data-slot="file-dropzone"
          // Not in the tab order: "Choose file" is. It takes focus only when a failed Continue points at the error.
          tabIndex={-1}
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? constraintsId : `${errorId} ${constraintsId}`}
          className={cn(
            'flex h-24 items-center justify-center gap-2 rounded-md border border-dashed px-4 transition-colors duration-(--duration-fast) ease-standard outline-none focus-visible:focus-ring',
            dragging
              ? 'border-primary-border bg-primary-subtle'
              : cn('bg-surface-subtle', error === null ? 'border-border-strong' : 'border-negative-solid'),
          )}
        >
          <Icon icon={Upload} className="shrink-0 text-foreground-tertiary" />
          <p className="type-body text-foreground-secondary">{dragging ? t('dropzoneActive') : t('dropzone')}</p>
          <Button variant="secondary" size="sm" disabled={disabled} onClick={() => input.current?.click()}>
            {t('chooseFile')}
          </Button>
        </div>
      ) : (
        <div className="flex min-h-12 items-center gap-2 rounded-md border border-border bg-surface px-3">
          <Icon icon={FileText} className="shrink-0 text-foreground-tertiary" />
          <p className="min-w-0 flex-1 truncate type-body">{t('fileRow', { name: file.name, size: file.sizeText })}</p>
          <IconButton icon={X} size="icon-xs" label={t('removeFile')} disabled={disabled} onClick={onRemove} />
        </div>
      )}
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          take(event.target.files);
          // The same file chosen again after a removal still fires a change
          event.target.value = '';
        }}
      />
      {progress === null || file === null ? null : (
        <div
          role="progressbar"
          aria-label={t('uploading', { name: file.name })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-valuetext={progressText ?? undefined}
          className="flex h-1 overflow-hidden rounded-sm bg-surface-subtle"
        >
          <span className="h-full bg-primary" style={{ width: `${String(progress)}%` }} />
        </div>
      )}
      <p id={constraintsId} className="type-meta">
        {constraints}
      </p>
      {error === null ? null : <GroupError id={errorId} message={error} />}
    </div>
  );
}
