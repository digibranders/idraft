'use client';

import { CircleDashed, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { CollectionStatusIcon } from './collection-progress';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import type { LineDescription } from '@/lib/runs/ai-health-model';
import { cn } from '@/lib/utils';

export interface CollectionLineViewProps {
  /** What to say, from `lineOf`; `null` while the newest run is being read. */
  line: LineDescription | null;
  /** Whether the sidebar is the 56 px rail: only the icon shows, and a tooltip carries the words. */
  rail?: boolean | undefined;
}

/**
 * The collection line at the foot of the sidebar (24-page-templates.md section 9.1, WP-30 decision D13): a
 * status icon and when the project last collected and how much of it arrived, or "Running now". It is a quiet
 * line that takes the `type-label` of the wrapper the sidebar puts it in. In the rail only the icon is drawn:
 * it is a named, focusable region whose name is the words, so a tooltip shows them to the eye with a pointer
 * or the keyboard, and assistive technology reads them once.
 */
export function CollectionLineView({ line, rail = false }: CollectionLineViewProps): ReactElement {
  const t = useTranslations('runs.line');
  const box = cn('flex min-h-6 items-center', rail && 'justify-center');
  if (line === null) {
    return (
      <div data-slot="collection-line" className={box}>
        <Skeleton shape="text-12" widthPct={rail ? 48 : 72} />
        <span className="sr-only">{t('loading')}</span>
      </div>
    );
  }
  const text = textOf(t, line);
  if (!rail) {
    return (
      <div data-slot="collection-line" className="flex items-start gap-2">
        <span className="mt-px flex shrink-0">
          <LineIcon line={line} />
        </span>
        <span className="min-w-0">{text}</span>
      </div>
    );
  }
  return (
    <div data-slot="collection-line" className={box}>
      {/* The tooltip repeats the region's name, so it is for the eye only; the region takes the focus a tooltip needs */}
      <Tooltip content={text} side="right" purpose="label">
        <span
          role="region"
          aria-label={text}
          tabIndex={0}
          className="flex min-h-6 items-center rounded-xs focus-visible:focus-ring"
        >
          <LineIcon line={line} />
        </span>
      </Tooltip>
    </div>
  );
}

function LineIcon({ line }: { line: LineDescription }): ReactElement {
  switch (line.kind) {
    case 'running':
    case 'finished':
      return <CollectionStatusIcon status={line.status} />;
    case 'unavailable':
      return <Icon icon={TriangleAlert} size="sm" className="text-warning-text" />;
    case 'none':
      return <Icon icon={CircleDashed} size="sm" className="text-foreground-tertiary" />;
  }
}

type LineTranslator = ReturnType<typeof useTranslations<'runs.line'>>;

function textOf(t: LineTranslator, line: LineDescription): string {
  switch (line.kind) {
    case 'none':
      return t('none');
    case 'unavailable':
      return t('unavailable');
    case 'running':
      return t('running');
    case 'finished':
      return line.counts === null
        ? t('lastRunBare', { when: line.when })
        : t('lastRun', {
            when: line.when,
            done: line.counts.done,
            total: line.counts.total,
            noun: line.counts.noun,
          });
  }
}
