'use client';

import { ChevronDown, ChevronRight, CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';

import { ANNOUNCE_DELAY_MS, CHECKS_KEY } from './add-announce';
import { lineCounts } from './add-model';
import { counterText, groupRows, type CheckGroup, type CheckReason, type CheckRow, type CheckTone } from './check-rows';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Icon } from '@/components/ui/icon';
import { Truncate } from '@/components/ui/truncate';
import { announce } from '@/lib/a11y/announcer';
import { cn } from '@/lib/utils';

/** Lines of a group shown before the rest are asked for; the lines that cannot be added are never held back. */
const SHOWN_LINES = 5;

const TONE_ICON = { error: CircleAlert, warning: TriangleAlert, note: Info } as const;
const TONE_CLASS: Readonly<Record<CheckTone, string>> = {
  error: cn('text-negative-text'),
  warning: cn('text-warning-text'),
  note: cn('text-foreground-secondary'),
};

export interface CheckRestore {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export interface CheckListProps {
  /** The lines with their outcome and reasons, as `checkRowsOf` makes them (or WP-28 makes them from a file). */
  rows: readonly CheckRow[];
  /** The typing has not settled or the lint is out: the rows are the last ones. */
  checking: boolean;
  /** The lint could not be read: the rows come from what the page loaded. */
  failed: boolean;
  /** No country is chosen, so what is tracked is not known yet. */
  needsCountry: boolean;
  /** The archived lines can be brought back with the add; `null` when the caller does not offer it. */
  restore: CheckRestore | null;
  /** Shows the project's prompt of a tracked line; `null` when the caller cannot, which hides "Show it". */
  onShow: ((target: string) => void) | null;
}

function Reason({ reason }: { reason: CheckReason }): ReactElement {
  const t = useTranslations('prompts.add.check');
  return (
    <p className={cn('flex items-start gap-1.5 type-meta', TONE_CLASS[reason.tone])}>
      <Icon icon={TONE_ICON[reason.tone]} size="sm" className="mt-0.5" />
      <span>
        {/* The tone in words, as the icon is not read */}
        <span className="sr-only">{t(`tone.${reason.tone}`)}</span> {reason.text}
      </span>
    </p>
  );
}

function CheckItem({ row, onShow }: { row: CheckRow; onShow: CheckListProps['onShow'] }): ReactElement {
  const t = useTranslations('prompts.add.check');
  const [all, setAll] = useState(false);
  const [first, ...rest] = row.reasons;
  const target = row.target;
  return (
    <li className="flex flex-col gap-1 py-1.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 num type-label text-foreground-secondary">{t('line', { line: row.line })}</span>
        <Truncate text={row.text} lang={row.language} className="min-w-0 flex-1 type-body" />
        {onShow === null || target === null ? null : (
          <Button
            variant="link"
            size="sm"
            aria-label={t('showItLabel', { line: row.line })}
            onClick={() => onShow(target)}
          >
            {t('showIt')}
          </Button>
        )}
      </div>
      {first === undefined ? null : <Reason reason={first} />}
      {all ? rest.map((reason) => <Reason key={reason.text} reason={reason} />) : null}
      {rest.length === 0 ? null : (
        <Button variant="link" size="sm" aria-expanded={all} className="self-start" onClick={() => setAll(!all)}>
          {all ? t('fewerChecks') : t('moreChecks', { count: rest.length })}
        </Button>
      )}
      {row.suggestedType === null ? null : <p className="type-meta text-foreground-tertiary">{row.suggestedType}</p>}
    </li>
  );
}

function Group({
  group,
  restore,
  onShow,
}: {
  group: CheckGroup;
  restore: CheckRestore | null;
  onShow: CheckListProps['onShow'];
}): ReactElement {
  const t = useTranslations('prompts.add.check');
  const [all, setAll] = useState(false);
  const holdBack = group.id !== 'refused' && !all;
  const shown = holdBack ? group.rows.slice(0, SHOWN_LINES) : group.rows;
  const hidden = group.rows.length - SHOWN_LINES;
  return (
    <li className="flex flex-col gap-1">
      <h3 className="type-subsection-title">{t(`groups.${group.id}`, { count: group.rows.length })}</h3>
      {group.id === 'archived' && restore !== null ? (
        <Checkbox
          checked={restore.checked}
          onCheckedChange={restore.onCheckedChange}
          label={t('restore', { count: group.rows.length })}
          description={t('restoreHint')}
        />
      ) : null}
      <ul className="flex flex-col divide-y divide-border-subtle">
        {shown.map((row) => (
          <CheckItem key={row.line} row={row} onShow={onShow} />
        ))}
      </ul>
      {hidden > 0 && group.id !== 'refused' ? (
        <Button variant="link" size="sm" aria-expanded={all} className="self-start" onClick={() => setAll(!all)}>
          {all ? t('showFewer') : t('showMore', { count: hidden })}
        </Button>
      ) : null}
    </li>
  );
}

/**
 * The line check list of the Add prompts dialog (prompt-dialogs 4.3): a disclosure under the field, closed while no
 * line has a problem and open when one cannot be added. Lines are grouped by outcome, each with its reasons, as plain
 * rows, so the dialog and the CSV review show them the same way. It is an inline disclosure at every width: a dialog
 * opens no second overlay. The counts are spoken through the announcer once, after the typing and the lint settle.
 */
export function CheckList({
  rows,
  checking,
  failed,
  needsCountry,
  restore,
  onShow,
}: CheckListProps): ReactElement | null {
  const t = useTranslations('prompts.add');
  const locale = useLocale();
  const regionId = useId();
  const [chosen, setChosen] = useState<boolean | null>(null);
  const groups = useMemo(() => groupRows(rows), [rows]);
  const counts = useMemo(() => lineCounts(rows), [rows]);
  const counter = counterText(t, locale, counts);
  const warned = groups.find((group) => group.id === 'warnings')?.rows.length ?? 0;
  // What the person decided stands; until then it is open for a line that cannot be added
  const open = chosen ?? counts.refused > 0;

  const spoken = useRef<string | null>(null);
  useEffect(() => {
    if (checking || counter === null || spoken.current === counter) return;
    spoken.current = counter;
    announce(counter, { key: CHECKS_KEY, debounceMs: ANNOUNCE_DELAY_MS });
  }, [checking, counter]);

  if (rows.length === 0) return null;
  const summary = checking
    ? t('check.checking')
    : counts.refused > 0
      ? t('check.summaryProblems', { count: counts.refused })
      : warned > 0
        ? t('check.summaryWarnings', { count: warned })
        : t('check.summaryClear');
  const summaryTone: CheckTone =
    !checking && counts.refused > 0 ? 'error' : !checking && warned > 0 ? 'warning' : 'note';
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="ghost"
        size="sm"
        icon={open ? ChevronDown : ChevronRight}
        aria-expanded={open}
        aria-controls={regionId}
        className="self-start"
        onClick={() => setChosen(!open)}
      >
        {t('check.title')}
        <span className={cn('type-meta', TONE_CLASS[summaryTone])}>{summary}</span>
      </Button>
      <div id={regionId} hidden={!open} className="flex flex-col gap-2">
        {open ? (
          <>
            {needsCountry ? (
              <p className="flex items-start gap-1.5 type-meta text-foreground-secondary">
                <Icon icon={Info} size="sm" className="mt-0.5" />
                {t('check.needsCountry')}
              </p>
            ) : null}
            {failed ? (
              <p className="flex items-start gap-1.5 type-meta text-foreground-secondary">
                <Icon icon={Info} size="sm" className="mt-0.5" />
                {t('check.failed')}
              </p>
            ) : null}
            <ul aria-label={t('check.label')} aria-busy={checking} className="flex flex-col gap-3">
              {groups.map((group) => (
                <Group key={group.id} group={group} restore={restore} onShow={onShow} />
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
