'use client';

import { Scan, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { IconButton } from '@/components/ui/icon-button';

/** The zoom steps of the canvas (mock `ZOOMS`). */
export const ZOOMS = [0.6, 0.8, 1, 1.2] as const;
export type Zoom = (typeof ZOOMS)[number];

export interface ZoomControlsProps {
  zoom: Zoom;
  onZoomChange: (zoom: Zoom) => void;
  onFit: () => void;
}

/** Zoom out, zoom in and fit to view: the non-drag alternative to pan and zoom (spec 7.5). */
export function ZoomControls({ zoom, onZoomChange, onFit }: ZoomControlsProps): ReactElement {
  const t = useTranslations('linkCanvas');
  const at = ZOOMS.indexOf(zoom);
  return (
    <div className="ml-auto flex items-center gap-1.5">
      <span className="w-10 text-right num type-meta text-foreground-tertiary">
        {t('zoomLevel', { percent: Math.round(zoom * 100) })}
      </span>
      <IconButton
        icon={ZoomOut}
        label={t('zoomOut')}
        variant="secondary"
        size="icon-sm"
        disabled={at <= 0}
        onClick={() => onZoomChange(ZOOMS[at - 1] ?? zoom)}
      />
      <IconButton
        icon={ZoomIn}
        label={t('zoomIn')}
        variant="secondary"
        size="icon-sm"
        disabled={at >= ZOOMS.length - 1}
        onClick={() => onZoomChange(ZOOMS[at + 1] ?? zoom)}
      />
      <IconButton icon={Scan} label={t('fit')} variant="secondary" size="icon-sm" onClick={onFit} />
    </div>
  );
}
