import {
  Check,
  CircleDot,
  Clock,
  Crosshair,
  BookOpen,
  Image,
  Link,
  MapPin,
  Megaphone,
  MessageCircleQuestion,
  MessagesSquare,
  MessageSquareText,
  Newspaper,
  Search,
  Share2,
  ShoppingBag,
  Sparkles,
  TextQuote,
  TriangleAlert,
  UserRound,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Tooltip } from '@/components/ui/tooltip';
import type { CompetitorRank, RankCell } from '@/lib/api/types';
import { rankDisplay, type AioDisplay } from '@/lib/format';
import { isFeatureType, FEATURE_MESSAGE_KEYS, type FeatureListDisplay } from '@/lib/keywords/serp-features';
import { RankCellView } from './rank-cells';

const FEATURE_ICONS: Readonly<Record<string, LucideIcon>> = {
  ai_overview: Sparkles,
  featured_snippet: TextQuote,
  people_also_ask: MessageCircleQuestion,
  local_pack: MapPin,
  knowledge_graph: BookOpen,
  top_stories: Newspaper,
  video: Video,
  images: Image,
  discussions_and_forums: MessagesSquare,
  perspectives: UserRound,
  shopping: ShoppingBag,
  related_searches: Search,
  social_posts: Share2,
  answer_box: MessageSquareText,
  ads: Megaphone,
  sitelinks: Link,
};

const FALLBACK_ICON: LucideIcon = CircleDot;

export interface SerpFeatureListViewProps {
  display: FeatureListDisplay;
  state?: RankCell['state'];
  stale?: boolean;
  lastSuccessfulCheck?: string | null | undefined;
}

export function StaleMark({ lastSuccessfulCheck }: { lastSuccessfulCheck?: string | null | undefined }): ReactElement {
  const t = useTranslations('rankings.rank');
  const tip = lastSuccessfulCheck ? t('lastGood', { date: lastSuccessfulCheck }) : t('staleTooltip');
  return (
    <Tooltip content={tip} purpose="label">
      <span className="inline-flex items-center">
        <Icon icon={Clock} size="xs" className="text-warning-text" />
        <span className="sr-only">{t('speech.stale')}</span>
      </span>
    </Tooltip>
  );
}

/**
 * SERP features cell: up to 5 icons, owned features in primary text, others in muted,
 * with a +N count and accessible spoken names (12-tables.md section 6).
 */
export function SerpFeatureListView({
  display,
  state,
  stale,
  lastSuccessfulCheck,
}: SerpFeatureListViewProps): ReactElement {
  const t = useTranslations('rankings.features');

  if (state === 'failed') {
    return (
      <span className="inline-flex items-center gap-1">
        {stale ? <StaleMark lastSuccessfulCheck={lastSuccessfulCheck} /> : null}
        <Icon icon={TriangleAlert} size="sm" label={t('failed')} className="text-warning-text" />
      </span>
    );
  }

  if (display.all.length === 0) {
    const isChecked = state !== undefined ? state !== 'not_checked' : true;
    return (
      <span className="inline-flex items-center gap-1 text-foreground-tertiary">
        {stale ? <StaleMark lastSuccessfulCheck={lastSuccessfulCheck} /> : null}
        {isChecked ? t('none') : t('pending')}
      </span>
    );
  }

  const spokenFeatures = display.all
    .map((slot) => {
      const name = isFeatureType(slot.type) ? t(`names.${FEATURE_MESSAGE_KEYS[slot.type]}`) : slot.type;
      return slot.owned ? t('owned', { feature: name }) : name;
    })
    .join('. ');

  const spokenList = t('listName', { features: spokenFeatures });

  return (
    <span className="inline-flex items-center gap-1.5">
      {stale ? <StaleMark lastSuccessfulCheck={lastSuccessfulCheck} /> : null}
      <span className="sr-only">{spokenList}</span>
      <span className="inline-flex items-center gap-1.5" aria-hidden="true">
        {display.shown.map((slot, index) => {
          const Glyph = FEATURE_ICONS[slot.type] ?? FALLBACK_ICON;
          return (
            <Icon
              key={`${slot.type}-${index}`}
              icon={Glyph}
              className={slot.owned ? 'text-primary-text' : 'text-foreground-muted'}
            />
          );
        })}
        {display.overflow > 0 && (
          <span className="num type-table text-foreground-muted">{t('more', { count: display.overflow })}</span>
        )}
      </span>
    </span>
  );
}

export interface AioStatusViewProps {
  display: AioDisplay;
  state?: RankCell['state'];
  stale?: boolean;
  lastSuccessfulCheck?: string | null | undefined;
}

/**
 * AI Overview cell: badge when cited, check icon when present but not cited,
 * tertiary text otherwise (12-tables.md section 6, `AIOverviewStatus`).
 */
export function AioStatusView({ display, state, stale, lastSuccessfulCheck }: AioStatusViewProps): ReactElement {
  const t = useTranslations('rankings.aio');

  if (state === 'failed') {
    return (
      <span className="inline-flex items-center gap-1">
        {stale ? <StaleMark lastSuccessfulCheck={lastSuccessfulCheck} /> : null}
        <Icon icon={TriangleAlert} size="sm" label={t('failed')} className="text-warning-text" />
      </span>
    );
  }

  const content = (() => {
    switch (display.kind) {
      case 'cited': {
        const text = display.position === null ? t('citedNoPosition') : t('cited', { position: display.position });
        const speech =
          display.position === null ? t('speech.citedNoPosition') : t('speech.cited', { position: display.position });
        return (
          <Badge tone="positive" icon={Check} role="img" aria-label={speech}>
            {text}
          </Badge>
        );
      }
      case 'notCited':
        return <Icon icon={Check} label={t('speech.notCited')} className="text-primary-text" />;
      case 'absent':
        return (
          <span>
            <span className="sr-only">{t('speech.absent')}</span>
            <span aria-hidden="true" className="text-foreground-tertiary">
              {t('absent')}
            </span>
          </span>
        );
      case 'notLoaded':
        return <span className="text-foreground-tertiary">{t('notLoaded')}</span>;
      case 'unknown':
        return <span className="text-foreground-tertiary">{t('unknown')}</span>;
      case 'pending':
        return <span className="text-foreground-tertiary">{t('pending')}</span>;
    }
  })();

  if (!stale) return content;

  return (
    <span className="inline-flex items-center gap-1">
      <StaleMark lastSuccessfulCheck={lastSuccessfulCheck} />
      {content}
    </span>
  );
}

/**
 * A marker shown in the keyword cell when the latest check ranked a URL other than the target URL
 * (24-page-templates.md section 9.3). Carries no text of its own: the explanation belongs in the cell's
 * description.
 */
export function TargetMismatchMarker(): ReactElement {
  return <Icon icon={Crosshair} size="sm" className="text-warning-text" />;
}

/**
 * A competitor's rank cell: an 8 px square colour swatch followed by the competitor's rank
 * (12-tables.md CompetitorCell, 15-data-visualization.md section 3).
 */
export function CompetitorRankView({
  entry,
  name,
  colorIndex,
  position = 0,
}: {
  entry?: CompetitorRank | null | undefined;
  name: string;
  colorIndex?: number | null | undefined;
  position?: number | undefined;
}): ReactElement {
  const t = useTranslations('rankings.competitor');
  if (!entry) {
    return (
      <span className="text-foreground-tertiary" aria-label={t('speech', { name, rank: t('notTracked') })}>
        {t('notTracked')}
      </span>
    );
  }
  const color =
    colorIndex !== undefined && colorIndex !== null && colorIndex >= 2 && colorIndex <= 6
      ? colorIndex
      : entry.entity.color_index !== undefined &&
          entry.entity.color_index !== null &&
          entry.entity.color_index >= 2 &&
          entry.entity.color_index <= 6
        ? entry.entity.color_index
        : 2 + (position % 5);

  const display = rankDisplay(entry.current, false, 0);
  const rankText =
    entry.current.state === 'ranked' && entry.current.rank !== null
      ? String(entry.current.rank)
      : entry.current.state === 'beyond_depth'
        ? `>${entry.current.depth_requested}`
        : t('notTracked');
  const speech = t('speech', { name, rank: rankText });

  return (
    <span className="flex items-center gap-1.5" aria-label={speech}>
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-2xs"
        style={{ backgroundColor: `var(--chart-${color})` }}
      />
      <RankCellView display={display} />
    </span>
  );
}
