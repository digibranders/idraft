import type { ReactElement, ReactNode } from 'react';

import type { FactsRow, LinkedKeywordVolume } from '../facts';
import type { Translate } from '../seams/shared';
import type { CellTip } from '@/components/app/data-table/types';
import type { ProjectEngine } from '@/lib/api/types';
import { EMPTY_VALUE, formatList } from '@/lib/format';

/** What the metric columns need to put words to a row: the platforms in scope and the catalog's translator. */
export interface MetricContext {
  t: Translate;
  locale: string;
  /** The platforms the Platform select leaves in, in order; their labels name them in a tooltip. */
  engines: readonly ProjectEngine[];
  /** Their codes, in the same order. */
  scope: readonly string[];
}

/**
 * Whether the facts of a row were read and hold no entry for any platform in view: the row has no answer there. An entry
 * without a field is another thing (the backend does not send it yet).
 */
export const unanswered = (facts: FactsRow, scope: readonly string[]): boolean =>
  !scope.some((code) => facts.engines.some((engine) => engine.engine_code === code));

/** The platform whose answers come from the rank checks of a linked keyword. */
export const AI_OVERVIEW = 'google_ai_overview';

export const platformLabel = (context: MetricContext, code: string): string =>
  context.engines.find((engine) => engine.engine.engine_code === code)?.engine.label ?? code;

/** "ChatGPT and Gemini": the platforms a figure rests on, in the order given. */
export const platformList = (context: MetricContext, codes: readonly string[]): string =>
  formatList(
    codes.map((code) => platformLabel(context, code)),
    context.locale,
  );

/** The hatched ground of a figure that is too thin to show: a count, or "Not enough data". */
export function HatchedPill({ children }: { children: ReactNode }): ReactElement {
  return (
    <span className="inline-flex h-6 items-center rounded-xs bg-insufficient px-1.5 type-label whitespace-nowrap text-foreground-tertiary">
      {children}
    </span>
  );
}

/** A missing value: its word in tertiary text; the reason is the cell's tooltip. */
export function Missing({ label }: { label: string }): ReactElement {
  return <span className="text-foreground-tertiary">{label}</span>;
}

/** A cell that shows a missing value: its word and the reason it gives. */
export interface UnknownCell {
  label: string;
  tip: string;
}

export const notCollected = (context: MetricContext): UnknownCell => ({
  label: EMPTY_VALUE,
  tip: context.t('prompts.metrics.notCollectedTip'),
});

export const tipOf = (cell: UnknownCell): CellTip => ({ content: cell.tip });

/** Why a row has no answer: the platform's own reason when one platform is in view, else the plain one. */
export interface Absence {
  /** `n/a`, or `None` for a Google AI Overview that was not shown for a linked keyword. */
  label: string;
  /** For a cell that has a tooltip of its own: "Google AI Overview: no linked keyword. ..." or "No answers in this period". */
  tip: string;
  /** For a cell that quotes the reason in a sentence of its own: capitalised, with its full stop. */
  sentence: string;
}

/**
 * The absence of a row with no valid answer (R6: unknown is never zero). Google AI Overview has no answers of its own:
 * it is read from the rank checks of the keyword a prompt is linked to, so with it alone in view the reason says whether
 * a keyword is linked and whether the overview was shown. `link` is `undefined` while the facts are not read.
 */
export function absenceOf(context: MetricContext, link: LinkedKeywordVolume | null | undefined): Absence {
  const { t, scope } = context;
  const [only] = scope;
  if (scope.length === 1 && only === AI_OVERVIEW && link !== undefined) {
    const platform = platformLabel(context, only);
    if (link === null) {
      return {
        label: EMPTY_VALUE,
        tip: t('prompts.metrics.absence.platformTip', {
          platform,
          reason: t('prompts.metrics.absence.reason.noLinkedKeyword'),
        }),
        sentence: t('prompts.metrics.absence.sentence.noLinkedKeyword'),
      };
    }
    return {
      label: t('prompts.metrics.absence.none'),
      tip: t('prompts.metrics.absence.platformTip', {
        platform,
        reason: t('prompts.metrics.absence.reason.noOverview', { keyword: link.keyword }),
      }),
      sentence: t('prompts.metrics.absence.sentence.noOverview', { keyword: link.keyword }),
    };
  }
  if (scope.length === 1 && only !== undefined) {
    return {
      label: EMPTY_VALUE,
      tip: t('prompts.metrics.absence.platformTip', {
        platform: platformLabel(context, only),
        reason: t('prompts.metrics.absence.reason.noAnswers'),
      }),
      sentence: t('prompts.metrics.absence.sentence.noAnswers'),
    };
  }
  return {
    label: EMPTY_VALUE,
    tip: t('prompts.metrics.noAnswersTip'),
    sentence: t('prompts.metrics.noAnswersTip'),
  };
}
