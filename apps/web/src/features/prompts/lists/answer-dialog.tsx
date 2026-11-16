'use client';

import { useTranslations } from 'next-intl';
import type { MouseEvent, ReactElement } from 'react';

import { EngineLogo } from '@/components/app/engine/engine-logo';
import { Dialog, DialogBody, DialogHeader } from '@/components/ui/dialog';
import { formatTableDateTime } from '@/lib/format';

const stop = (event: MouseEvent): void => event.stopPropagation();

/** The address of a stored screenshot when it is one an image may load: a web address or an inline image, never a script. */
export function imageSource(raw: string): string | null {
  if (/^data:image\/(png|jpe?g|webp|gif|svg\+xml)[;,]/i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? raw : null;
  } catch {
    return null;
  }
}

export interface AnswerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The platform's code and name. */
  platform: { code: string; name: string };
  promptText: string;
  /** When the answer was collected, as the API sends it. */
  observedAt: string;
  /** The stored image of the answer page. */
  screenshotUrl: string;
  timeZone: string;
}

/**
 * The latest answer of one platform for one prompt, as the page showed it: a modal with the platform, the prompt and the
 * image the app stored when it collected the answer. Escape, the close button and a click on the scrim close it, focus
 * stays inside while it is open and returns to the cell button.
 */
export function AnswerDialog({
  open,
  onOpenChange,
  platform,
  promptText,
  observedAt,
  screenshotUrl,
  timeZone,
}: AnswerDialogProps): ReactElement {
  const t = useTranslations('prompts.lists.shot');
  const source = imageSource(screenshotUrl);
  return (
    // The dialog renders in a portal, but a React click still bubbles to the row that holds the cell
    <Dialog open={open} onOpenChange={onOpenChange} size="md" className="sm:w-160" onClick={stop}>
      <DialogHeader
        title={t('title')}
        description={t('subtitle', { platform: platform.name, when: formatTableDateTime(observedAt, timeZone) })}
        closeLabel={t('close')}
      />
      <DialogBody>
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center gap-2 type-body-strong text-foreground">
            <EngineLogo engine={platform.code} name={platform.name} />
          </div>
          <p className="type-body-strong text-foreground">{promptText}</p>
          {source === null ? null : (
            // A signed address of a stored image, which next/image would have to be told to allow and would proxy
            // eslint-disable-next-line @next/next/no-img-element -- the image comes from the API's storage, whose host the app does not know
            <img
              src={source}
              alt={t('imageAlt', { platform: platform.name })}
              className="w-full rounded-md border border-border-subtle"
            />
          )}
        </div>
      </DialogBody>
    </Dialog>
  );
}
