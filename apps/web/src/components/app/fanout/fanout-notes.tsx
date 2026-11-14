'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Banner } from '@/components/app/status/banner';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { formatList } from '@/lib/format';
import type { NewUnknownReason } from '@/lib/fanout';

/**
 * The notes above a list of fan-out queries. Each states one fact about what is listed and says nothing when there
 * is nothing to say; none shows a figure it cannot back with a count.
 */

/** The engines in scope that do not show their queries: not exposed, which is not the same as none issued. */
export function EngineNote({ engines }: { engines: readonly string[] }): ReactElement | null {
  const t = useTranslations('fanout');
  if (engines.length === 0) return null;
  return (
    <div className="flex items-center gap-1">
      <p className="type-meta">{t('engineNote', { engines: formatList(engines), count: engines.length })}</p>
      {/* The tip is the button's name, so it is read and reached by keyboard like the rest of the note */}
      <IconButton icon={Info} size="icon-xs" label={t('engineNoteTip')} />
    </div>
  );
}

/** Some answers kept fewer queries than they issued (the stored list is bounded), so counts may be low. */
export function TruncatedNote({
  cut,
  answers,
  engine,
}: {
  /** The answers cut, of `answers`, the answers read. */
  cut: number;
  answers: number;
  engine: string;
}): ReactElement {
  const t = useTranslations('fanout');
  return <Banner tone="warning" placement="region" message={t('truncatedAnswers', { cut, answers, engine })} />;
}

/** The rows listed are the most used of more: the minimum or the scope narrows the rest. */
export function ListCutNote({ shown, total }: { shown: number; total: number }): ReactElement {
  const t = useTranslations('fanout');
  return <Banner tone="info" placement="region" message={t('truncatedList', { shown, total })} />;
}

export interface NewUnknownNoteProps {
  reason: NewUnknownReason;
  /** The queries of the period before that can be compared, for `tooMany`. */
  limit: number;
  onRetry: () => void;
  retrying: boolean;
}

/** Why no query is marked new: said once, in place of badges that would be guesses. Retry only when a read failed. */
export function NewUnknownNote({ reason, limit, onRetry, retrying }: NewUnknownNoteProps): ReactElement | null {
  const t = useTranslations('fanout.newUnknown');
  const common = useTranslations('common');
  // The period before is still being read: the badges follow, so there is nothing to explain yet
  if (reason === 'loading') return null;
  return (
    <Banner
      tone="info"
      placement="region"
      message={t(reason, { limit })}
      actions={
        reason === 'failed' ? (
          <Button variant="secondary" size="sm" loading={retrying} onClick={onRetry}>
            {common('retry')}
          </Button>
        ) : undefined
      }
    />
  );
}

/**
 * The newest query is old: the list may be, too. It says nothing of the answers. `date` is the day of the newest
 * query, already formatted by the caller (`formatTableDate`).
 */
export function StaleNote({ date }: { date: string }): ReactElement {
  const t = useTranslations('fanout');
  return <p className="type-meta">{t('stale', { date })}</p>;
}
