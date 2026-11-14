'use client';

import type { LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Delta, hasDeltaComparison } from '@/components/app/metric/delta';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { TextLink } from '@/components/ui/text-link';
import { Truncate } from '@/components/ui/truncate';
import {
  formatDetailDateTime,
  formatMetricDelta,
  formatRankChange,
  formatRelative,
  formatTime,
  type ChangeTone,
  type MetricDeltaInput,
  type RankChange,
} from '@/lib/format';
import { cn } from '@/lib/utils';

export type FeedChange = { kind: 'metric'; input: MetricDeltaInput } | { kind: 'rank'; change: RankChange };

export interface FeedItem {
  id: string;
  /** 16 px Lucide glyph (18 section 7). */
  glyph: LucideIcon;
  /** The finished sentence; the component words nothing. Untrusted parts in it render as text. */
  text: string;
  /** The instant, ISO 8601. */
  at: string;
  /**
   * The evidence: a filtered table or the record's inspector. Without one the row is plain text: no link, no hover
   * fill, no focus stop (a summary row that has no single record behind it).
   */
  href?: Route | undefined;
  /**
   * Replaces the time text for a row that describes a whole window ("28 days"), so it is not dated "just now".
   * The `time` element still carries `at` as its `datetime` and the exact time as its title.
   */
  atLabel?: string | undefined;
  /**
   * One value that changed: `Delta` for a metric, the `formatRankChange` text for a rank. Its tone, which is
   * positive or negative only for a detectable change, also colours the glyph; otherwise the glyph is tertiary.
   */
  change?: FeedChange | undefined;
  /** `full` only: the neutral `Badge` "Rank move". */
  typeLabel?: string | undefined;
  /** `full` only: the collection that produced the event, "SERP check". */
  sourceLabel?: string | undefined;
}

export interface FeedRowProps {
  item: FeedItem;
  /**
   * `compact`: the Overview row of the preview, all one link: glyph, sentence, change, relative time.
   * `full` (23 section 9.3): time, glyph, sentence, change, type badge, source and a "View" link named "View: <sentence>".
   */
  form: 'compact' | 'full';
  timeZone: string;
  now?: Date | undefined;
}

/** The glyph takes the change's colour only when the change is detectable; every other glyph is tertiary. */
const GLYPH_TONE = {
  positive: cn('text-positive-text'),
  negative: cn('text-negative-text'),
  neutral: cn('text-foreground-tertiary'),
} as const satisfies Record<ChangeTone, string>;
const RANK_TONE = {
  positive: cn('text-positive-text'),
  negative: cn('text-negative-text'),
  neutral: cn('text-foreground-secondary'),
} as const satisfies Record<ChangeTone, string>;

const ROW = cn('flex min-h-9 items-center gap-3 px-4 py-2');

function changeTone(change: FeedChange | undefined): ChangeTone {
  if (change === undefined) return 'neutral';
  return change.kind === 'metric' ? formatMetricDelta(change.input).tone : formatRankChange(change.change).tone;
}

/** A change with nothing to compare, or a rank change with no text, has no slot: it is never drawn as 0. */
function hasVisibleChange(change: FeedChange | undefined): change is FeedChange {
  if (change === undefined) return false;
  return change.kind === 'metric' ? hasDeltaComparison(change.input) : formatRankChange(change.change).text !== '';
}

/** The words first (read), then the drawn text (hidden from assistive technology), as `Delta` does. */
function ChangeText({ change }: { change: FeedChange }): ReactElement {
  if (change.kind === 'metric') return <Delta input={change.input} size="sm" tip={false} />;
  const display = formatRankChange(change.change);
  return (
    <span className="num type-meta">
      <span aria-hidden="true" className={RANK_TONE[display.tone]}>
        {display.text}
      </span>
      <span className="sr-only">{display.label}</span>
    </span>
  );
}

function ChangeSlot({ change }: { change: FeedChange | undefined }): ReactElement | null {
  if (!hasVisibleChange(change)) return null;
  return (
    <span data-slot="feed-change" className="shrink-0">
      <ChangeText change={change} />
    </span>
  );
}

function Glyph({ item }: { item: FeedItem }): ReactElement {
  return <Icon icon={item.glyph} className={GLYPH_TONE[changeTone(item.change)]} />;
}

/** `clamp` (the compact row) wraps to two lines so a long sentence keeps its figures; the full row stays one line. */
function Sentence({ text, clamp = false }: { text: string; clamp?: boolean }): ReactElement {
  if (!clamp) return <Truncate text={text} className="flex-1 type-body text-foreground" />;
  return (
    <span
      data-slot="feed-sentence"
      data-truncate=""
      title={text}
      className="line-clamp-2 min-w-0 flex-1 type-body break-words text-foreground"
    >
      {text}
    </span>
  );
}

/** The compact row's content, whether or not it is a link. */
function CompactBody({ item, timeZone, clock }: { item: FeedItem; timeZone: string; clock: Date }): ReactElement {
  return (
    <>
      <Glyph item={item} />
      <Sentence text={item.text} clamp />
      <ChangeSlot change={item.change} />
      <time
        dateTime={item.at}
        title={formatDetailDateTime(item.at, timeZone)}
        // 128 px: the longest text is a different year, "Dec 29, 2025, 18:32" (about 118 px)
        className="w-32 shrink-0 text-right num type-meta whitespace-nowrap"
      >
        {item.atLabel ?? formatRelative(item.at, timeZone, clock)}
      </time>
    </>
  );
}

/**
 * One event of a feed (23-application-patterns.md section 9.3), an `<li>` for a list the caller draws. The time
 * slot has a fixed width so the rows line up whatever the sentence and the change are.
 */
export function FeedRow({ item, form, timeZone, now }: FeedRowProps): ReactElement {
  const t = useTranslations('common.changeFeed');
  const clock = now ?? new Date();
  if (form === 'compact') {
    return (
      <li className="border-t border-border-subtle">
        {item.href === undefined ? (
          <div className={ROW}>
            <CompactBody item={item} timeZone={timeZone} clock={clock} />
          </div>
        ) : (
          <Link
            href={item.href}
            className={cn(ROW, 'rounded-xs outline-none hover:bg-surface-hover focus-visible:focus-ring-inset')}
          >
            <CompactBody item={item} timeZone={timeZone} clock={clock} />
          </Link>
        )}
      </li>
    );
  }
  return (
    <li
      className={cn(
        '@container border-t border-border-subtle',
        item.href !== undefined && 'hover:bg-surface-hover',
        ROW,
      )}
    >
      <time
        dateTime={item.at}
        title={item.atLabel === undefined ? undefined : formatDetailDateTime(item.at, timeZone)}
        className="w-12 shrink-0 num type-meta"
      >
        {item.atLabel ?? formatTime(item.at, timeZone)}
      </time>
      <Glyph item={item} />
      <Sentence text={item.text} />
      <ChangeSlot change={item.change} />
      {/* The badge and source slots are always drawn, so the columns do not depend on the row */}
      {item.typeLabel === undefined ? null : <span className="sr-only @md:hidden">{item.typeLabel}</span>}
      <span
        data-slot="feed-type"
        aria-hidden={item.typeLabel === undefined ? true : undefined}
        className="hidden w-32 shrink-0 @md:block"
      >
        {item.typeLabel === undefined ? null : <Badge>{item.typeLabel}</Badge>}
      </span>
      <span
        data-slot="feed-source"
        aria-hidden={item.sourceLabel === undefined ? true : undefined}
        className="hidden w-24 shrink-0 @lg:block"
      >
        {item.sourceLabel === undefined ? null : <Truncate text={item.sourceLabel} className="type-meta" />}
      </span>
      {item.href === undefined ? (
        // Draws the word invisibly so the badge and source columns stay where they are on the rows that have a link
        <span data-slot="feed-view-spacer" aria-hidden="true" className="invisible shrink-0 type-body">
          {t('view')}
        </span>
      ) : (
        <TextLink
          render={<Link href={item.href} aria-label={t('viewItem', { text: item.text })} />}
          className="shrink-0 type-body"
        >
          {t('view')}
        </TextLink>
      )}
    </li>
  );
}
