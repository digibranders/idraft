'use client';

import { MessageSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useGap, type BoardEngine, type BoardRead, type TrackedCompetitor } from '../board-reads';
import { GapMark } from '../gaps/gap-mark';
import { markLines } from '../gaps/gap-model';
import {
  BrandLabel,
  DRAWER_ROW,
  DrawerCard,
  DrawerTable,
  PageList,
  type DrawerColumn,
  type DrawerPage,
} from './drawer-parts';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { Inspector } from '@/components/app/inspector/inspector';
import type { InspectorNavigation } from '@/components/app/inspector/inspector-header';
import type { InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { InspectorPanel, InspectorTabs } from '@/components/app/inspector/inspector-tabs';
import { DEFAULT_INSPECTOR_TAB } from '@/components/app/inspector/use-inspector';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import type { EngineCode } from '@/lib/api/types';
import type { BoardScopeParams, CitationGapDetail, CitationGapRow } from '@/lib/citations/board-queries';
import type { SourceScope } from '@/lib/citations/types';
import { formatInteger } from '@/lib/format';

export type GapDrawerTab = 'gap' | 'platforms';

export interface GapDrawerProps {
  project: SourceScope;
  scope: BoardScopeParams;
  /** The selected competitors, in the tracked order. */
  competitors: readonly TrackedCompetitor[];
  ownName: string;
  promptId: string;
  engines: readonly BoardEngine[];
  /** The scope's platform, group and runs label, the header's badges (I 213). */
  scopeParts: readonly string[];
  scopeText: string;
  /** `useInspectorStepping` over the table's order. */
  stepping: {
    positionText: string | null;
    navigation: InspectorNavigation | null;
    onStep: ((direction: 'next' | 'previous') => void) | undefined;
  };
  /** The address's `itab`; `overview` (no tab given) is Gap. */
  tab: string;
  onTabChange: (tab: string) => void;
  onClose: () => void;
  /** Opens the prompt inspector with the gap table's order for J and K (I 269). */
  onOpenAnswers: (promptId: string) => void;
}

type GapRead = BoardRead<CitationGapDetail>;
type PageEntry = CitationGapDetail['competitor_pages'][number];

interface WhoRow {
  id: string;
  name: string;
  own: boolean;
  colorIndex: number | null;
  cell: CitationGapRow['you'];
}

/**
 * The drawer of one gap prompt (I 209 to 331): who is cited, the pages that win it, your closest page and the third
 * parties (Gap); then the same per platform (By platform). A prompt with no answer in the scope is a 404 of the API,
 * and an answer: the body says so.
 */
export function GapDrawer(props: GapDrawerProps): ReactElement {
  const t = useTranslations('citations');
  const ids = useMemo(() => props.competitors.map((competitor) => competitor.id), [props.competitors]);
  const read = useGap(props.project, props.scope, ids, props.promptId);
  const row = read.data?.row;
  const labelOf = (code: string): string => props.engines.find((engine) => engine.code === code)?.label ?? code;
  const tab: GapDrawerTab = props.tab === 'platforms' ? 'platforms' : 'gap';
  const lost =
    row === undefined
      ? null
      : row.gap > 0
        ? t('gapDrawer.lostOn', { engines: row.lost_on.map(labelOf).join(', ') })
        : t('gapDrawer.notLost');
  return (
    <Inspector
      type="gap-prompt"
      header={{
        title: row?.text ?? '',
        typeLabel: t('gapDrawer.type'),
        typeNoun: t('gapDrawer.noun'),
        positionText: props.stepping.positionText,
        navigation: props.stepping.navigation,
        badges:
          row === undefined ? null : (
            <>
              {row.topic === null ? null : <Badge>{row.topic.name}</Badge>}
              {props.scopeParts.map((part) => (
                <Badge key={part}>{part}</Badge>
              ))}
            </>
          ),
        freshness: lost === null ? null : <span>{lost}</span>,
      }}
      backLabel={t('gapDrawer.back')}
      onClose={props.onClose}
      onStep={props.stepping.onStep}
    >
      <InspectorTabs<GapDrawerTab>
        label={t('gapDrawer.tabsLabel')}
        value={tab}
        onValueChange={(next) => props.onTabChange(next === 'gap' ? DEFAULT_INSPECTOR_TAB : next)}
        items={[
          { value: 'gap', label: t('gapDrawer.gapTab') },
          { value: 'platforms', label: t('gapDrawer.platformsTab') },
        ]}
      >
        <InspectorPanel value="gap">
          <Body read={read} scopeText={props.scopeText}>
            <GapCards {...props} read={read} labelOf={labelOf} />
          </Body>
        </InspectorPanel>
        <InspectorPanel value="platforms">
          <Body read={read} scopeText={props.scopeText}>
            <PlatformsCard {...props} read={read} labelOf={labelOf} />
          </Body>
        </InspectorPanel>
      </InspectorTabs>
    </Inspector>
  );
}

/** What stands in for the cards when the read has no prompt to draw: not in this scope, or not loaded. */
function Body({
  read,
  scopeText,
  children,
}: {
  read: GapRead;
  scopeText: string;
  children: ReactElement;
}): ReactElement {
  const t = useTranslations('citations');
  if (read.notFound) {
    return (
      <EmptyState
        variant="card"
        headingLevel={3}
        title={t('gapDrawer.notFoundTitle')}
        reason={t('gapDrawer.notFoundReason', { scope: scopeText })}
      />
    );
  }
  if (read.status === 'error') {
    return (
      <InlineError
        title={t('gapDrawer.loadFailed')}
        reason={t('board.loadFailedReason')}
        errorId={read.errorId}
        onRetry={read.retry}
        retrying={read.retrying}
        retryLabel={t('board.retry')}
      />
    );
  }
  return children;
}

function GapCards({
  read,
  competitors,
  ownName,
  promptId,
  onOpenAnswers,
  labelOf,
}: GapDrawerProps & { read: GapRead; labelOf: (code: string) => string }): ReactElement {
  const t = useTranslations('citations');
  const detail = read.data;
  const row = detail?.row;
  const status: InspectorSectionStatus = read.status === 'loading' ? 'loading' : 'ready';
  const colorOf = (id: string | null): number | null =>
    competitors.find((competitor) => competitor.id === id)?.colorIndex ?? null;
  const nameOf = (id: string | null): string => competitors.find((competitor) => competitor.id === id)?.name ?? '';
  const pagesOf = (
    pages: readonly PageEntry[],
    swatch: (page: PageEntry) => DrawerPage['swatch'],
    note: ((page: PageEntry) => string) | null,
    withEngines: boolean,
  ): DrawerPage[] =>
    pages.map((page) => ({
      urlId: page.url_id,
      url: page.url,
      citations: page.citations,
      swatch: swatch(page),
      ...(note === null ? {} : { note: note(page) }),
      ...(withEngines
        ? {
            engines: page.engines.map((code: EngineCode) => ({ code, label: labelOf(code) })),
            enginesTip: t('gapDrawer.citedOn', { engines: page.engines.map(labelOf).join(', ') }),
          }
        : {}),
      countText: t('gapDrawer.times', { count: page.citations }),
    }));
  const group = row?.topic?.name ?? null;
  const ownHere = (detail?.own_pages.length ?? 0) > 0;
  const closest = (ownHere ? detail?.own_pages : detail?.closest_pages) ?? [];
  const rivalPages = detail?.competitor_pages ?? [];
  const thirdPages = detail?.third_party_pages ?? [];
  const who: WhoRow[] =
    row === undefined
      ? []
      : [
          { id: 'you', name: ownName, own: true, colorIndex: null, cell: row.you },
          ...competitors.flatMap((competitor): WhoRow[] => {
            const cell = row.competitors.find((candidate) => candidate.entity_id === competitor.id);
            return cell === undefined
              ? []
              : [{ id: competitor.id, name: competitor.name, own: false, colorIndex: competitor.colorIndex, cell }];
          }),
        ];
  const whoColumns: DrawerColumn[] = [
    { id: 'brand', label: t('gapDrawer.columnBrand') },
    { id: 'state', label: t('gapDrawer.columnState'), className: 'w-36' },
    { id: 'answers', label: t('gapDrawer.columnAnswers'), className: 'w-20 text-right' },
  ];
  const listStatus = (count: number): InspectorSectionStatus =>
    status === 'loading' ? 'loading' : count === 0 ? 'empty' : 'ready';
  return (
    <>
      <DrawerCard
        title={t('gapDrawer.whoTitle')}
        meta={detail === undefined ? undefined : t('gapDrawer.whoMeta', { count: detail.answers })}
        action={
          <Button variant="secondary" size="sm" icon={MessageSquare} onClick={() => onOpenAnswers(promptId)}>
            {t('gapDrawer.openAnswers')}
          </Button>
        }
        status={status}
        flush
      >
        <DrawerTable caption={t('gapDrawer.whoTitle')} columns={whoColumns}>
          {who.map((entry) => (
            <tr key={entry.id} className={DRAWER_ROW}>
              <td className="min-w-0 pr-2 pl-4">
                <BrandLabel name={entry.name} swatch={{ own: entry.own, colorIndex: entry.colorIndex }} />
              </td>
              <td className="px-2">
                <GapMark
                  state={entry.cell.total.state}
                  own={entry.own}
                  lost={entry.own && (row?.gap ?? 0) > 0}
                  tip={markLines(entry.cell, labelOf, t)}
                />
              </td>
              <td className="px-2 pr-4 text-right num text-foreground-secondary">
                <Tooltip
                  content={t('gapDrawer.answersTip', { k: entry.cell.total.cited, n: entry.cell.total.answers })}
                  purpose="label"
                >
                  <span>
                    {t('gapDrawer.answersCount', {
                      k: formatInteger(entry.cell.total.cited),
                      n: formatInteger(entry.cell.total.answers),
                    })}
                  </span>
                </Tooltip>
              </td>
            </tr>
          ))}
        </DrawerTable>
      </DrawerCard>
      <DrawerCard
        title={t('gapDrawer.rivalsTitle')}
        meta={t('gapDrawer.rivalsMeta')}
        status={listStatus(rivalPages.length)}
        flush
        empty={
          <EmptyState
            variant="card"
            headingLevel={3}
            title={t('gapDrawer.noRivalsTitle')}
            reason={t('gapDrawer.noRivalsReason')}
          />
        }
      >
        <PageList
          pages={pagesOf(
            rivalPages,
            (page) => ({ own: false, colorIndex: colorOf(page.entity_id) }),
            (page) => nameOf(page.entity_id),
            true,
          )}
        />
      </DrawerCard>
      <DrawerCard
        title={t('gapDrawer.closestTitle')}
        meta={t('gapDrawer.closestMeta')}
        status={listStatus(closest.length)}
        flush
        empty={
          <EmptyState
            variant="card"
            headingLevel={3}
            title={group === null ? t('gapDrawer.noClosestNoGroup') : t('gapDrawer.noClosestTitle', { group })}
            reason={t('gapDrawer.noClosestReason')}
          />
        }
      >
        <PageList
          pages={pagesOf(
            closest,
            () => ({ own: true, colorIndex: null }),
            // A prompt with no group has no group to name: no note rather than "Cited for other  prompts"
            ownHere || group !== null
              ? () => (ownHere ? t('gapDrawer.ownHere') : t('gapDrawer.closestNote', { group: group ?? '' }))
              : null,
            false,
          )}
        />
      </DrawerCard>
      <DrawerCard
        title={t('gapDrawer.thirdTitle')}
        meta={t('gapDrawer.thirdMeta')}
        status={listStatus(thirdPages.length)}
        flush
        empty={
          <EmptyState
            variant="card"
            headingLevel={3}
            title={t('gapDrawer.noThirdTitle')}
            reason={t('gapDrawer.noThirdReason')}
          />
        }
      >
        <PageList pages={pagesOf(thirdPages, () => ({ own: false, colorIndex: null }), null, true)} />
      </DrawerCard>
    </>
  );
}

function PlatformsCard({
  read,
  competitors,
  ownName,
  labelOf,
}: GapDrawerProps & { read: GapRead; labelOf: (code: string) => string }): ReactElement {
  const t = useTranslations('citations');
  const row = read.data?.row;
  const columns: DrawerColumn[] = [
    { id: 'platform', label: t('gapDrawer.columnPlatform'), className: 'w-32' },
    { id: 'you', label: ownName, className: 'w-28' },
    ...competitors.map((competitor) => ({ id: competitor.id, label: competitor.name, className: 'w-28' })),
  ];
  return (
    <DrawerCard
      title={t('gapDrawer.platformsTitle')}
      meta={t('gapDrawer.platformsMeta')}
      status={read.status === 'loading' || row === undefined ? 'loading' : 'ready'}
      flush
    >
      {row === undefined ? null : (
        <DrawerTable caption={t('gapDrawer.platformsTitle')} wide columns={columns}>
          {row.you.engines.map((cell) => (
            <tr key={cell.engine_code} className={DRAWER_ROW}>
              <td className="pr-2 pl-4">
                <EngineLogo engine={cell.engine_code} name={labelOf(cell.engine_code)} truncate />
              </td>
              <td className="px-2">
                <GapMark
                  state={cell.state}
                  own
                  lost={row.lost_on.includes(cell.engine_code)}
                  tip={markLines({ engines: [cell] }, labelOf, t)}
                />
              </td>
              {competitors.map((competitor) => {
                const theirs = row.competitors
                  .find((candidate) => candidate.entity_id === competitor.id)
                  ?.engines.find((candidate) => candidate.engine_code === cell.engine_code);
                return (
                  <td key={competitor.id} className="px-2">
                    {theirs === undefined ? null : (
                      <GapMark
                        state={theirs.state}
                        own={false}
                        lost={false}
                        tip={markLines({ engines: [theirs] }, labelOf, t)}
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </DrawerTable>
      )}
    </DrawerCard>
  );
}
