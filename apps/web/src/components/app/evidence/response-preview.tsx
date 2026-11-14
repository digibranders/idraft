'use client';

import { useTranslations } from 'next-intl';
import { Fragment, type ReactElement, type ReactNode } from 'react';

import { hasHash, HashCopy } from './facts-footer';
import { Tooltip } from '@/components/ui/tooltip';

/** A time with its exact reading in a tooltip is a tab stop, so the keyboard reaches the tooltip (20 section 6.2 rule 6). */
const TAB_STOP = { tabIndex: 0 } as const;

export interface ResponsePreviewProps {
  /** The model the engine named, when it did. */
  model: string | null;
  /** An ISO instant, for the `time` element. */
  observedAt: string;
  /** The exact time, in the reader's zone: the tooltip and the accessible name of the time. */
  exact: string;
  /** The time as a reader says it, "2 days ago". */
  relative: string;
  /** The text of the answer, ready to show (marked, clipped): the card does not know how to draw it. */
  children: ReactNode;
  /** Short notes under the text, for example that the answer was cut off. */
  notes?: ReactNode;
  /** The mention summary: what the answer names and cites, as the screen words it. */
  facts?: ReactNode;
  /** The sources the answer cites. */
  sources?: ReactNode;
  /** SHA-256 of the answer text; no line when `null` or missing. */
  answerSha256?: string | null | undefined;
  /** SHA-256 of the provider's raw reply; no line when `null` or missing. */
  rawSha256?: string | null | undefined;
  /** The one action of the card, such as the button that opens the whole answer. */
  action?: ReactNode;
}

/**
 * The compact summary of one answer for the inspector's Latest tab (inventory 15.10, 23-application-patterns.md
 * section 5.1): the model and when it answered, the text, what it names and cites, the hashes that identify it, and its
 * action. It takes ready-made parts, so the screen keeps what it knows (marks, colors, wording) and this keeps the
 * order and the spacing.
 */
export function ResponsePreview({
  model,
  observedAt,
  exact,
  relative,
  children,
  notes,
  facts,
  sources,
  answerSha256,
  rawSha256,
  action,
}: ResponsePreviewProps): ReactElement {
  const separator = useTranslations('inspector')('separator');
  const hash = useTranslations('evidence.hash');
  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-x-1.5 type-meta">
        {model === null ? null : (
          <Fragment>
            <span>{model}</span>
            <span aria-hidden="true">{separator}</span>
          </Fragment>
        )}
        <Tooltip content={exact} purpose="label">
          <time
            {...TAB_STOP}
            dateTime={observedAt}
            aria-label={exact}
            className="rounded-xs num outline-none focus-visible:focus-ring"
          >
            {relative}
          </time>
        </Tooltip>
      </p>
      {children}
      {notes}
      {facts}
      {sources}
      {hasHash(answerSha256) ? (
        <p className="type-meta">
          <span>{hash('answer')}</span> <HashCopy kind="answer" hash={answerSha256} />
        </p>
      ) : null}
      {hasHash(rawSha256) ? (
        <p className="type-meta">
          <span>{hash('raw')}</span> <HashCopy kind="raw" hash={rawSha256} />
        </p>
      ) : null}
      {action}
    </div>
  );
}
