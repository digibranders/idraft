'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactNode } from 'react';

import type { CardEngine } from './card-engine';
import { useOverview } from '../../../overview-context';
import type { Read } from '../../../data/read-state';
import type { Say } from '../../../numbers/number-model';
import type { ChartEmpty, ChartError, ChartNotice } from '@/components/app/chart/chart-frame';
import { TextLink } from '@/components/ui/text-link';
import { formatInteger } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { projectPath } from '@/lib/routes/paths';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/**
 * The one mapping from what a card has read to what its `ChartFrame` shows (WP-35 plan section 3.2). A card
 * computes its data from the reads, says which of the situations below the data is in, and spreads the result into
 * the frame (`status`, `notice`, `empty`, `error`); no card words these states itself, so they read alike.
 */

/** What the frame needs of a read: its status, the error id, whether the data is the last one read, and a retry. */
export type ReadFacts = Pick<Read<unknown>, 'status' | 'errorId' | 'stale' | 'refetch'>;

/**
 * What the data says once it is read. Only a card knows: it holds the figures.
 * - `too_few`: fewer than 4 valid answers name a tracked brand (`answers` is how many do).
 * - `no_competitor`: only the own brand is tracked.
 * - `no_answers`: the engine has no valid answer in the window.
 */
export type DataSituation =
  { kind: 'ready' } | { kind: 'too_few'; answers: number } | { kind: 'no_competitor' } | { kind: 'no_answers' };

export interface FrameInput {
  /** What the card shows, in lower case, for "Could not load share of voice". */
  subject: string;
  /** The current window's read. */
  read: ReadFacts;
  /** The previous window's read; `null` when the comparison is off or unavailable. */
  previous: ReadFacts | null;
  /** The previous window was read and holds no answer for this card: it has no deltas to show. */
  previousEmpty: boolean;
  /** The engine of the card; `null` for a card that reads every engine in scope. */
  engine: CardEngine | null;
  situation: DataSituation;
}

/** The status of the frame and what goes with it: the shape `ChartFrame` takes for its state. */
export type FrameState = (
  | { status: 'loading' | 'ready' | 'refetching'; empty?: undefined; error?: undefined }
  | { status: 'empty'; empty: ChartEmpty; error?: undefined }
  | { status: 'error'; error: ChartError; empty?: undefined }
) & { notice?: ChartNotice | undefined };

/** The words of the states: the family's messages, and the words of an error id and its retry. */
export interface FrameWords {
  /** The messages of `aiOverview.competitors.common`. */
  say: Say;
  errorId: (id: string) => string;
  copyErrorId: string;
  copied: string;
  retry: string;
}

/** Where the states send a member, and who may follow. */
export interface FrameContext {
  enginesHref: Route;
  entitiesHref: Route;
  /** May turn engines on (`projects:write`). */
  canManageEngines: boolean;
  /** May add competitors (`entities:write`). */
  canEditEntities: boolean;
  /** The days of the window, for "No valid answers on ChatGPT in these 28 days". */
  days: number;
}

const link = (href: Route, label: string): ReactNode => <TextLink render={<Link href={href} />}>{label}</TextLink>;

function engineEmpty(engine: CardEngine, words: FrameWords, ctx: FrameContext): ChartEmpty {
  const { say } = words;
  const name = { engine: engine.label };
  const title = say('engineOffTitle', name);
  if (engine.availability === 'outside') return { title, reason: say('engineOutsideReason', name) };
  if (ctx.canManageEngines) {
    return { title, reason: say('engineOffReason', name), action: link(ctx.enginesHref, say('toEngines')) };
  }
  return { title, reason: `${say('engineOffReason', name)} ${say('askAdmin')}` };
}

function situationEmpty(
  situation: Exclude<DataSituation, { kind: 'ready' }>,
  engine: CardEngine | null,
  words: FrameWords,
  ctx: FrameContext,
): ChartEmpty {
  const { say } = words;
  switch (situation.kind) {
    case 'too_few':
      return {
        title: say('tooFewTitle', { count: formatInteger(situation.answers) }),
        reason: say('tooFewReason', { min: formatInteger(MIN_OBSERVATIONS) }),
      };
    case 'no_competitor':
      return ctx.canEditEntities
        ? {
            title: say('noCompetitorTitle'),
            reason: say('noCompetitorReason'),
            action: link(ctx.entitiesHref, say('toEntities')),
          }
        : { title: say('noCompetitorTitle'), reason: `${say('noCompetitorReason')} ${say('noCompetitorAsk')}` };
    case 'no_answers':
      return {
        title:
          engine === null
            ? say('noAnswersAnyTitle', { days: ctx.days })
            : say('noAnswersTitle', { engine: engine.label, days: ctx.days }),
        reason: say('noAnswersReason'),
      };
  }
}

function errorOf(input: FrameInput, words: FrameWords): ChartError {
  const { read, subject } = input;
  const id = read.errorId;
  return {
    title: words.say('errorTitle', { subject }),
    reason: words.say('errorReason'),
    errorId:
      id === null ? null : { id, label: words.errorId(id), copyLabel: words.copyErrorId, copiedLabel: words.copied },
    onRetry: read.refetch,
    retrying: false,
    retryLabel: words.retry,
  };
}

/** The qualifier of ready data: the last figures read win over a missing comparison. */
function noticeOf(input: FrameInput, say: Say): ChartNotice | undefined {
  if (input.read.stale) return { kind: 'stale', text: say('stale') };
  if (input.previous?.status === 'error') return { kind: 'partial', text: say('partial') };
  if (input.previous !== null && input.previousEmpty) return { kind: 'partial', text: say('previousEmpty') };
  return undefined;
}

/**
 * The frame state of a card. An engine that is not asked is empty before anything else (nothing was read for it);
 * a read that loads is a skeleton, one that failed with nothing to show is an error with its retry; data that says
 * too little is an empty state with its reason; the rest is ready, with a notice when the figures are the last
 * read or the previous period could not be. An idle read of an asked engine is waiting, never empty and never zero.
 */
export function mapReadToFrame(input: FrameInput, words: FrameWords, ctx: FrameContext): FrameState {
  const { engine, read, situation } = input;
  if (engine !== null && engine.availability !== 'asked') {
    return { status: 'empty', empty: engineEmpty(engine, words, ctx) };
  }
  if (read.status === 'loading' || read.status === 'idle') return { status: 'loading' };
  if (read.status === 'error') return { status: 'error', error: errorOf(input, words) };
  if (situation.kind !== 'ready') {
    return { status: 'empty', empty: situationEmpty(situation, engine, words, ctx) };
  }
  return { status: read.status, notice: noticeOf(input, words.say) };
}

/**
 * What a frame tells assistive technology about its figures. The sentence of the figures (`figures`) is for data
 * that is read. An empty, failed or loading frame says nothing here: its own title and reason are on the page and
 * are read there, and "0 prompts" or "of 0 answers" is never read out for what was not asked, read or answered.
 */
export function frameSummary(frame: FrameState, figures: string): string {
  return frame.status === 'ready' || frame.status === 'refetching' ? figures : '';
}

/** `mapReadToFrame` bound to the page:the family's messages, the member's permissions, the links of the project. */
export function useFrameState(input: FrameInput): FrameState {
  const say = useTranslations('aiOverview.competitors.common') as Say;
  const status = useTranslations('status.error');
  const common = useTranslations('common');
  const { workspaceSlug, project, scope, canManageEngines } = useOverview();
  const canEditEntities = useCan('entities:write');
  const words = useMemo(
    (): FrameWords => ({
      say,
      errorId: (id) => status('errorId', { id }),
      copyErrorId: status('copyErrorId'),
      copied: status('copied'),
      retry: common('retry'),
    }),
    [say, status, common],
  );
  const ctx = useMemo(
    (): FrameContext => ({
      enginesHref: projectPath(workspaceSlug, project.slug, '/settings/engines'),
      entitiesHref: projectPath(workspaceSlug, project.slug, '/settings/entities'),
      canManageEngines,
      canEditEntities,
      days: scope.range.days,
    }),
    [workspaceSlug, project.slug, canManageEngines, canEditEntities, scope.range.days],
  );
  return mapReadToFrame(input, words, ctx);
}
