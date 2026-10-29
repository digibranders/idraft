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
import type { RankCell } from '@/lib/api/types';
import type { AioDisplay } from '@/lib/format';
import { isFeatureType, FEATURE_MESSAGE_KEYS, type FeatureListDisplay } from '@/lib/keywords/serp-features';

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
}

function StaleMark(): ReactElement {
  const t = useTranslations('rankings.rank');
  return (
    <>
      <Icon icon={Clock} size="xs" className="text-warning-text" />
      <span className="sr-only">{t('speech.stale')}</span>
    </>
  );
}

/**
 * SERP features cell: up to 5 icons, owned features in primary text, others in muted,
 * with a +N count and accessible spoken names (12-tables.md section 6).
 */
export function SerpFeatureListView({ display, state, stale }: SerpFeatureListViewProps): ReactElement {
  const t = useTranslations('rankings.features');

  if (state === 'failed') {
    return (
      <span className="inline-flex items-center gap-1">
        {stale ? <StaleMark /> : null}
        <Icon icon={TriangleAlert} size="sm" label={t('failed')} className="text-warning-text" />
      </span>
    );
  }

  if (display.all.length === 0) {
    const isChecked = state !== undefined ? state !== 'not_checked' : true;
    return (
      <span className="inline-flex items-center gap-1 text-foreground-tertiary">
        {stale ? <StaleMark /> : null}
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
      {stale ? <StaleMark /> : null}
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
          <span className="num type-meta text-foreground-muted">{t('more', { count: display.overflow })}</span>
        )}
      </span>
    </span>
  );
}

export interface AioStatusViewProps {
  display: AioDisplay;
  state?: RankCell['state'];
  stale?: boolean;
}

/**
 * AI Overview cell: badge when cited, check icon when present but not cited,
 * tertiary text otherwise (12-tables.md section 6, `AIOverviewStatus`).
 */
export function AioStatusView({ display, state, stale }: AioStatusViewProps): ReactElement {
  const t = useTranslations('rankings.aio');

  if (state === 'failed') {
    return (
      <span className="inline-flex items-center gap-1">
        {stale ? <StaleMark /> : null}
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
          <Badge tone="positive" icon={Check} aria-label={speech}>
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
      <StaleMark />
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
