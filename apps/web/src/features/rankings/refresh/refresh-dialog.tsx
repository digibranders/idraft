'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement, type RefObject } from 'react';

import { MAX_REFRESH_KEYWORDS, STALE_DAYS, leftToday, refreshBody, type RefreshChoice } from './refresh-model';
import { REFRESH_METRICS } from './refresh-queries';
import { BulkDialog } from '../bulk/bulk-dialog';
import { refreshKeywords, type ProjectScope } from '../rankings-queries';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { RadioGroup, type RadioOption } from '@/components/ui/radio-group';
import { isApiProblem } from '@/lib/api/problem';
import type { ManualRuns, Run } from '@/lib/api/types';
import { formatInteger } from '@/lib/format';

/** What the dialog may refresh, worked out by the screen from the table's selection and the list it holds. */
export interface RefreshTargets {
  /** The keyword ids (not tracked keyword ids) of the chosen keywords; `null` when none are chosen. */
  selection: readonly string[] | null;
  /**
   * The keywords the filters match. `ids` is `null` when they cannot be named: the list holds more than a
   * page's worth of them (`too-many`), or has not finished loading (`loading`).
   */
  matching: { count: number; ids: readonly string[] | null; why: 'too-many' | 'loading' | null } | null;
  /** Filters or a search narrow the list, so refreshing what it shows is a choice worth starting on. */
  narrowed: boolean;
  /** Every keyword the filters match is chosen in the table. */
  allChosen: boolean;
}

export interface RefreshDialogProps {
  scope: ProjectScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: RefObject<HTMLElement | null>;
  targets: RefreshTargets;
  /** The day's manual runs; `null` before they are read. */
  manual: ManualRuns | null;
  /** The API took the refresh: the run it made, which may already be `budget_blocked`. */
  onStarted: (run: Run) => void;
  /** The day's count is out of date: the API said the limit is reached. */
  onLimitReached: () => void;
}

interface Choices {
  options: RadioOption<RefreshChoice>[];
  /** What the dialog starts on. */
  start: RefreshChoice;
  /** How many keywords each choice refreshes, `null` for the stale ones, which the API picks. */
  counts: Readonly<Record<RefreshChoice, number | null>>;
}

/** The 400 px dialog of Refresh metrics: what to refresh, and how many manual refreshes are left today. */
export function RefreshDialog({
  scope,
  open,
  onOpenChange,
  finalFocus,
  targets,
  manual,
  onStarted,
  onLimitReached,
}: RefreshDialogProps): ReactElement {
  const t = useTranslations('rankings.refresh');
  const queryClient = useQueryClient();
  const refresh = useMutation(REFRESH_METRICS);
  const [picked, setPicked] = useState<RefreshChoice | null>(null);
  const [alert, setAlert] = useState<string | null>(null);

  const choices = choicesOf(targets, t);
  const enabled = new Set(choices.options.filter((option) => option.disabled !== true).map((option) => option.value));
  const choice = picked !== null && enabled.has(picked) ? picked : choices.start;
  const count = choices.counts[choice];

  const close = (): void => {
    setPicked(null);
    setAlert(null);
    onOpenChange(false);
  };
  const submit = useSubmitOnce(async (event) => {
    event.preventDefault();
    setAlert(null);
    const ids =
      choice === 'selection' ? targets.selection : choice === 'matching' ? (targets.matching?.ids ?? null) : [];
    if (ids === null) return;
    try {
      const answer = await refresh.mutateAsync({
        params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
        body: refreshBody(choice, ids),
      });
      onStarted(answer.data);
      close();
    } catch (error) {
      if (isApiProblem(error, 'manual_run_limit')) {
        onLimitReached();
        setAlert(t('errors.limit', { limit: formatInteger(error.number('limit') ?? manual?.limit ?? 20) }));
      } else if (
        isApiProblem(error, 'validation_failed') &&
        error.errors.some((item) => item.code === 'keyword_unknown')
      ) {
        // A keyword was archived or removed meanwhile: the list is read again, and the choice made once more
        void refreshKeywords(queryClient, scope);
        setAlert(t('errors.keywordUnknown'));
      } else if (isApiProblem(error) && error.status === 403) {
        setAlert(t('errors.forbidden'));
      } else {
        setAlert(t('errors.failed'));
      }
    }
  });

  return (
    <BulkDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t('dialog.title')}
      description={t('dialog.description')}
      submitLabel={count === null ? t('dialog.submit') : t('dialog.submitCount', { count })}
      pending={refresh.isPending}
      alert={alert}
      dirty={false}
      onSubmit={submit}
      finalFocus={finalFocus}
    >
      <RadioGroup<RefreshChoice>
        legend={t('dialog.choices')}
        value={choice}
        onValueChange={setPicked}
        options={choices.options}
      />
      {manual === null ? null : (
        <p className="type-meta">
          {t('dialog.left', { left: formatInteger(leftToday(manual)), limit: formatInteger(manual.limit) })}
        </p>
      )}
    </BulkDialog>
  );
}

type Translate = ReturnType<typeof useTranslations<'rankings.refresh'>>;

/** The options the dialog offers, the one it starts on and how many keywords each takes. */
function choicesOf(targets: RefreshTargets, t: Translate): Choices {
  const { selection, matching, narrowed, allChosen } = targets;
  const options: RadioOption<RefreshChoice>[] = [];
  const counts: Record<RefreshChoice, number | null> = { selection: null, matching: null, stale: null };
  const limit = formatInteger(MAX_REFRESH_KEYWORDS);

  if (selection !== null && selection.length > 0) {
    const over = selection.length > MAX_REFRESH_KEYWORDS;
    counts.selection = selection.length;
    options.push({
      value: 'selection',
      label: t('dialog.selection', { count: selection.length }),
      description: over ? t('dialog.tooMany', { limit }) : t('dialog.selectionHint'),
      disabled: over,
    });
  }
  if (matching !== null && matching.count > 0) {
    const why = matching.why ?? (matching.count > MAX_REFRESH_KEYWORDS ? 'too-many' : null);
    counts.matching = matching.ids?.length ?? null;
    options.push({
      value: 'matching',
      label: narrowed
        ? t('dialog.matching', { count: matching.count })
        : t('dialog.matchingAll', { count: matching.count }),
      description:
        why === 'too-many'
          ? t('dialog.tooMany', { limit })
          : why === 'loading'
            ? t('dialog.matchingLoading')
            : t('dialog.matchingHint'),
      disabled: why !== null,
    });
  }
  options.push({
    value: 'stale',
    label: t('dialog.stale'),
    description: t('dialog.staleHint', { days: STALE_DAYS }),
  });

  const usable = (value: RefreshChoice): boolean =>
    options.some((option) => option.value === value && option.disabled !== true);
  const start: RefreshChoice = usable('selection')
    ? 'selection'
    : usable('matching') && (allChosen || narrowed)
      ? 'matching'
      : 'stale';
  return { options, start, counts };
}
