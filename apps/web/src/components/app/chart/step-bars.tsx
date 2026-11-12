'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, type ReactElement, type ReactNode } from 'react';

import { SmallSampleMarker } from './small-sample-marker';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Tooltip } from '@/components/ui/tooltip';
import { safeText, type CsvCell, type CsvTable } from '@/lib/csv/csv-write';
import type { Density } from '@/lib/tables/table-state';
import { cn } from '@/lib/utils';

/** A step's share of the step before, in the caller's words (R1), too few answers behind it (R2), or none (first step). */
export type StepShare =
  | { kind: 'share'; text: string } // "34% of valid answers"
  | { kind: 'thin'; answers: number } // the step before has fewer than 4 (R2)
  | null; // the first step of a group

export interface Step {
  id: string;
  /** "Answers naming you": the visible label and the first words of `accessibleText`. */
  label: string;
  /** A count, or null when unknown (R6: "GA4 not connected"). */
  count: number | null;
  /** "612"; null with a null count. */
  countText: string | null;
  share: StepShare;
  /** Own-brand steps (named, named and cited) are `chart-1`; the others `chart-reference` (CH-36). */
  own: boolean;
  /** Reason for a null count; default `chart.noValue`. */
  noneText?: string | undefined;
  /** "Answers naming you: 612, 34% of valid answers". Starts with `label`. The step's only accessible content. */
  accessibleText: string;
  href?: Route | undefined;
}

export interface StepGroup {
  id: string;
  /** "ChatGPT", or "AI referral sessions (GA4)". */
  label: string;
  /** An engine logo or other mark before the label; decorative, so it is hidden from assistive technology. */
  icon?: ReactNode;
  steps: readonly Step[];
  /** Own scale for a group in another unit or source (CH-30 sessions); default the props' `scaleMax`. */
  scaleMax?: number | undefined;
}

export interface StepBarsProps {
  /** Names the table: "Answer funnel". */
  caption: string;
  groups: readonly StepGroup[];
  /** Shared by every group without its own: lengths compare across engines. */
  scaleMax: number;
  /** First table and CSV header: "Engine". */
  groupHeader: string;
  density?: Density | undefined;
}

export interface StepCsvWords {
  /** "3 answers" from `useTranslations('common.insufficient')`. */
  thin: (answers: number) => string;
  /** Headers from `chart.stepBars.*`. */
  step: string;
  count: string;
  share: string;
}

const FILL_OWN = cn('bg-chart-1');
const FILL_REFERENCE = cn('bg-chart-reference');

/** The bar's length as a share of its scale, clamped to the track; a step without a count has none. */
function barPercent(count: number | null, max: number): number {
  if (count === null || !Number.isFinite(count) || !(max > 0)) return 0;
  return Math.min(100, Math.max(0, (count / max) * 100));
}

/** A step draws a bar when its count and the words for it are known; otherwise it says why (R6). */
const hasCount = (step: Step): step is Step & { count: number; countText: string } =>
  step.count !== null && step.countText !== null;

function ShareText({ share }: { share: StepShare }): ReactElement | null {
  if (share === null) return null;
  return (
    <span data-slot="step-share" className="type-meta text-foreground-tertiary">
      {share.kind === 'thin' ? <SmallSampleMarker answers={share.answers} form="text" /> : share.text}
    </span>
  );
}

function CountText({ text }: { text: string }): ReactElement {
  return (
    <span data-slot="step-count" className="num type-meta whitespace-nowrap text-foreground-tertiary">
      {text}
    </span>
  );
}

interface StepRowProps {
  step: Step;
  max: number;
  density: Density;
}

/**
 * One step, built like a BarList row: the visual part is hidden from assistive technology and the step is read once,
 * from `accessibleText`. Below 448 px the count shares the label's line and the bar runs under it, and the share sits
 * on its own line. From 448 px the bar fills the track and the count sits in a fixed 112 px column after it, with the
 * share wrapped onto a full-width line under the row, so it never narrows the track. From 672 px the share sits inline
 * in a fixed 192 px slot (the track is then at least 176 px), and every row renders the slot, empty on the first step,
 * so every track is as wide and one count is one length. A step without a count writes its reason in flow in place of
 * the bar and truncates it instead of overflowing.
 */
function StepRow({ step, max, density }: StepRowProps): ReactElement {
  const t = useTranslations('chart');
  const compact = density === 'compact';
  const known = hasCount(step);
  const content = (
    <>
      <span className="sr-only">{step.accessibleText}</span>
      <div
        aria-hidden="true"
        className="flex flex-col gap-1 py-1 @md:flex-row @md:flex-wrap @md:items-center @md:gap-x-3 @md:gap-y-1 @2xl:flex-nowrap"
      >
        <div className="flex min-w-0 items-center gap-2 @md:w-40 @md:shrink-0">
          <span
            data-slot="step-label"
            className={cn('min-w-0 flex-1 truncate text-foreground', step.own ? 'type-body-strong' : 'type-body')}
          >
            {step.label}
          </span>
          {known ? (
            <span className="shrink-0 @md:hidden">
              <CountText text={step.countText} />
            </span>
          ) : null}
        </div>
        {known ? (
          <div className="flex min-w-0 items-center gap-2 @md:flex-1">
            <div data-slot="step-track" className="min-w-0 flex-1">
              <div
                data-slot="step-bar"
                className={cn('rounded-2xs', compact ? 'h-4' : 'h-6', step.own ? FILL_OWN : FILL_REFERENCE)}
                style={{ width: `${String(barPercent(step.count, max))}%` }}
              />
            </div>
            <div
              data-slot="step-count-column"
              title={step.countText}
              className="hidden w-28 shrink-0 truncate @md:block"
            >
              <CountText text={step.countText} />
            </div>
          </div>
        ) : (
          <div title={step.noneText} className="min-w-0 truncate @md:flex-1">
            <span className="type-meta whitespace-nowrap text-foreground-tertiary">
              {step.noneText ?? t('noValue')}
            </span>
          </div>
        )}
        <div
          data-slot="step-share-slot"
          title={step.share?.kind === 'share' ? step.share.text : undefined}
          className="min-w-0 truncate empty:hidden @md:w-full @2xl:w-48 @2xl:shrink-0 @2xl:empty:block"
        >
          <ShareText share={step.share} />
        </div>
      </div>
    </>
  );
  // A linked step is at least 32 px tall, above the 24 px minimum target
  const box = cn('flex flex-col justify-center', compact ? 'min-h-row-compact' : 'min-h-row');
  const trigger =
    step.href === undefined ? (
      <div className={box}>{content}</div>
    ) : (
      <Link
        href={step.href}
        className={cn(box, 'rounded-sm outline-none hover:bg-surface-hover focus-visible:focus-ring')}
      >
        {content}
      </Link>
    );
  return (
    <li>
      {/* The accessible text already says what the tooltip says: it is for the eye, and shows a cut label whole */}
      <Tooltip content={step.label} purpose="label">
        {trigger}
      </Tooltip>
    </li>
  );
}

interface StepGroupViewProps {
  group: StepGroup;
  max: number;
  density: Density;
  /** The first group has nothing above it to be set apart from. */
  first: boolean;
}

function StepGroupView({ group, max, density, first }: StepGroupViewProps): ReactElement {
  const labelId = useId();
  return (
    <div
      data-slot="step-group"
      className={cn('flex flex-col gap-2', group.scaleMax !== undefined && !first && 'border-t border-border pt-4')}
    >
      <p id={labelId} className="flex items-center gap-2 type-subsection-title text-foreground">
        {group.icon === undefined ? null : <span aria-hidden="true">{group.icon}</span>}
        {group.label}
      </p>
      <ul aria-labelledby={labelId} className="flex flex-col">
        {group.steps.map((step) => (
          <StepRow key={step.id} step={step} max={group.scaleMax ?? max} density={density} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Nested steps as horizontal bars on a shared scale (DS 15 section 5.1, CH-30, CH-36): one list per group, each step
 * a count and its share of the step before. Never a trapezoid, so lengths stay comparable. The part keeps the order and
 * the words it is given; a step larger than the one before is drawn at its own length. `chart-reference` bars rely on
 * the count beside every bar for their meaning (the DS 15 3:1 bar contrast note); the As built note records this.
 */
export function StepBars({ groups, scaleMax, density = 'default' }: StepBarsProps): ReactElement {
  return (
    <div className="@container flex flex-col gap-4">
      {groups.map((group, index) => (
        <StepGroupView key={group.id} group={group} max={scaleMax} density={density} first={index === 0} />
      ))}
    </div>
  );
}

interface FlatStep {
  group: StepGroup;
  step: Step;
}

const flatten = (groups: readonly StepGroup[]): readonly FlatStep[] =>
  groups.flatMap((group) => group.steps.map((step) => ({ group, step })));

/** The Table view: group, step, count, share of the step before; one row per step. */
export function StepBarsTable({ caption, groups, groupHeader }: StepBarsProps): ReactElement {
  const t = useTranslations('chart');
  const insufficient = useTranslations('common.insufficient');
  const columns: PlainColumn<FlatStep>[] = [
    { id: 'group', header: groupHeader, cell: (row) => row.group.label },
    { id: 'step', header: t('stepBars.step'), cell: (row) => row.step.label },
    {
      id: 'count',
      header: t('stepBars.count'),
      cell: (row) => (hasCount(row.step) ? row.step.countText : (row.step.noneText ?? t('noValue'))),
    },
    {
      id: 'share',
      header: t('stepBars.share'),
      cell: (row) => {
        const { share } = row.step;
        if (share === null) return '';
        return share.kind === 'thin' ? insufficient('answers', { count: share.answers }) : share.text;
      },
    },
  ];
  return (
    <PlainTable<FlatStep>
      caption={caption}
      columns={columns}
      rows={flatten(groups)}
      rowKey={(row) => `${row.group.id}/${row.step.id}`}
      status="ready"
      errorState={null}
      emptyText={t('noValue')}
    />
  );
}

/**
 * Every row, every text cell and the header through `safeText`. A thin share writes its words, an unknown count an
 * empty cell (never 0). Built at once, so a click in the menu cannot throw.
 */
export function stepBarsCsv({ groups, groupHeader }: StepBarsProps, words: StepCsvWords): CsvTable {
  const shareCell = (share: StepShare): CsvCell => {
    if (share === null) return null;
    return safeText(share.kind === 'thin' ? words.thin(share.answers) : share.text);
  };
  return {
    header: [groupHeader, words.step, words.count, words.share].map(safeText),
    rows: flatten(groups).map(({ group, step }) => [
      safeText(group.label),
      safeText(step.label),
      hasCount(step) ? safeText(step.countText) : null,
      shareCell(step.share),
    ]),
  };
}
