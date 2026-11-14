import {
  Activity,
  ChartBar,
  ChartColumn,
  ChartLine,
  Grid2x2,
  LayoutGrid,
  List,
  Route,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';

import { Icon } from '@/components/ui/icon';

// shortcut: a key map, card packages add their keys with their catalog entries
const CARD_ICON: Readonly<Record<string, LucideIcon>> = {
  'trend.visibility_mentions': ChartLine,
  'ai.mention_trend': ChartLine,
  'inspector.rank_history': ChartLine,
  'seo.rank_distribution': ChartBar,
  'competitors.share_of_voice': ChartBar,
  'ai.citation_share_by_domain_type': ChartColumn,
  'inspector.ai_by_engine': ChartBar,
  'cross.matrix_summary': Grid2x2,
  'inspector.key_numbers': LayoutGrid,
  'activity.key_changes': Activity,
  'activity.collection_status': Activity,
  'cross.opportunities': List,
  'cross.unclassified': List,
  'inspector.url_history': Route,
};

/** A card type without an entry in the map reads as a table, which most cards are. */
const FALLBACK: LucideIcon = Table2;

/** The tile that stands for a card type in the catalog: decorative, the title beside it names the card. */
export function CardSchematic({ typeKey }: { typeKey: string }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-md bg-neutral-subtle text-foreground-secondary"
    >
      <Icon icon={Object.hasOwn(CARD_ICON, typeKey) ? (CARD_ICON[typeKey] ?? FALLBACK) : FALLBACK} size="md" />
    </span>
  );
}
