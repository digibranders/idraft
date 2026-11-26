'use client';

import { Workflow, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { MapSwatch } from './map-swatch';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { formatInteger } from '@/lib/format';
import type { MapColour, MapNode } from '@/lib/internal-links/map-graph';

export interface MapCardProps {
  node: MapNode;
  /** The tier of the page, or Untiered. */
  tier: string;
  colour: MapColour;
  onClose: () => void;
  onDetails: () => void;
  onJourney: () => void;
}

/** What a link drawn in the map looks like, so the card tells the two directions apart without colour. */
function LineSample({ direction }: { direction: 'in' | 'out' }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className="w-5 shrink-0"
      style={{
        borderTopWidth: '3px',
        borderTopStyle: direction === 'in' ? 'dotted' : 'solid',
        borderTopColor: direction === 'in' ? 'var(--chart-positive)' : 'var(--chart-1)',
      }}
    />
  );
}

/** The card of the selected page (W6): its address, its tier, its links by direction, and the two ways on. */
export function MapCard({ node, tier, colour, onClose, onDetails, onJourney }: MapCardProps): ReactElement {
  const t = useTranslations('internalLinks.map');
  return (
    <aside
      aria-label={t('card')}
      className="absolute top-3 left-3 flex w-72 flex-col gap-3 rounded-lg border border-border bg-surface-elevated p-3 shadow-popover"
      style={{ maxWidth: 'calc(100% - 1.5rem)' }}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="type-body-strong wrap-anywhere text-foreground">{node.path}</p>
          <p className="type-meta wrap-anywhere text-foreground-secondary">
            {node.title === '' ? t('cardNoTitle') : node.title}
          </p>
        </div>
        <IconButton icon={X} label={t('cardClose')} size="icon-xs" onClick={onClose} />
      </div>
      <ul className="flex flex-col gap-1.5">
        <li className="flex items-center gap-2 type-meta text-foreground-secondary">
          <MapSwatch colour={colour} />
          {tier}
        </li>
        <li className="flex items-center gap-2 type-meta text-foreground-secondary">
          <LineSample direction="in" />
          <span className="num type-body-strong text-foreground">{formatInteger(node.linksIn)}</span>{' '}
          {t('cardIn', { count: node.linksIn })}
        </li>
        <li className="flex items-center gap-2 type-meta text-foreground-secondary">
          <LineSample direction="out" />
          <span className="num type-body-strong text-foreground">{formatInteger(node.linksOut)}</span>{' '}
          {t('cardOut', { count: node.linksOut })}
        </li>
        {node.sitewideFrom > 0 ? (
          <li className="type-meta text-foreground-secondary">{t('cardSitewide', { count: node.sitewideFrom })}</li>
        ) : null}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onDetails}>
          {t('details')}
        </Button>
        <Button variant="secondary" size="sm" onClick={onJourney}>
          <Icon icon={Workflow} size="sm" />
          {t('openJourney')}
        </Button>
      </div>
    </aside>
  );
}
