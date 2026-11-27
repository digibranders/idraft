'use client';

import { Target, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { pageToken, stripFacts, type Verdict } from './cann-model';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Tooltip } from '@/components/ui/tooltip';
import { Truncate } from '@/components/ui/truncate';
import type { CannKeyword, CannPage } from '@/lib/api/types';
import { cn } from '@/lib/utils';

// Class names are written out, so the stylesheet keeps them: a name built from the token would be dropped
const BORDER: Readonly<Record<string, string>> = {
  'chart-1': 'border-chart-1',
  'chart-2': 'border-chart-2',
  'chart-3': 'border-chart-3',
  'chart-4': 'border-chart-4',
  'chart-5': 'border-chart-5',
  'chart-6': 'border-chart-6',
  'chart-other': 'border-dashed border-chart-other',
};
const FILL: Readonly<Record<string, string>> = {
  'chart-1': 'bg-chart-1',
  'chart-2': 'bg-chart-2',
  'chart-3': 'bg-chart-3',
  'chart-4': 'bg-chart-4',
  'chart-5': 'bg-chart-5',
  'chart-6': 'bg-chart-6',
  'chart-other': 'bg-chart-other',
};

/** The fill class of a chart token, for a cell that carries a page's color. */
export const pageFill = (token: string): string => FILL[token] ?? 'bg-chart-other';

/**
 * A page's identity without color: its letter in a box whose border carries the page's color. The same letter and
 * color name the page in the table, the history strip and the lists (docs/33 section 7.2).
 */
export function PageMark({ letter }: { letter: string }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-sm border-2 type-label text-foreground',
        BORDER[pageToken(letter)],
      )}
    >
      {letter}
    </span>
  );
}

export interface PageChipProps {
  page: Pick<CannPage, 'letter' | 'path' | 'title'>;
  strong?: boolean;
}

/** One page: its letter mark and its short path. The title and the address are the tooltip. */
export function PageChip({ page, strong = false }: PageChipProps): ReactElement {
  const t = useTranslations('cannibalization.cells');
  const tip = page.title === null ? page.path : t('pageTip', { title: page.title, path: page.path });
  return (
    <Tooltip content={tip} purpose="label">
      <span className="inline-flex min-w-0 shrink items-center gap-1.5">
        <PageMark letter={page.letter} />
        <span className="sr-only">{t('pageName', { letter: page.letter })}</span>
        <span className={cn('truncate', strong ? 'type-body-strong text-foreground' : 'text-foreground-secondary')}>
          {page.path}
        </span>
      </span>
    </Tooltip>
  );
}

/** One page as a letter mark and its whole path, wrapped rather than cut: for the lists of the keyword inspector. */
export function PageLine({
  page,
  strong = false,
}: {
  page: Pick<CannPage, 'letter' | 'path'>;
  strong?: boolean;
}): ReactElement {
  const t = useTranslations('cannibalization.cells');
  return (
    <span className="inline-flex min-w-0 items-start gap-1.5">
      <PageMark letter={page.letter} />
      <span className="sr-only">{t('pageName', { letter: page.letter })}</span>
      <span className={cn('wrap-anywhere', strong ? 'type-body-strong text-foreground' : 'text-foreground-secondary')}>
        {page.path}
      </span>
    </span>
  );
}

/**
 * The status of a keyword as a badge: warning only for likely cannibalization. The table shows the short word; the full
 * name is the tooltip and what a screen reader says.
 */
export function VerdictBadge({ verdict }: { verdict: Verdict }): ReactElement {
  const t = useTranslations('cannibalization.verdict');
  const quiet = verdict === 'insufficient' || verdict === 'unranked';
  return (
    <Tooltip content={t('tip', { label: t(`${verdict}.label`), what: t(`${verdict}.what`) })} purpose="label">
      <span className="inline-flex">
        <span aria-hidden="true">
          <Badge
            tone={verdict === 'likely' ? 'warning' : 'neutral'}
            icon={verdict === 'likely' ? TriangleAlert : undefined}
            className={cn(quiet && 'text-foreground-tertiary')}
          >
            {t(`${verdict}.short`)}
          </Badge>
        </span>
        <span className="sr-only">{t(`${verdict}.label`)}</span>
      </span>
    </Tooltip>
  );
}

export type UnknownKind = 'rank' | 'page' | 'volume' | 'overlap' | 'gap' | 'target';

/** What a cell says when it has nothing to show: a word, never a bare mark. */
export function NoValue({ kind }: { kind: UnknownKind }): ReactElement {
  const t = useTranslations('cannibalization.unknown');
  return <span className="text-foreground-tertiary">{t(kind)}</span>;
}

/** A keyword with a mark when the ranking page is not the page set as its target. */
export function KeywordCell({ row }: { row: CannKeyword }): ReactElement {
  const t = useTranslations('cannibalization.cells');
  const current = row.pages.find((page) => page.url_id === row.current_url_id);
  const target = row.pages.find((page) => page.url_id === row.target_url_id);
  return (
    <>
      <Truncate text={row.keyword} className="text-foreground" />
      {row.on_target === false ? (
        <Tooltip
          content={
            current !== undefined && target !== undefined
              ? t('notTargetTip', { current: current.path, target: target.path })
              : t('notTarget')
          }
          purpose="label"
        >
          <span className="inline-flex shrink-0 text-warning-text">
            <Icon icon={Target} size="sm" />
            <span className="sr-only">{t('notTarget')}</span>
          </span>
        </Tooltip>
      ) : null}
    </>
  );
}

/** The text of a history strip: the checks per page and the switches, which is all the picture says. */
export function useStripText(row: CannKeyword): string {
  const t = useTranslations('cannibalization.strip');
  const facts = stripFacts(row);
  if (facts.checks === 0) return t('noChecks');
  return t('label', {
    checks: facts.checks,
    switches: facts.switches,
    pages: facts.pages.map((page) => t('page', page)).join(', '),
  });
}

/** The checks on which the ranking page differs from the one on the last earlier check that named a page. */
function switchIndexes(strip: CannKeyword['strip']): Set<number> {
  const found = new Set<number>();
  let before: string | null = null;
  strip.forEach((cell, index) => {
    if (cell.kind !== 'page' || cell.url_id === null) return;
    if (before !== null && before !== cell.url_id) found.add(index);
    before = cell.url_id;
  });
  return found;
}

/**
 * The page that ranked on each check of the period, one cell per check in the color of that page: a change of color
 * is a switch. A hollow cell is a check whose result address Google hid, a faint one a check with no rank. It is one
 * image with the text alternative above.
 */
export function HistoryStrip({ row }: { row: CannKeyword }): ReactElement {
  const text = useStripText(row);
  const letters = new Map(row.pages.map((page) => [page.url_id, page.letter]));
  const switches = switchIndexes(row.strip);
  return (
    <Tooltip content={text} purpose="label">
      <span role="img" aria-label={text} className="flex h-4 w-full items-stretch gap-px">
        {row.strip.map((cell, index) => (
          <span
            key={`${cell.date}:${String(index)}`}
            className={cn(
              'min-w-px flex-1 rounded-xs',
              // A switch also shows without color: a dark edge where the ranking page changes
              switches.has(index) && 'border-l border-foreground',
              cell.kind === 'page' && cell.url_id !== null
                ? FILL[pageToken(letters.get(cell.url_id) ?? '+')]
                : cell.kind === 'unreadable'
                  ? 'border border-border-strong'
                  : 'bg-surface-subtle',
            )}
          />
        ))}
      </span>
    </Tooltip>
  );
}
