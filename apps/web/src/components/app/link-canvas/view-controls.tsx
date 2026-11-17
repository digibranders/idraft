'use client';

import { Map, Maximize2, Target, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';

export interface ViewControlsProps {
  /** The zoom in percent. */
  percent: number;
  minimap: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onActualSize: () => void;
  onFit: () => void;
  onCenterFocus: () => void;
  onToggleMinimap: () => void;
}

/**
 * The toolbar at the bottom left of the canvas (spec 7.5 "View controls"): zoom, fit, centre on the focus page and the
 * map. Reset positions and the legend join it with the selection and move work.
 */
export function ViewControls(props: ViewControlsProps): ReactElement {
  const t = useTranslations('linkCanvas.controls');
  return (
    <div
      role="toolbar"
      aria-label={t('label')}
      data-canvas-control=""
      className="flex items-center gap-1 rounded-md border border-border bg-surface p-1 shadow-popover"
    >
      <IconButton icon={ZoomOut} label={t('zoomOut')} onClick={props.onZoomOut} />
      <Button
        variant="ghost"
        size="sm"
        className="min-w-12 num"
        aria-label={t('actualSize', { percent: props.percent })}
        onClick={props.onActualSize}
      >
        {t('percent', { percent: props.percent })}
      </Button>
      <IconButton icon={ZoomIn} label={t('zoomIn')} onClick={props.onZoomIn} />
      <IconButton icon={Maximize2} label={t('fit')} onClick={props.onFit} />
      <IconButton icon={Target} label={t('center')} onClick={props.onCenterFocus} />
      <IconButton
        icon={Map}
        label={props.minimap ? t('hideMap') : t('showMap')}
        aria-pressed={props.minimap}
        onClick={props.onToggleMinimap}
      />
    </div>
  );
}
