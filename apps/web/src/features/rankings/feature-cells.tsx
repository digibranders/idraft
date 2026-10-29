import {
  CircleDot,
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

import { Icon } from '@/components/ui/icon';
import type { RankCell } from '@/lib/api/types';
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
  checked?: boolean;
  state?: RankCell['state'];
}

/**
 * SERP features cell: up to 5 icons, owned features in primary text, others in muted,
 * with a +N count and accessible spoken names (12-tables.md section 6).
 */
export function SerpFeatureListView({ display, checked, state }: SerpFeatureListViewProps): ReactElement {
  const t = useTranslations('rankings.features');

  if (state === 'failed') {
    return <Icon icon={TriangleAlert} size="sm" label={t('failed')} className="text-warning-text" />;
  }

  if (display.all.length === 0) {
    const isChecked = state !== undefined ? state !== 'not_checked' : (checked ?? true);
    return <span className="text-foreground-tertiary">{isChecked ? t('none') : t('pending')}</span>;
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
