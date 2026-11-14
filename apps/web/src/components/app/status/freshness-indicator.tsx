'use client';

import { Clock } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { formatRelative } from '@/lib/format';

/** The relative time is read again every minute; the tick is silent (17 section 7.1). */
const TICK_MS = 60_000;

export interface FreshnessIndicatorProps {
  /**
   * `fresh`: the time of the newest answer. `stale`: the same, with a warning badge. `none`: nothing has been
   * collected. The caller decides which, from the rule of its page; the other states of 17 section 7.1 (running,
   * partial, delayed, failed, budget blocked) are not built yet.
   */
  state: 'fresh' | 'stale' | 'none';
  /** The instant of the newest answer; `null` for `none`. */
  lastAnswerAt: string | null;
  /** The project's zone, for the relative time that falls back to a date. */
  timeZone: string;
  /** What is drawn: "AI updated Nov 12, 02:10", or "No AI answers yet" for `none`. */
  text: string;
  /** `stale` only: the badge's words, "Last answer 6 days ago". The words carry the warning, the colour supports them. */
  badgeText?: string | undefined;
  /** The tooltip's line from the relative time: "Newest answer 3h ago". */
  tooltip: (relative: string) => string;
}

/**
 * How current the data is, for a page's meta line (17 section 7, 25 section 11.4), reduced to what the AI Overview
 * needs. The time is a `<time datetime>` inside a button, so a keyboard reaches the tooltip with the relative time,
 * which refreshes every minute without announcing. A stale answer adds a warning badge with an icon and words.
 */
export function FreshnessIndicator({
  state,
  lastAnswerAt,
  timeZone,
  text,
  badgeText,
  tooltip,
}: FreshnessIndicatorProps): ReactElement {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (lastAnswerAt === null) return undefined;
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, [lastAnswerAt]);
  if (state === 'none' || lastAnswerAt === null) return <span className="type-meta">{text}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 align-middle">
      <Tooltip content={tooltip(formatRelative(lastAnswerAt, timeZone, now))}>
        <button type="button" className="cursor-default rounded-sm type-meta focus-visible:focus-ring">
          <time dateTime={lastAnswerAt}>{text}</time>
        </button>
      </Tooltip>
      {state === 'stale' && badgeText !== undefined ? (
        <Badge tone="warning" icon={Clock}>
          {badgeText}
        </Badge>
      ) : null}
    </span>
  );
}
