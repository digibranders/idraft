'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useSourceDomains } from './data/source-reads';
import { roleMix, ROLES, type EngineRoleMix } from './model/role-mix';
import { useFrameState, type DataSituation } from './parts/frame-state';
import { metaLine } from './parts/source-meta';
import { engineLabel } from '../engines/engine-role';
import { useCardDensity } from '../engines/use-card-density';
import { useCardExport } from '../engines/use-card-seams';
import type { Say } from '../../numbers/number-model';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import {
  StackedShareBar,
  StackedShareTable,
  stackedShareCsv,
  type ShareColor,
  type ShareRow,
  type ShareSegment,
  type StackedShareBarProps,
} from '@/components/app/chart/stacked-share-bar';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import type { CardProps } from '@/features/layouts';
import type { DomainInclude } from '@/lib/citations/source-queries';
import type { DomainRole } from '@/lib/citations/types';
import type { CsvCell } from '@/lib/csv/csv-write';
import { formatInteger, formatList, formatPercent } from '@/lib/format';
import { MIN_OBSERVATIONS } from '@/lib/stats';

const ROLE_KEY = { own: 'own', competitor: 'competitor', third_party: 'thirdParty' } as const satisfies Record<
  DomainRole,
  string
>;

/** `chart-1` only for the own role: it is the project's own colour, and the other two are categories (DS 15 5.2). */
const ROLE_COLORS: Readonly<Record<DomainRole, ShareColor>> = {
  own: 'chart-1',
  competitor: 'chart-2',
  third_party: 'chart-other',
};

/** The block of `meta` that holds the units of each role on each engine. */
const WITH_ENGINE_SPLIT: readonly DomainInclude[] = ['by_role_by_engine'];

/**
 * CH-16 and WB-OV-07: how the citation units of each engine divide between your own domains, competitors and every
 * other source, as one 100% bar per engine. The engines are separate rows over their own totals and are never added
 * together. An engine with no citation unit is "none" and has no bar: that is not a share of 0%. Beside every percent
 * are its units of the engine's total. Roles only: the categories of the preview (media, review sites, community) need
 * the source intelligence of a later package, so none is drawn here.
 */
export default function RoleShareCard({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.sources.roleShare');
  const say = useTranslations('aiOverview.sources.common') as Say;
  const roleWords = useTranslations('common.domainCell.roles');
  const insufficient = useTranslations('common.insufficient');
  const density = useCardDensity();
  // One row of domains is enough: the split by engine is in `meta`, which no row narrows
  const reads = useSourceDomains({ limit: 1, include: WITH_ENGINE_SPLIT, subscribed: live });
  const page = reads.current.data;
  const mixes = page === undefined ? [] : roleMix(page.meta);

  const situation = ((): DataSituation => {
    if (reads.askable !== 'ok') return { kind: reads.askable };
    if (page === undefined) return { kind: 'ready' };
    if (page.meta.answers === 0) return { kind: 'no_answers' };
    return page.meta.citation_units === 0 ? { kind: 'no_citations', answers: page.meta.answers } : { kind: 'ready' };
  })();
  const frame = useFrameState({
    subject: t('subject'),
    read: reads.current,
    previous: null,
    previousEmpty: false,
    situation,
  });

  const roleName = (role: DomainRole): string => roleWords(ROLE_KEY[role]);
  const engineName = (mix: EngineRoleMix): string => engineLabel(mix.engineCode) ?? mix.engineCode;
  const segments: ShareSegment[] = ROLES.map((role) => ({ id: role, name: roleName(role), color: ROLE_COLORS[role] }));

  const rowOf = (mix: EngineRoleMix): ShareRow => {
    const base = {
      id: mix.engineCode,
      label: engineName(mix),
      // The mark alone: the label carries the name
      icon: <EngineLogo engine={mix.engineCode} name="" />,
    };
    // The shared bar has no thin form that can say units, so a thin engine is worded here: answers at most, units known
    if (mix.state === 'thin') {
      const text = t('thinText', { answers: mix.answers, units: mix.total });
      return { ...base, denominatorText: '', value: { kind: 'none', text } };
    }
    if (mix.state === 'none') return { ...base, denominatorText: '', value: { kind: 'none', text: t('noUnits') } };
    if (mix.state === 'unavailable') {
      return { ...base, denominatorText: '', value: { kind: 'none', text: t('splitUnavailable') } };
    }
    return {
      ...base,
      denominatorText: t('denominator', { units: mix.total }),
      value: {
        kind: 'shares',
        cells: mix.shares.map((entry) => ({
          segmentId: entry.role,
          share: entry.share,
          shareText: formatPercent(entry.share),
          countText: t('counts', { units: formatInteger(entry.units), total: mix.total }),
        })),
      },
    };
  };

  const bar = (patterns: boolean): StackedShareBarProps => ({
    caption: t('caption'),
    segments,
    rows: mixes.map(rowOf),
    segmentHeader: t('segmentHeader'),
    patterns,
    density,
  });

  const summary = [
    t('summaryIntro'),
    ...mixes.map((mix) => {
      const engine = engineName(mix);
      if (mix.state === 'none') return t('summaryNone', { engine });
      if (mix.state === 'thin') return t('summaryThin', { engine, answers: mix.answers, units: mix.total });
      if (mix.state === 'unavailable') return t('summaryUnavailable', { engine });
      const parts = formatList(
        mix.shares.map((entry) => t('summaryPart', { name: roleName(entry.role), share: formatPercent(entry.share) })),
      );
      return t('summaryEngine', { engine, parts });
    }),
  ].join(' ');

  useCardExport(item.id, () => {
    if (frame.status === 'loading' || frame.status === 'error') return null;
    const rows = mixes.flatMap((mix): CsvCell[][] =>
      ROLES.map((role): CsvCell[] => {
        const label = engineName(mix);
        if (mix.state === 'thin') return [label, roleName(role), null, null, mix.total, mix.state];
        if (mix.state !== 'ok') return [label, roleName(role), null, null, null, mix.state];
        const entry = mix.shares.find((share) => share.role === role);
        // An unknown is an empty cell, never 0
        return entry === undefined
          ? [label, roleName(role), null, null, mix.total, mix.state]
          : [label, roleName(role), formatPercent(entry.share), entry.units, mix.total, mix.state];
      }),
    );
    return {
      id: item.id,
      header: [
        t('engineHeader'),
        t('roleHeader'),
        t('shareHeader'),
        t('unitsHeader'),
        t('totalHeader'),
        t('statusHeader'),
      ],
      rows,
    };
  });

  const shown = frame.status === 'ready' || frame.status === 'refetching';
  const flagged = say('footnoteFlagged');
  return (
    <ChartFrame
      kind="html"
      variant="panel"
      height={180}
      title={t('title')}
      meta={page === undefined || !shown ? null : metaLine(page.meta, say)}
      summary={summary}
      footnote={
        <div className="flex flex-col gap-1">
          <p>{t('footnoteSplit')}</p>
          <p>{t('footnoteRoles')}</p>
          <p>{t('footnoteThin', { min: MIN_OBSERVATIONS })}</p>
          <p>{flagged}</p>
        </div>
      }
      patterns
      menu={{
        fileName: t('fileName'),
        csv: stackedShareCsv(bar(false), (answers) => insufficient('answers', { count: answers })),
      }}
      body={({ patterns }) => <StackedShareBar {...bar(patterns)} />}
      table={<StackedShareTable {...bar(false)} />}
      {...frame}
    />
  );
}
