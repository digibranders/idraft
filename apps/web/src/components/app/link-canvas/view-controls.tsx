'use client';

import { CircleHelp, Map, Maximize2, Target, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';

export interface ViewControlsProps {
  /** The zoom in percent. */
  percent: number;
  minimap: boolean;
  /** At 25 percent: zoom out has nowhere to go. */
  atMin: boolean;
  /** At 200 percent: zoom in has nowhere to go. */
  atMax: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onActualSize: () => void;
  onFit: () => void;
  onCenterFocus: () => void;
  onToggleMinimap: () => void;
  /** At least one card was moved: Reset card positions has something to put back. */
  canReset: boolean;
  onReset: () => void;
  helpOpen: boolean;
  onToggleHelp: () => void;
}

/**
 * The toolbar at the bottom left of the canvas (spec 7.5 "View controls"): zoom, fit, centre on the focus page, reset
 * card positions, the map and the legend and controls panel.
 */
export function ViewControls(props: ViewControlsProps): ReactElement {
  const t = useTranslations('linkCanvas.controls');
  return (
    // A group, not a toolbar: every control is a tab stop, and a toolbar promises arrow keys between its controls
    <div
      role="group"
      aria-label={t('label')}
      data-canvas-control=""
      className="flex items-center gap-1 rounded-md border border-border bg-surface p-1 shadow-popover"
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
        onClick={props.onActualSize}
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
      <IconButton icon={Target} label={t('center')} onClick={props.onCenterFocus} />
      <IconButton
        icon={Undo2}
        label={t('reset')}
        disabled={!props.canReset}
        focusableWhenDisabled
        onClick={props.onReset}
      />
      <IconButton
        icon={Map}
        label={props.minimap ? t('hideMap') : t('showMap')}
        // The map is drawn from 640 px up (see Minimap), so its button is too
        className="hidden sm:inline-flex"
        aria-pressed={props.minimap}
        onClick={props.onToggleMinimap}
      />
      <IconButton icon={CircleHelp} label={t('help')} aria-expanded={props.helpOpen} onClick={props.onToggleHelp} />
    </div>
  );
}
