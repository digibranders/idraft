import type { ComponentType, ReactElement, ReactNode } from 'react';

import { defineCards, type CardProps, type CardRegistry } from './registry';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { SampleCount } from '@/components/app/metric/sample-count';
import { Skeleton } from '@/components/ui/skeleton';
import type { CategorySeries } from '@/lib/charts/category-chart';
import { EMPTY_VALUE, formatInteger, formatPercent } from '@/lib/format';
import { CARD_TYPES, cardName, type CardItem, type ScreenKey } from '@/lib/layouts';

/*
 * The cards of the layouts gallery (/design-system/layouts-live, task T11 of WP-15). They are fixtures with fixed
 * values (no clock, no random numbers): a chart, a five row list and a metric block. A percent always has its
 * count beside it, and an unknown value is `n/a` and never a zero. The gallery is for the team and is never
 * translated, so its words are kept in one table here, away from the markup.
 */
const COPY = {
  rankHeader: 'Rank',
  rankSummary: 'Of 986 keywords, 41 rank in the top 3, 271 rank 4 to 10, 380 rank 11 to 20 and 294 rank 21 to 100.',
  noAnswers: 'No answers yet',
  mentionRate: 'Mention rate',
  citationRate: 'Citation rate',
  topTen: 'Top 10',
  loading: 'Loading',
  noOptions: 'Fixture data',
} as const;

interface ListRow {
  id: string;
  text: string;
  /** Answers that name the brand, and the answers in all: both `null` while nothing has answered. */
  mentioned: number | null;
  answers: number | null;
}

const ROWS: readonly ListRow[] = [
  { id: 'startups', text: 'Best CRM for startups', mentioned: 21, answers: 30 },
  { id: 'pricing', text: 'CRM pricing compared', mentioned: 9, answers: 30 },
  { id: 'alternatives', text: 'HubSpot alternatives', mentioned: 12, answers: 30 },
  { id: 'email', text: 'CRM with email marketing built in', mentioned: 6, answers: 30 },
  // No answer yet: the rate is unknown, not 0
  { id: 'agency', text: 'Best CRM for a small agency', mentioned: null, answers: null },
];

const ratioOf = (mentioned: number | null, answers: number | null): number | null =>
  mentioned === null || answers === null || answers === 0 ? null : mentioned / answers;

const RANK_BUCKETS: readonly string[] = ['Top 3', '4 to 10', '11 to 20', '21 to 100'];
const RANK_SERIES: readonly CategorySeries[] = [
  { id: 'keywords', name: 'Keywords', role: { kind: 'brand' }, values: [41, 271, 380, 294] },
];

/** The options a card was given, so a choice made in its Options popover is seen on the card. */
function optionsText(options: Readonly<Record<string, string>>): string {
  const chosen = Object.entries(options).map(([key, value]) => `${key} ${value}`);
  return chosen.length === 0 ? COPY.noOptions : `${COPY.noOptions}, ${chosen.join(', ')}`;
}

/** The surface of a list or a metric block, shaped like the panel of a `ChartFrame`. */
function Panel({ title, meta, children }: { title: string; meta: string; children: ReactNode }): ReactElement {
  return (
    <section className="flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col">
        <h2 className="type-section-title">{title}</h2>
        <p className="type-meta">{meta}</p>
      </div>
      {children}
    </section>
  );
}

function ChartCard({ item, options }: CardProps): ReactElement {
  return (
    <ChartFrame
      kind="bar"
      variant="panel"
      title={cardName(item)}
      meta={optionsText(options)}
      categories={RANK_BUCKETS}
      categoryHeader={COPY.rankHeader}
      series={RANK_SERIES}
      formatValue={formatInteger}
      height={140}
      summary={COPY.rankSummary}
      status="ready"
    />
  );
}

function ListCard({ item, options }: CardProps): ReactElement {
  return (
    <Panel title={cardName(item)} meta={optionsText(options)}>
      <ul className="flex flex-col">
        {ROWS.map((row) => {
          const ratio = ratioOf(row.mentioned, row.answers);
          return (
            <li
              key={row.id}
              className="flex items-baseline justify-between gap-3 border-b border-border-subtle py-1.5 last:border-b-0"
            >
              <span className="min-w-0 truncate type-body">{row.text}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span
                  className={ratio === null ? 'num type-body-strong text-foreground-tertiary' : 'num type-body-strong'}
                >
                  {formatPercent(ratio)}
                </span>
                {ratio === null ? (
                  <span className="type-meta">{COPY.noAnswers}</span>
                ) : (
                  <SampleCount k={row.mentioned} n={row.answers} noun="answers" />
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function MetricCard({ item, options }: CardProps): ReactElement {
  return (
    <Panel title={cardName(item)} meta={optionsText(options)}>
      <dl className="flex flex-wrap gap-x-6 gap-y-3">
        <div className="flex flex-col">
          <dt className="type-label">{COPY.mentionRate}</dt>
          <dd className="num type-metric-sm">{formatPercent(ratioOf(21, 30))}</dd>
          <dd>
            <SampleCount k={21} n={30} noun="answers" />
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="type-label">{COPY.citationRate}</dt>
          <dd className="num type-metric-sm text-foreground-tertiary">{EMPTY_VALUE}</dd>
          <dd className="type-meta">{COPY.noAnswers}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="type-label">{COPY.topTen}</dt>
          <dd className="num type-metric-sm">{formatInteger(312)}</dd>
          <dd>
            <SampleCount k={312} n={986} noun="keywords" />
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

type FixtureKind = 'chart' | 'list' | 'metric';
const FIXTURES: Readonly<Record<FixtureKind, ComponentType<CardProps>>> = {
  chart: ChartCard,
  list: ListCard,
  metric: MetricCard,
};
const KIND_OF_TYPE: Readonly<Record<string, FixtureKind>> = {
  'trend.visibility_mentions': 'chart',
  'seo.rank_distribution': 'chart',
  'ai.mention_trend': 'chart',
  'competitors.share_of_voice': 'chart',
  'inspector.rank_history': 'chart',
  'cross.matrix_summary': 'metric',
  'cross.unclassified': 'metric',
  'ai.by_engine': 'metric',
  'seo.serp_features': 'metric',
  'activity.collection_status': 'metric',
  'inspector.key_numbers': 'metric',
};
const kindOf = (type: string): FixtureKind => KIND_OF_TYPE[type] ?? 'list';

/** The skeleton keeps the card's title, as a chart does while it loads. */
function skeletonFor(title: string): ComponentType {
  return function FixtureSkeleton(): ReactElement {
    return (
      <Panel title={title} meta={COPY.loading}>
        <Skeleton shape="block" height="chart-140" />
      </Panel>
    );
  };
}

const SHOWN_SCREENS: readonly ScreenKey[] = ['overview', 'inspector.keyword'];

/** Every card type of the overview and the keyword drawer, drawn by one of the three fixtures. */
export const GALLERY_CARDS: CardRegistry = defineCards(
  Object.fromEntries(
    CARD_TYPES.filter((type) => type.screens.some((screen) => SHOWN_SCREENS.includes(screen))).map((type) => [
      type.key,
      { load: () => Promise.resolve({ default: FIXTURES[kindOf(type.key)] }), skeleton: skeletonFor(type.title) },
    ]),
  ),
);

/** What the fixture of `item` draws, outside a grid. */
export function FixtureBody({ item }: { item: CardItem }): ReactElement {
  const Body = FIXTURES[kindOf(item.type)];
  return <Body item={item} options={{}} width={null} mode="customize" live={false} />;
}
