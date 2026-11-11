'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, type ReactElement } from 'react';

import { neighbour, type SnapshotOption } from './snapshot-options';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Select, type SelectOption } from '@/components/ui/select';
import { formatInteger, formatTableDateTime } from '@/lib/format';

/** The value of the picker's first entry: the latest check, which has no snapshot id in the address. */
const LATEST = 'latest';

export interface SnapshotPickerProps {
  /** The snapshots known, newest first. */
  options: readonly SnapshotOption[];
  /** The id of the latest check; its row is the "Latest check" entry, not a second one. */
  latestId: string | null;
  /** The dated snapshot chosen; null is the latest check. */
  chosen: string | null;
  timeZone: string;
  /** Called with the id to show; null for the latest check. A step button calls it too. */
  onChoose: (id: string | null) => void;
  /** Called after a step button chose, so the caller can announce the snapshot that is now on show. */
  onStepped: (id: string) => void;
  /** The list is still being read: the picker waits, showing the latest check. */
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadOlder: () => void;
}

/**
 * Chooses which SERP snapshot the tab shows (Decision 7 of the plan: a list of the snapshots that exist, not
 * a calendar, with Previous and Next in time order). Previous goes to the next older snapshot and Next to
 * the next newer one; at an end the button stays in the tab order, disabled, and says why.
 */
export function SnapshotPicker({
  options,
  latestId,
  chosen,
  timeZone,
  onChoose,
  onStepped,
  loading,
  hasMore,
  loadingMore,
  onLoadOlder,
}: SnapshotPickerProps): ReactElement {
  const t = useTranslations('keywordDetail.snapshots.picker');
  const reasonId = useId();

  const textOf = (option: SnapshotOption): string => {
    const when = formatTableDateTime(option.observedAt, timeZone);
    const depth = formatInteger(option.depth);
    const base =
      option.own.state === 'ranked' && option.own.rank !== null
        ? t('option', { when, depth, rank: formatInteger(option.own.rank) })
        : t('optionBeyond', { when, depth });
    return option.urlChanged ? t('urlChanged', { option: base }) : base;
  };

  // The latest check is the first entry and carries the time and rank of the newest snapshot as its description
  const latest = options.find((option) => option.id === latestId);
  const selectOptions: SelectOption<string>[] = [
    { value: LATEST, label: t('latest'), ...(latest === undefined ? {} : { description: textOf(latest) }) },
    ...options
      .filter((option) => option.id !== latestId)
      .map((option) => ({ value: option.id, label: textOf(option) })),
  ];

  const ids = options.map((option) => option.id);
  const current = chosen ?? latestId;
  const older = current === null ? null : neighbour(ids, current, 'older');
  const newer = current === null ? null : neighbour(ids, current, 'newer');
  const step = (id: string | null): void => {
    if (id === null) return;
    onChoose(id);
    onStepped(id);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Field width="long" className="sm:w-90">
        <FieldLabel display="visually-hidden">{t('label')}</FieldLabel>
        <Select<string>
          size="sm"
          value={chosen ?? LATEST}
          onValueChange={(value) => onChoose(value === LATEST ? null : value)}
          placeholder={t('label')}
          options={selectOptions}
          disabled={loading}
        />
      </Field>
      <div className="flex items-center gap-1">
        <IconButton
          icon={ChevronLeft}
          variant="secondary"
          label={t('previous')}
          disabled={older === null}
          focusableWhenDisabled
          aria-describedby={older === null ? `${reasonId}-previous` : undefined}
          onClick={() => step(older)}
        />
        <IconButton
          icon={ChevronRight}
          variant="secondary"
          label={t('next')}
          disabled={newer === null}
          focusableWhenDisabled
          aria-describedby={newer === null ? `${reasonId}-next` : undefined}
          onClick={() => step(newer)}
        />
        {/* What a disabled step button gives as its description: why it cannot step */}
        {older === null ? (
          <span id={`${reasonId}-previous`} className="sr-only">
            {t('atLast')}
          </span>
        ) : null}
        {newer === null ? (
          <span id={`${reasonId}-next`} className="sr-only">
            {t('atFirst')}
          </span>
        ) : null}
      </div>
      {hasMore ? (
        <Button size="sm" variant="secondary" loading={loadingMore} onClick={onLoadOlder}>
          {t('older')}
        </Button>
      ) : null}
    </div>
  );
}
