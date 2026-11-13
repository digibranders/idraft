'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactElement, type ReactNode } from 'react';

import { CARD_HEIGHT, type TopicCardKey } from './card-heights';
import type { TopicData } from './model-types';
import { drillHref } from '../../drilldown/drill-links';
import type { ExportBlock } from '../../export/export-model';
import { useExportBlock } from '../../export/export-registry';
import { useOverview } from '../../overview-context';
import type { LegendItem } from '@/components/app/chart/chart-legend';
import {
  ChartFrame,
  type ChartEmpty,
  type ChartError,
  type ChartNotice,
  type HtmlChartMenu,
} from '@/components/app/chart/chart-frame';
import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';
import { TextLink } from '@/components/ui/text-link';
import { formatList } from '@/lib/format';
import { projectPath } from '@/lib/routes/paths';

/**
 * The frame every card of the topics family stands in (WP-36 plan 2.6): one rule set for the honest states, so a
 * card writes only its body. `ChartFrame` draws loading, empty, error and refetching at the card's height; this
 * file decides which of them a read is in, adds the stale and partial notices, and words the empty and error states.
 */

export type CardPhase =
  | { status: 'loading' | 'ready' | 'refetching' }
  | { status: 'empty'; empty: ChartEmpty }
  | { status: 'error'; error: ChartError };

/** An empty state of a card always has its one action: the person must never meet a dead end. */
export interface TopicEmpty extends ChartEmpty {
  action: ReactNode;
}

/** The words `phaseOf` needs, already translated, so it stays a pure function. */
export interface PhaseWords {
  errorTitle: string;
  errorReason: string;
  retryLabel: string;
  errorId: (id: string) => { id: string; label: string; copyLabel: string; copiedLabel: string };
  /** The notice of a read that failed to refresh. */
  stale: string;
}

interface PhaseInput {
  data: Pick<TopicData, 'phase' | 'stale' | 'errorId' | 'retry' | 'settled'>;
  /** What the card says when it has nothing to show; `null` when it has rows. Idle supplies its own. */
  empty: ChartEmpty | null;
  words: PhaseWords;
}

/**
 * Which state the frame is in. A read still arriving is loading; one that failed with nothing to show is an error;
 * nothing asked (idle) and a read with nothing in it are empty; a refetch, or a window that is not settled, keeps
 * the body and says it is updating. Figures kept after a failed refresh carry the stale notice.
 */
export function phaseOf({ data, empty, words }: PhaseInput): { phase: CardPhase; notice: ChartNotice | undefined } {
  const { phase } = data;
  if (phase === 'error') {
    const error: ChartError = {
      title: words.errorTitle,
      reason: words.errorReason,
      errorId: data.errorId === null ? null : words.errorId(data.errorId),
      onRetry: data.retry,
      retrying: false,
      retryLabel: words.retryLabel,
    };
    return { phase: { status: 'error', error }, notice: undefined };
  }
  if (phase === 'loading') return { phase: { status: 'loading' }, notice: undefined };
  if (phase === 'idle') {
    // Without its words an idle card would be a blank box, so it reads as still loading
    return { phase: empty === null ? { status: 'loading' } : { status: 'empty', empty }, notice: undefined };
  }
  const notice: ChartNotice | undefined = data.stale ? { kind: 'stale', text: words.stale } : undefined;
  if (empty !== null) return { phase: { status: 'empty', empty }, notice };
  return { phase: { status: phase === 'refetching' || !data.settled ? 'refetching' : 'ready' }, notice };
}

/** The where and the how of the Topics and prompts page: the scope is carried, and the page always opens. */
function useTopicsLink(): Route {
  const { workspaceSlug, project, scope } = useOverview();
  return (
    drillHref('topic', scope, {}, { workspace: workspaceSlug, project: project.slug }) ??
    projectPath(workspaceSlug, project.slug, '/ai/prompts')
  );
}

export interface TopicEmpties {
  /** No topic: group prompts, or clear the topic filter when that is what emptied the card. */
  noTopics: TopicEmpty;
  /** The asked engines have no valid answer in the window. */
  noAnswers: (engineLabels: readonly string[], days: number) => TopicEmpty;
}

/** The empty states a card chooses between, with the words and the one action of each. */
export function useTopicEmpty(): TopicEmpties {
  const t = useTranslations('aiOverview.topics.common');
  const { scope, setScope } = useOverview();
  const href = useTopicsLink();
  const open = (
    <LinkButton variant="secondary" size="sm" render={<Link href={href} />}>
      {t('openTopics')}
    </LinkButton>
  );
  const filtered = scope.topic !== null;
  return {
    noTopics: {
      title: t('emptyNoTopicsTitle'),
      reason: filtered ? t('emptyNoTopicsFilteredReason') : t('emptyNoTopicsReason'),
      action: filtered ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setScope({ topic: null });
          }}
        >
          {t('clearTopic')}
        </Button>
      ) : (
        open
      ),
    },
    noAnswers: (engineLabels, days) => ({
      title: t('emptyNoAnswersTitle', { days, engines: formatList(engineLabels) }),
      reason: t('emptyNoAnswersReason'),
      action: open,
    }),
  };
}

/** The idle state: no engine is part of the view, why, and the one thing the person can do about it. */
function useIdleEmpty(): TopicEmpty {
  const t = useTranslations('aiOverview.topics.common');
  const { scope, setScope, enabledEngines, canManageEngines, workspaceSlug, project } = useOverview();
  const title = t('emptyNoEngineTitle');
  // Engines are on but the filter leaves them all out: the filter is the cause and clearing it is the way out
  if (enabledEngines.length > 0 && scope.engines !== null) {
    return {
      title,
      reason: t('emptyNoEngineFiltered'),
      action: (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setScope({ engines: null });
          }}
        >
          {t('useAllEngines')}
        </Button>
      ),
    };
  }
  if (canManageEngines) {
    return {
      title,
      reason: t('emptyNoEngineOff'),
      action: (
        <LinkButton
          variant="secondary"
          size="sm"
          render={<Link href={projectPath(workspaceSlug, project.slug, '/settings/engines')} />}
        >
          {t('turnOnEngines')}
        </LinkButton>
      ),
    };
  }
  // A member who cannot turn engines on is told whom to ask: there is no button to give
  return { title, reason: t('emptyNoEngineAdmin'), action: null };
}

export interface TopicExport {
  /** The layout item id of this card instance (`CardProps.item.id`), not the catalog key. */
  id: string;
  /**
   * The card's table now, in its own columns. An unknown value is an empty cell with a status in its own column,
   * never 0. Called only when the Export menu reads, and only while the card is not loading or failed.
   */
  build: () => ExportBlock | null;
}

export interface TopicCardFrameProps {
  cardKey: TopicCardKey;
  title: string;
  meta: string | null;
  /** What the card shows, in one or two sentences, for people who cannot see it. */
  summary: string;
  data: TopicData;
  /** What the card says when the read holds nothing to draw; `null` when it has rows. */
  empty: TopicEmpty | null;
  /** The labels of asked engines that have no valid answer in any row: named in a notice, never left out silently. */
  partialEngines: readonly string[];
  footnote: ReactNode;
  body: ReactNode;
  /** The Table view of the same numbers. */
  table: ReactNode;
  controls?: ReactNode;
  legend?: readonly LegendItem[] | undefined;
  menu?: HtmlChartMenu | undefined;
  /** Tells the page's Export menu what this card's table holds (WP-33 `useExportBlock`). */
  exportBlock?: TopicExport | undefined;
  /** A link under the body ("Show all 12 topics"); left out or `null` for none. */
  link?: { href: Route; label: string } | null | undefined;
}

/** Registers the card's block while the card is mounted; renders nothing. */
function ExportRegistration({ exportBlock, ready }: { exportBlock: TopicExport; ready: boolean }): null {
  useExportBlock(exportBlock.id, () => (ready ? exportBlock.build() : null));
  return null;
}

/** `ChartFrame` for a topics card, with its honest states, notices, footer link and export block. */
export function TopicCardFrame({
  cardKey,
  title,
  meta,
  summary,
  data,
  empty,
  partialEngines,
  footnote,
  body,
  table,
  controls,
  legend,
  menu,
  exportBlock,
  link,
}: TopicCardFrameProps): ReactElement {
  const t = useTranslations('aiOverview.topics.common');
  const common = useTranslations('common');
  const status = useTranslations('status.error');
  const idle = useIdleEmpty();
  const { phase, notice: kept } = phaseOf({
    data,
    empty: data.phase === 'idle' ? idle : empty,
    words: {
      errorTitle: t('errorTitle', { title }),
      errorReason: t('errorReason'),
      retryLabel: common('retry'),
      errorId: (id) => ({
        id,
        label: status('errorId', { id }),
        copyLabel: status('copyErrorId'),
        copiedLabel: status('copied'),
      }),
      stale: t('staleNotice'),
    },
  });
  const shows = phase.status === 'ready' || phase.status === 'refetching';
  // One notice fits the meta line: the older figures matter more than a missing engine
  const notice: ChartNotice | undefined =
    kept ??
    (shows && partialEngines.length > 0
      ? {
          kind: 'partial',
          text: t('partialNotice', { engines: formatList(partialEngines), count: partialEngines.length }),
        }
      : undefined);
  return (
    <>
      <ChartFrame
        kind="html"
        variant="panel"
        title={title}
        meta={meta}
        notice={notice}
        footnote={footnote}
        controls={controls}
        height={CARD_HEIGHT[cardKey]}
        summary={summary}
        legend={legend}
        menu={menu}
        table={table}
        body={
          <>
            {body}
            {link === null || link === undefined ? null : (
              <div className="mt-3">
                <TextLink render={<Link href={link.href} />}>{link.label}</TextLink>
              </div>
            )}
          </>
        }
        {...phase}
      />
      {exportBlock === undefined ? null : (
        <ExportRegistration exportBlock={exportBlock} ready={phase.status !== 'loading' && phase.status !== 'error'} />
      )}
    </>
  );
}
