'use client';

import { CircleHelp, Map, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';

export interface MapViewControlsProps {
  /** The zoom in percent. */
  percent: number;
  minimap: boolean;
  /** At the smallest zoom: zoom out has nowhere to go. */
  atMin: boolean;
  /** At the largest zoom: zoom in has nowhere to go. */
  atMax: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  /** The percent button and Fit everything both bring the whole map into view. */
  onFit: () => void;
  onToggleMinimap: () => void;
  helpOpen: boolean;
  /** The id of the help panel, which the button points at while it is open. */
  helpId: string;
  onToggleHelp: () => void;
}

/**
 * The group of buttons at the bottom left of the canvas: zoom, fit, the minimap and the help. The same markup as the
 * Journey canvas controls (`ViewControls`), which has two buttons the map does not (centre on the focus page, reset
 * card positions); a dragged page keeps its place until the tab reloads, so there is nothing to reset here.
 */
export function MapViewControls(props: MapViewControlsProps): ReactElement {
  const t = useTranslations('linkCanvas.controls');
  const words = useTranslations('internalLinks.map');
  return (
    // A group, not a toolbar: every control is a tab stop, and a toolbar promises arrow keys between its controls
    <div
      role="group"
      aria-label={words('viewLabel')}
      className="absolute bottom-3 left-3 flex items-center gap-1 rounded-md border border-border bg-surface p-1 shadow-popover"
    >
      {/* Disabled but still focusable, so focus does not drop out of the group when a limit is reached */}
      <IconButton
        icon={ZoomOut}
        label={t('zoomOut')}
        disabled={props.atMin}
        focusableWhenDisabled
        onClick={props.onZoomOut}
      />
      <Button
        variant="ghost"
        size="sm"
        className="min-w-12 num"
        aria-label={t('actualSize', { percent: props.percent })}
        onClick={props.onFit}
      >
        {t('percent', { percent: props.percent })}
      </Button>
      <IconButton
        icon={ZoomIn}
        label={t('zoomIn')}
        disabled={props.atMax}
        focusableWhenDisabled
        onClick={props.onZoomIn}
      />
      <IconButton icon={Maximize2} label={t('fit')} onClick={props.onFit} />
      <IconButton
        icon={Map}
        label={props.minimap ? t('hideMap') : t('showMap')}
        aria-pressed={props.minimap}
        onClick={props.onToggleMinimap}
      />
      <IconButton
        icon={CircleHelp}
        label={words('help')}
        aria-expanded={props.helpOpen}
        aria-controls={props.helpOpen ? props.helpId : undefined}
        onClick={props.onToggleHelp}
      />
    </div>
  );
}
