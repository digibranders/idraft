'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactNode } from 'react';

import { MIN_DOMAIN_UNITS } from '../data/source-filters';
import type { Read } from '../../../data/read-state';
import { useCardDrill } from '../../engines/use-card-seams';
import type { Say } from '../../../numbers/number-model';
import { useOverview } from '../../../overview-context';
import type { ChartEmpty, ChartError, ChartNotice } from '@/components/app/chart/chart-frame';
import { TextLink } from '@/components/ui/text-link';
import { projectPath } from '@/lib/routes/paths';

/**
 * The one mapping from what a sources card has read to what its `ChartFrame` shows (WP-37 plan D8): the card says
 * which situation its data is in and spreads the result into the frame (`status`, `notice`, `empty`, `error`), so no
 * card words these states itself. Same shape as the competitors family, with the words of `aiOverview.sources.common`.
 */

/** What the frame needs of a read: its status, the error id, whether the data is the last one read, and a retry. */
export type ReadFacts = Pick<Read<unknown>, 'status' | 'errorId' | 'stale' | 'refetch'>;

/**
 * Where the data stands. `no_engine` and `branded_only` are facts of the scope, known before anything is read.
 * - `no_answers`: the window has no valid answer.
 * - `no_citations`: answers were collected (`answers`), and none cited a source.
 * - `none_listed`: units were cited, and no row reaches the minimum or the role asked for.
 * - `no_own_pages`: sources were cited, and none of them is a page of the project (CH-08).
 * - `no_fanout`: no engine in scope shows the queries it issues (`engines` names them): a fact of the scope (CH-17).
 * - `none_issued`: answers were collected (`answers`), and none ran a search (CH-17).
 * - `queries_under_min`: answers ran searches, and no search was run by `min` answers (CH-17).
 * - `no_weekly_units`: no week of the window holds a citation unit on any engine asked (CH-26).
 */
export type DataSituation =
  | { kind: 'ready' }
  | { kind: 'no_engine' }
  | { kind: 'branded_only' }
  | { kind: 'no_answers' }
  | { kind: 'no_citations'; answers: number }
  | { kind: 'none_listed' }
  | { kind: 'no_own_pages' }
  | { kind: 'no_fanout'; engines: string }
  | { kind: 'none_issued'; answers: number }
  | { kind: 'queries_under_min'; min: number }
  | { kind: 'no_weekly_units' };

export interface FrameInput {
  /** What the card shows, in lower case, for "Could not load top cited domains". */
  subject: string;
  read: ReadFacts;
  /** The window before's read; `null` when it is not asked. */
  previous: ReadFacts | null;
  /** The window before was read and has no answer: the rows have no changes to show. */
  previousEmpty: boolean;
  situation: DataSituation;
}

export type FrameState = (
  | { status: 'loading' | 'ready' | 'refetching'; empty?: undefined; error?: undefined }
  | { status: 'empty'; empty: ChartEmpty; error?: undefined }
  | { status: 'error'; error: ChartError; empty?: undefined }
) & { notice?: ChartNotice | undefined };

/** The messages of `aiOverview.sources.common`, and the words of an error id and its retry. */
export interface FrameWords {
  say: Say;
  errorId: (id: string) => string;
  copyErrorId: string;
  copied: string;
  retry: string;
}

export interface FrameContext {
  enginesHref: Route;
  /** May turn engines on (`projects:write`). */
  canManageEngines: boolean;
  /** The days of the window, for "No valid answers in these 28 days". */
  days: number;
  /** The fewest citation units a row is listed for. */
  minUnits: number;
  /** The Prompts page with the scope, for the empty state of the own pages; `null` where it cannot show the scope. */
  promptsHref?: Route | null | undefined;
}

const link = (href: Route, label: string): ReactNode => <TextLink render={<Link href={href} />}>{label}</TextLink>;

function noEngine({ say }: FrameWords, ctx: FrameContext): ChartEmpty {
  const title = say('noEngineTitle');
  if (ctx.canManageEngines) {
    return { title, reason: say('noEngineReason'), action: link(ctx.enginesHref, say('toEngines')) };
  }
  return { title, reason: `${say('noEngineReason')} ${say('askAdmin')}` };
}

function emptyOf(
  situation: Exclude<DataSituation, { kind: 'ready' }>,
  words: FrameWords,
  ctx: FrameContext,
): ChartEmpty {
  const { say } = words;
  switch (situation.kind) {
    case 'no_engine':
      return noEngine(words, ctx);
    case 'branded_only':
      return { title: say('brandedOnlyTitle'), reason: say('brandedOnlyReason') };
    case 'no_answers':
      return { title: say('noAnswersTitle', { days: ctx.days }), reason: say('noAnswersReason') };
    case 'no_citations':
      return { title: say('noCitationsTitle'), reason: say('noCitationsReason', { answers: situation.answers }) };
    case 'none_listed':
      return { title: say('noneListedTitle', { min: ctx.minUnits }), reason: say('noneListedReason') };
    case 'no_own_pages': {
      const reason = say('noOwnPagesReason');
      return ctx.promptsHref === null || ctx.promptsHref === undefined
        ? { title: say('noOwnPagesTitle'), reason }
        : { title: say('noOwnPagesTitle'), reason, action: link(ctx.promptsHref, say('toPrompts')) };
    }
    case 'no_fanout':
      return { title: say('noFanoutTitle', { engines: situation.engines }), reason: say('noFanoutReason') };
    case 'none_issued':
      return { title: say('noneIssuedTitle'), reason: say('noneIssuedReason', { answers: situation.answers }) };
    case 'queries_under_min':
      return { title: say('queriesUnderMinTitle', { min: situation.min }), reason: say('queriesUnderMinReason') };
    case 'no_weekly_units':
      return { title: say('noWeeklyUnitsTitle'), reason: say('noWeeklyUnitsReason') };
  }
}

function errorOf({ read, subject }: FrameInput, words: FrameWords): ChartError {
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
  if (input.previousEmpty) return { kind: 'partial', text: say('previousEmpty') };
  return undefined;
}

/**
 * The frame state of a card. A scope the reads cannot answer is empty before anything else (nothing was read, and
 * nothing is drawn as 0); a read that loads is a skeleton, one that failed with nothing to show is an error with its
 * retry; data that says too little is an empty state with its reason; the rest is ready, with a notice when the
 * figures are the last read or the comparison is missing.
 */
export function mapReadToFrame(input: FrameInput, words: FrameWords, ctx: FrameContext): FrameState {
  const { read, situation } = input;
  if (situation.kind === 'no_engine' || situation.kind === 'branded_only' || situation.kind === 'no_fanout') {
    return { status: 'empty', empty: emptyOf(situation, words, ctx) };
  }
  if (read.status === 'loading' || read.status === 'idle') return { status: 'loading' };
  if (read.status === 'error') return { status: 'error', error: errorOf(input, words) };
  if (situation.kind !== 'ready') return { status: 'empty', empty: emptyOf(situation, words, ctx) };
  return { status: read.status, notice: noticeOf(input, words.say) };
}

/** `mapReadToFrame` bound to the page: the family's messages, the member's permissions, the links of the project. */
export function useFrameState(input: FrameInput): FrameState {
  const say = useTranslations('aiOverview.sources.common') as Say;
  const status = useTranslations('status.error');
  const common = useTranslations('common');
  const { workspaceSlug, project, scope, canManageEngines } = useOverview();
  const drill = useCardDrill();
  const promptsHref = drill('prompts');
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
      canManageEngines,
      days: scope.range.days,
      minUnits: MIN_DOMAIN_UNITS,
      promptsHref,
    }),
    [workspaceSlug, project.slug, canManageEngines, scope.range.days, promptsHref],
  );
  return mapReadToFrame(input, words, ctx);
}
