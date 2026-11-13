'use client';

import type { ReactElement, ReactNode } from 'react';

import { CollectionLineView } from '@/components/app/status/collection-line-view';
import { useCan } from '@/lib/permissions';
import { lineOf } from '@/lib/runs/ai-health-model';
import { useNewestRun, type AiRunsScope } from '@/lib/runs/ai-reads';

export interface CollectionLineProps {
  scope: AiRunsScope;
  /** The project's time zone: the line's time is the project's. */
  timeZone: string;
  /** Whether the sidebar is the 56 px rail: only the icon shows, with a tooltip. */
  rail?: boolean | undefined;
}

/**
 * The sidebar's collection line (WP-30 decision D13): the newest run of the project, read once a minute. A
 * member who cannot read the data (billing) gets no line and no request; the sidebar's wrapper is empty then
 * and hides itself.
 */
export function CollectionLine(props: CollectionLineProps): ReactNode {
  return useCan('data:read') ? <ReadLine {...props} /> : null;
}

function ReadLine({ scope, timeZone, rail }: CollectionLineProps): ReactElement {
  const read = useNewestRun(scope);
  // The clock is read when the data changes: a poll that answers the same does not render again, so a line
  // that was "06:12" stays so past midnight until the next run (shortcut: a day-old time is cheap to be wrong about)
  return <CollectionLineView line={read === null ? null : lineOf(read, timeZone)} rail={rail} />;
}
