'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useAiRuns } from '../activity/data/activity-reads';
import { useCardData } from '../engines/use-card-data';
import { useCardExport } from '../engines/use-card-seams';
import { useFrameState } from '../engines/use-frame-state';
import { HeadlineSkeleton } from './headline-skeleton';
import {
  buildHero,
  readFactTile,
  readTile,
  runsInWindow,
  sparkOf,
  SEGMENTS,
  type CellTile,
  type FactTile,
  type Hero,
  type Platforms,
  type Reading,
} from './headline-model';
import { describeReading, type Described, type Say, type Words } from './headline-words';
import { Sparkline, SplitBar, Tile } from './parts';
import { useInfoOf } from './use-card-info';
import { useOverviewSummary as readSummary } from '../../data/use-overview-reads';
import type { ExportBlock } from '../../export/export-model';
import { useOverview } from '../../overview-context';
import { chosenGroup, groupChoices } from '../../scope/group-options';
import { singlePlatform } from '../../scope/scope-model';
import { useTopicTree } from '../../scope/use-topic-tree';
import { useScopeUnavailable } from '../../states/scope-unavailable';
import { CardInfoButton } from '@/components/app/chart/card-info';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { Tooltip } from '@/components/ui/tooltip';
import type { CardProps } from '@/features/layouts';
import type { CsvCell } from '@/lib/csv/csv-write';
import { formatDecimal, formatInteger, formatList, formatPercent, formatTableDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The tiles in the order of the card (OV-HEAD-08). */
const TILES = ['mention', 'sov', 'citation', 'position', 'recommendation', 'sentiment', 'prompts', 'runs'] as const;
type TileKey = (typeof TILES)[number];

const CELL_TILES: readonly CellTile[] = ['mention', 'sov', 'citation'];
const isCellTile = (key: TileKey): key is CellTile => key === 'mention' || key === 'sov' || key === 'citation';
/**
 * Position, recommendation and sentiment are read from the facts of the prompt rows, as their cards are (R12). Where
 * the API sends no facts the tile says "Not collected yet" (OV-NOPORT-04), and never draws a sample.
 */
const isFactTile = (key: TileKey): key is FactTile =>
  key === 'position' || key === 'recommendation' || key === 'sentiment';

const EXPORT_HEADER = ['measure', 'value_percent', 'k', 'n', 'status'] as const;
const RUNS_LIMIT = 200;
/** The platforms the product names, by API code: the words are in the catalog (`aiOverview.headline.platforms`). */
const PLATFORM_NAMES = { chatgpt_web: 'chatgptWeb', gemini_web: 'geminiWeb', google_ai_mode: 'googleAiMode' } as const;
/** The key of each outcome in the catalog (`aiOverview.headline.segments`). */
const SEGMENT_KEYS = {
  mentioned_and_cited: 'mentionedAndCited',
  mentioned_only: 'mentionedOnly',
  cited_only: 'citedOnly',
  neither: 'neither',
} as const;
/** A figure with its counts in a tooltip is a tab stop that opens it (DS 20 section 6.2 rule 6). */
const TAB_STOP = { tabIndex: 0 } as const;
const percent = (ratio: number): string => formatPercent(ratio, { decimals: 0 });

interface TileModel {
  reading: Reading;
  baseline: Reading | null;
  spark: (number | null)[] | null;
}

interface Model {
  hero: Hero;
  /** The weekly visibility, 8 weeks at most; `null` with fewer than two points. */
  heroSpark: (number | null)[] | null;
  baselineHero: Reading | null;
  tiles: Readonly<Record<CellTile, TileModel>>;
  facts: Readonly<Record<FactTile, Reading>>;
}

/** The figure of a reading for a file: a percent number, or nothing for a figure that is not there (never a 0). */
function exportRow(measure: string, reading: Reading): CsvCell[] {
  if (reading.state === 'ok') {
    const counts = reading.basis.kind === 'counts' ? reading.basis : null;
    return [measure, Math.round(reading.value * 10000) / 100, counts?.k ?? null, counts?.n ?? null, 'ok'];
  }
  return [measure, null, null, reading.state === 'insufficient' ? reading.n : null, reading.state];
}

/**
 * AI visibility and the numbers beside it (`ai.visibility_split`, parity register OV-HEAD): the hero with the four
 * outcomes of an answer, and eight tiles. It stays in its place whatever the scope is; a figure that has nothing for
 * the scope says why in its own tile, and a scope with no platform says it in the card (the unavailable contract).
 */
export default function HeadlineCard({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.headline');
  const common = useTranslations('aiOverview.engines.common');
  const shell = useTranslations('aiOverview.shell');
  const { workspaceId, project, scope, enabledEngines } = useOverview();
  const data = useCardData({ previous: 'none', include: ['facts', 'series'], counts: true, subscribed: live });
  const infoOf = useInfoOf();
  const unavailable = useScopeUnavailable(t('label'));
  const { tree } = useTopicTree();
  const runs = useAiRuns({ subscribed: live, limit: RUNS_LIMIT });

  // The project value of a chosen group is the same read without the group; with no group no engine is named, so no read
  const baselineInput = useMemo(
    () => ({
      project: { workspaceId, projectId: project.id },
      scope: { ...scope, topic: null, compare: false },
      enabledEngines: scope.topic === null ? [] : enabledEngines,
    }),
    [workspaceId, project.id, scope, enabledEngines],
  );
  const baselineRead = readSummary(baselineInput, { subscribed: live });

  const platform = singlePlatform(scope);
  const single = data.asked.find((code) => code === platform) ?? null;
  const platforms: Platforms = useMemo(() => ({ asked: data.asked, single }), [data.asked, single]);
  const summary = data.current.data;
  const promptCount = data.aggregates?.promptCount ?? null;
  const baselineSummary = scope.topic === null ? undefined : baselineRead.data;
  const baselinePrompts = baselineSummary?.prompts;

  const model = useMemo((): Model | null => {
    if (summary === undefined || data.aggregates?.rowsRead !== true) return null;
    const tileOf = (tile: CellTile): TileModel => ({
      reading: readTile(summary, platforms, tile),
      baseline: baselineSummary === undefined ? null : readTile(baselineSummary, platforms, tile),
      spark: sparkOf(summary, platforms, tile),
    });
    return {
      hero: buildHero(summary.prompts, platforms, promptCount),
      heroSpark: sparkOf(summary, platforms, 'visibility'),
      baselineHero: baselinePrompts === undefined ? null : buildHero(baselinePrompts, platforms, null).reading,
      tiles: { mention: tileOf('mention'), sov: tileOf('sov'), citation: tileOf('citation') },
      facts: {
        position: readFactTile(summary.prompts, platforms, 'position'),
        recommendation: readFactTile(summary.prompts, platforms, 'recommendation'),
        sentiment: readFactTile(summary.prompts, platforms, 'sentiment'),
      },
    };
  }, [summary, data.aggregates?.rowsRead, baselineSummary, baselinePrompts, platforms, promptCount]);

  const words: Words = useMemo(
    () => ({
      // The words are looked up by key, as the number words of the other cards are
      say: t as Say,
      nameOf: (code) =>
        code in PLATFORM_NAMES
          ? t(`platforms.${PLATFORM_NAMES[code as keyof typeof PLATFORM_NAMES]}`)
          : common('unknownEngine'),
      list: formatList,
      formatValue: percent,
    }),
    [t, common],
  );

  // Nothing to count: no platform asked (the scope names one that is off, or none is on), or no prompt in the scope
  const empty =
    data.asked.length > 0
      ? { title: t('emptyNoPromptsTitle'), reason: t('emptyNoPromptsReason') }
      : platform === null
        ? { title: t('emptyNoEnginesTitle'), reason: t('emptyNoEnginesReason') }
        : unavailable;
  const frame = useFrameState(
    { ...data, phase: data.phase === 'ready' && promptCount === 0 ? 'empty' : data.phase },
    { name: t('label'), empty },
  );

  useCardExport(item.id, (): ExportBlock | null => {
    if (model === null) return null;
    const rows = [
      exportRow(t('hero'), model.hero.reading),
      ...CELL_TILES.map((tile) => exportRow(t(`tiles.${tile}`), model.tiles[tile].reading)),
    ];
    return { id: item.id, header: EXPORT_HEADER, rows };
  });

  if (frame.status === 'error' || frame.status === 'empty') {
    return (
      <ChartFrame
        kind="html"
        variant="panel"
        title={t('label')}
        height={180}
        summary={frame.status === 'empty' ? frame.empty.reason : frame.error.reason}
        body={null}
        table={null}
        {...frame}
      />
    );
  }
  if (frame.status === 'loading' || model === null) return <HeadlineSkeleton />;

  const { hero } = model;
  const heroFace = describeReading(hero.reading, words);
  const heroTip = [
    heroFace.tip,
    hero.reading.state === 'ok' && hero.prompts !== null ? t('tips.prompts', { count: hero.prompts }) : null,
  ]
    .filter((part): part is string => part !== null)
    .join('. ');
  const projectValue =
    scope.topic !== null && hero.reading.state === 'ok' && model.baselineHero?.state === 'ok'
      ? t('allGroups', { value: percent(model.baselineHero.value) })
      : '';

  const runsFace = ((): { face: Described; loading: boolean } => {
    if (!data.canViewRuns) return { face: describeReading({ state: 'noAccess' }, words), loading: false };
    if (runs.status === 'loading') return { face: describeReading({ state: 'none' }, words), loading: true };
    if (runs.data === undefined) return { face: describeReading({ state: 'notCollected' }, words), loading: false };
    const found = runsInWindow(runs.data, scope.range, project.timeZone);
    const tip =
      found.last === null
        ? t('tips.runsNone')
        : t('tips.runs', { count: found.count, when: formatTableDateTime(found.last, project.timeZone) });
    return { face: { value: formatInteger(found.count), tip, note: null, known: true }, loading: false };
  })();

  const groupName = chosenGroup(groupChoices(tree, shell('allGroups')), scope.topic, shell('groupUnknown')).label;
  const promptsFace = (): Described => {
    const kind = t(
      scope.branded === 'only'
        ? 'tips.promptsBranded'
        : scope.branded === 'included'
          ? 'tips.promptsCoreAndBranded'
          : 'tips.promptsCore',
    );
    const where = scope.topic === null ? kind : t('tips.promptsIn', { kind, group: groupName });
    const tip =
      single === null || hero.prompts === null
        ? where
        : t('tips.promptsAnswered', { where, count: hero.prompts, platform: words.nameOf(single) });
    return {
      value: promptCount === null ? t('notAvailable') : formatInteger(promptCount),
      tip,
      note: null,
      known: promptCount !== null,
    };
  };

  const faceOf = (
    key: TileKey,
  ): { face: Described; baseline: Reading | null; spark: ReactElement | null; loading: boolean } => {
    if (isCellTile(key)) {
      const entry = model.tiles[key];
      const spark = entry.spark === null ? null : <Sparkline points={entry.spark} height={22} />;
      return { face: describeReading(entry.reading, words), baseline: entry.baseline, spark, loading: false };
    }
    if (isFactTile(key)) {
      // A mean position has one decimal and no unit (OV-HEAD-11); the rates are whole percents
      const factWords =
        key === 'position' ? { ...words, formatValue: (value: number) => formatDecimal(value, 1) } : words;
      return { face: describeReading(model.facts[key], factWords), baseline: null, spark: null, loading: false };
    }
    if (key === 'runs') return { ...runsFace, baseline: null, spark: null };
    return { face: promptsFace(), baseline: null, spark: null, loading: false };
  };

  const splitLabel = (): string =>
    hero.split === null
      ? t('tooFew')
      : SEGMENTS.map(
          (segment) => `${t(`segments.${SEGMENT_KEYS[segment]}`)} ${percent(hero.split?.shares[segment] ?? 0)}`,
        ).join(', ');

  return (
    <div
      role="group"
      aria-label={t('label')}
      data-card="ai.visibility_split"
      aria-busy={frame.status === 'refetching' || undefined}
      className="grid grid-cols-1 gap-4 xl:grid-cols-12"
    >
      <section
        aria-label={t('hero')}
        className="flex min-w-0 flex-col justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-4 xl:col-span-4"
      >
        <div className="-my-1 flex items-center justify-between gap-2">
          <h2 className="type-section-title">{t('hero')}</h2>
          <CardInfoButton title={t('hero')} info={infoOf('hero')} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            {heroTip === '' ? (
              <span className="num type-metric text-foreground-tertiary">{heroFace.value}</span>
            ) : (
              <Tooltip content={heroTip} purpose="label">
                <span
                  {...TAB_STOP}
                  className={cn('num type-metric', heroFace.known ? 'text-foreground' : 'text-foreground-tertiary')}
                >
                  {heroFace.value}
                  {/* The counts are read with the value, as the preview does (OV-HEAD-03), not only on hover */}
                  <span className="sr-only">, {heroTip}</span>
                </span>
              </Tooltip>
            )}
            <span className="block min-h-4 num type-micro text-foreground-tertiary">{projectValue}</span>
          </div>
          {model.heroSpark === null || !heroFace.known ? null : (
            <div className="w-28 shrink-0">
              <Sparkline
                points={model.heroSpark}
                height={32}
                label={t('spark', { name: t('hero'), count: model.heroSpark.length, value: heroFace.value })}
              />
            </div>
          )}
        </div>
        {hero.split === null ? (
          <span className="inline-flex h-6 w-fit items-center rounded-xs bg-insufficient px-1.5 type-label whitespace-nowrap text-foreground-tertiary">
            {t('tooFew')}
          </span>
        ) : (
          <SplitBar
            split={hero.split}
            label={splitLabel()}
            nameOf={(segment) => t(`segments.${SEGMENT_KEYS[segment]}`)}
            percent={percent}
            tipOf={(segment) => {
              const name = t(`segments.${SEGMENT_KEYS[segment]}`);
              const share = percent(hero.split?.shares[segment] ?? 0);
              const counts = hero.split?.counts;
              return counts === null || counts === undefined || hero.split?.answers == null
                ? t('tips.segment', { name, share })
                : t('tips.segmentCounts', { name, share, k: counts[segment], total: hero.split.answers });
            }}
          />
        )}
      </section>
      <section
        aria-label={t('keyNumbers')}
        className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4 xl:col-span-8"
      >
        {TILES.map((key) => {
          const { face, baseline, spark, loading } = faceOf(key);
          const base =
            baseline?.state === 'ok' && face.known ? t('allGroups', { value: percent(baseline.value) }) : null;
          return (
            <Tile
              key={key}
              label={t(`tiles.${key}`)}
              info={infoOf(key)}
              value={face.value}
              known={face.known}
              tip={face.tip}
              note={[face.note, base].filter((part): part is string => part !== null).join(' · ')}
              spark={spark}
              loading={loading}
            />
          );
        })}
      </section>
      {frame.notice === undefined ? null : (
        <p className="type-meta text-foreground-tertiary xl:col-span-12">{frame.notice.text}</p>
      )}
    </div>
  );
}
