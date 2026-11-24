'use client';

import { useTranslations } from 'next-intl';
import { useId, type MouseEvent, type ReactElement } from 'react';

import { EngineLogo } from '@/components/app/engine/engine-logo';
import { CitationList, type CitationListItem } from '@/components/app/evidence/citation-list';
import { Dialog, DialogBody, DialogHeader } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { formatTableDateTime } from '@/lib/format';

const stop = (event: MouseEvent): void => event.stopPropagation();
const noop = (): void => undefined;

/**
 * The address of a stored screenshot when it is one an image may load: a web address, an inline image, or the API's own
 * path of a stored screenshot (same origin, so the session cookie goes with it). Never a script or another scheme.
 */
export function imageSource(raw: string): string | null {
  if (/^data:image\/(png|jpe?g|webp|gif|svg\+xml)[;,]/i.test(raw)) return raw;
  if (/^\/api\/v1\/[A-Za-z0-9\-_/]+\/screenshot$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? raw : null;
  } catch {
    return null;
  }
}

/** The pages the answer cites, which the image does not show in full: loading, failed to load, or the list. */
export type AnswerCitations =
  { status: 'loading' } | { status: 'failed' } | { status: 'ready'; items: readonly CitationListItem[] };

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
  /** The answer is longer than the capture: its end is missing from the image. */
  truncated?: boolean;
  /** The answer's cited pages, listed under the image; left out when the caller has none to give. */
  citations?: AnswerCitations;
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
  truncated = false,
  citations,
  timeZone,
}: AnswerDialogProps): ReactElement {
  const t = useTranslations('prompts.lists.shot');
  const source = imageSource(screenshotUrl);
  const citationPrefix = useId();
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
            // The page is tall: the image scrolls in its own box, so the cited pages below it stay in reach
            <div
              role="region"
              tabIndex={0}
              aria-label={t('imageBoxLabel', { platform: platform.name })}
              className="max-h-160 overflow-y-auto rounded-md border border-border-subtle focus-visible:focus-ring"
            >
              {/* The address is the API's own path of a stored image, which next/image would have to be told to allow and would proxy */}
              {/* eslint-disable-next-line @next/next/no-img-element -- the image comes from the API, whose host the app does not know */}
              <img src={source} alt={t('imageAlt', { platform: platform.name })} className="w-full" />
            </div>
          )}
          {truncated ? <p className="type-meta">{t('truncated')}</p> : null}
        </div>
        {citations === undefined ? null : (
          <section className="mt-4 flex flex-col gap-2">
            <h3 className="type-subsection-title text-foreground">{t('citations')}</h3>
            {citations.status === 'loading' ? (
              <div aria-busy="true" className="flex flex-col gap-2">
                <Skeleton shape="text-14" widthPct={80} />
                <Skeleton shape="text-14" widthPct={64} />
              </div>
            ) : citations.status === 'failed' ? (
              <p role="alert" className="type-body text-foreground-secondary">
                {t('citationsFailed')}
              </p>
            ) : citations.items.length === 0 ? (
              <p className="type-body text-foreground-secondary">{t('noCitations')}</p>
            ) : (
              <CitationList items={citations.items} idPrefix={citationPrefix} onShowInAnswer={noop} />
            )}
          </section>
        )}
      </DialogBody>
    </Dialog>
  );
}
