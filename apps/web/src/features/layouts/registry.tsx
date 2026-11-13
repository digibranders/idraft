'use client';

/**
 * What a screen's cards are made of (docs/superpowers/plans/2026-11-13-ai-wp-15-layouts-core.md, section 2.2).
 * A screen's package owns its registry and passes it to the LayoutProvider, so no shared file collects every
 * card and each card's code loads only when the card comes near the viewport.
 */
import { createElement, lazy, type ComponentType, type LazyExoticComponent, type ReactElement } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import type { CardItem, Width } from '@/lib/layouts';
import type { LayoutMode } from './layout-state';

export interface CardProps {
  item: CardItem;
  /** Every option key set: sanitized before the card sees it. */
  options: Readonly<Record<string, string>>;
  width: Width | null;
  mode: LayoutMode;
  /** False in customize mode: the card passes `subscribed: live` to its queries, so editing costs no requests. */
  live: boolean;
}

export interface CardRegistration {
  load: () => Promise<{ default: ComponentType<CardProps> }>;
  /** At the card's final height, so nothing moves when the card arrives. Default CardSkeleton. */
  skeleton?: ComponentType | undefined;
}

export interface RegisteredCard {
  /** One stable component per type: it renders the card's current `lazy`, which `reset` may replace. */
  Component: ComponentType<CardProps>;
  Skeleton: ComponentType;
  /**
   * React.lazy remembers a failed load for good, so a card whose code could not be fetched would stay failed.
   * After a failure this makes the next render load the code again; after a good load it does nothing.
   */
  reset(): void;
}

export type CardRegistry = Readonly<Record<string, RegisteredCard>>;

/** A card's stand-in while its code or data arrives. */
export function CardSkeleton(): ReactElement {
  return <Skeleton shape="block" height="chart-140" className="min-h-30" />;
}

/** One card type: its lazy component, and the one fresh lazy that a failure is allowed to swap in. */
function register({ load, skeleton }: CardRegistration): RegisteredCard {
  let failed = false;
  const lazily = (): LazyExoticComponent<ComponentType<CardProps>> =>
    lazy(async () => {
      // async: a `load` that throws at once counts as a failed load too
      try {
        return await load();
      } catch (error) {
        failed = true;
        throw error;
      }
    });
  let current = lazily();
  return {
    // Defined here, never during a render, so a render never rebuilds a card
    Component: (props) => createElement(current, props),
    Skeleton: skeleton ?? CardSkeleton,
    reset: () => {
      if (!failed) return;
      failed = false;
      current = lazily();
    },
  };
}

/** Call once at module level per screen: lazy() runs here, never during render, so a render never rebuilds a card. */
export function defineCards(entries: Readonly<Record<string, CardRegistration>>): CardRegistry {
  return Object.fromEntries(Object.entries(entries).map(([type, registration]) => [type, register(registration)]));
}
