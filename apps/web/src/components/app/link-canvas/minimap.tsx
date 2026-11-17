'use client';

import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';

import type { Box } from '@/lib/internal-links/journey-geometry';

export interface MinimapCard extends Box {
  key: string;
}

export interface MinimapProps {
  label: string;
  /** The extent of the world. */
  content: Box;
  cards: readonly MinimapCard[];
  /** The part of the world in view, in world coordinates. */
  shown: Box;
  /** Pressing or dragging asks for the view to move so this world point is centred. */
  onMove: (centre: { x: number; y: number }) => void;
}

const WIDTH = 176;
const HEIGHT = 112;

/** The map at the bottom right (spec 7.5 "Minimap"): every card and the part in view; press or drag to move the view. */
export function Minimap({ label, content, cards, shown, onMove }: MinimapProps): ReactElement {
  const scale = Math.min(WIDTH / Math.max(content.width, 1), HEIGHT / Math.max(content.height, 1));
  const toWorld = (event: ReactPointerEvent<SVGSVGElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: content.left + (event.clientX - rect.left) / scale,
      y: content.top + (event.clientY - rect.top) / scale,
    };
  };
  return (
    <svg
      role="img"
      aria-label={label}
      data-canvas-control=""
      width={WIDTH}
      height={HEIGHT}
      className="hidden rounded-md border border-border bg-surface shadow-popover sm:block"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onMove(toWorld(event));
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) onMove(toWorld(event));
      }}
    >
      {cards.map((card) => (
        <rect
          key={card.key}
          data-card=""
          x={(card.left - content.left) * scale}
          y={(card.top - content.top) * scale}
          width={Math.max(card.width * scale, 2)}
          height={Math.max(card.height * scale, 2)}
          className="fill-foreground-tertiary"
        />
      ))}
      <rect
        data-shown=""
        x={(shown.left - content.left) * scale}
        y={(shown.top - content.top) * scale}
        width={shown.width * scale}
        height={shown.height * scale}
        fill="none"
        className="stroke-primary"
        strokeWidth={1.5}
      />
    </svg>
  );
}
