'use client';

/**
 * The cards of one screen (docs/superpowers/plans/2026-11-13-ai-wp-15-layouts-core.md, section 2.7), read from the
 * nearest LayoutProvider. View mode is CSS grid: the span classes give exactly the rows `packRows` computes, so
 * the pure layer and the page cannot drift. Customize mode hands the same cells to the sortable grid.
 */
import { useTranslations } from 'next-intl';
import {
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

import { AddCardSlot } from './add-card-slot';
import { CardFrame } from './card-frame';
import { CardFailureNotice, CardFailuresContext, createCardFailures } from './cards/card-failures';
import { useLayoutScreen, type LayoutContextValue } from './layout-provider';
import { CardSkeleton, type CardRegistry, type RegisteredCard } from './registry';
import { SortableGrid } from './sortable-grid';
import { useNearViewport } from './use-near-viewport';
import { useReducedMotion } from './use-reduced-motion';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { Button } from '@/components/ui/button';
import { LIMITS, cardType, type CardItem, type Width } from '@/lib/layouts';
import { cn } from '@/lib/utils';

export interface LayoutGridProps {
  /** Names the region: "Overview cards". */
  label: string;
  /** `one`: one column and no widths (drawers). */
  columns?: 'grid' | 'one' | undefined;
  /** The Add card slot and the empty page's slot call it with the index the card goes to; absent: no slot. */
  onAddCard?: ((index: number) => void) | undefined;
  /** What an unavailable card shows in customize mode. Default: the reason. */
  renderUnavailable?: ((item: CardItem, reason: string) => ReactNode) | undefined;
  /** Wraps every card body (WP-16's error boundary). */
  CardBoundary?: ComponentType<{ item: CardItem; children: ReactNode }> | undefined;
  /** View mode with no card to show: the one action that changes it (WP-16's Customize). */
  emptyAction?: ReactNode | undefined;
}

/**
 * The 12-column spans of each width as classes: `md:` is the `medium` breakpoint and `xl:` the `wide` one of
 * `lib/layouts/rows.ts`; the grid test holds the two together.
 */
export const SPAN_CLASS: Readonly<Record<Width, string>> = {
  third: 'col-span-12 md:col-span-6 xl:col-span-4',
  half: 'col-span-12 md:col-span-6',
  two_thirds: 'col-span-12 xl:col-span-8',
  full: 'col-span-12',
};

/** `Object.hasOwn`: a type named `constructor` must not find a property of Object.prototype. */
function registeredCard(registry: CardRegistry, type: string): RegisteredCard | undefined {
  return Object.hasOwn(registry, type) ? registry[type] : undefined;
}

/** Every option key set, from the item or else the catalog default. */
function optionsOf(item: CardItem): Record<string, string> {
  const options = cardType(item.type)?.options ?? {};
  return Object.fromEntries(
    Object.entries(options).map(([key, option]) => [key, item.options?.[key] ?? option.default]),
  );
}

interface CardBodyProps {
  item: CardItem;
  CardBoundary: LayoutGridProps['CardBoundary'];
}

/**
 * What is inside a frame: the card once it is near the screen, its skeleton before. A card that cannot show has
 * no body; its reason goes in the frame's notice, outside the inert part.
 */
function CardBody({ item, CardBoundary }: CardBodyProps): ReactElement | null {
  const t = useTranslations('layouts.core');
  const { registry, availabilityOf, mode } = useLayoutScreen();
  const { ref, near } = useNearViewport();
  const registered = registeredCard(registry, item.type);
  if (availabilityOf(item).state === 'unavailable') return null;

  let content: ReactNode;
  if (registered === undefined) {
    content = <p className="type-meta text-foreground-secondary">{t('notRegistered')}</p>;
  } else {
    const { Component, Skeleton } = registered;
    content = near ? (
      <Suspense fallback={<Skeleton />}>
        <Component
          item={item}
          options={optionsOf(item)}
          width={item.width ?? null}
          mode={mode}
          live={mode === 'view'}
        />
      </Suspense>
    ) : (
      <Skeleton />
    );
  }
  return (
    <div ref={ref} className="h-full">
      {CardBoundary === undefined ? content : <CardBoundary item={item}>{content}</CardBoundary>}
    </div>
  );
}

/** Moves focus where the provider asked (after a hide, a move, an add), then says it was done. */
function useFocusRequests(root: RefObject<HTMLElement | null>, value: LayoutContextValue): void {
  const { focus, actions } = value;
  const reduced = useReducedMotion();
  useEffect(() => {
    // A request for the numbers zone is answered (and cleared) by the number strip
    if (focus === null || focus.zone === 'numbers' || root.current === null) return;
    const scope = root.current;
    const frame = [...scope.querySelectorAll<HTMLElement>('[data-layout-card]')].find(
      (candidate) => candidate.dataset.layoutCard === focus.id,
    );
    const target =
      focus.id === null
        ? scope.querySelector<HTMLElement>('[data-add-card-slot]')
        : (frame?.querySelector<HTMLElement>(`[data-part="${focus.part}"]`) ??
          frame?.querySelector<HTMLElement>('[data-part="handle"]'));
    // focus() would scroll too; scrolling once, as the person's motion setting says, is the point
    target?.focus({ preventScroll: true });
    // Not every environment has it (jsdom): focus has happened either way
    if (typeof target?.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    }
    actions.focused();
  }, [focus, reduced, actions, root]);
}

/** The cards of the screen: view mode, customize mode, loading, a failed read and an empty page. */
export function LayoutGrid({
  label,
  columns = 'grid',
  onAddCard,
  renderUnavailable,
  CardBoundary,
  emptyAction,
}: LayoutGridProps): ReactElement {
  const t = useTranslations('layouts.core');
  const tCommon = useTranslations('common');
  const screen = useLayoutScreen();
  const { status, refetching, mode, shownCards, document, definition, registry, availabilityOf, retry } = screen;
  const root = useRef<HTMLElement>(null);
  // The failures of this grid's cards: a card's boundary reports to it, the frame's notice reads from it
  const [failures] = useState(createCardFailures);
  useFocusRequests(root, screen);

  const customizing = mode === 'customize';
  const containerClass = columns === 'one' ? 'flex flex-col gap-4' : 'grid grid-cols-12 gap-4';
  const cellClass = (item: CardItem): string => (columns === 'one' ? '' : SPAN_CLASS[item.width ?? 'full']);
  const cards = document.cards ?? [];
  /**
   * What goes in the frame's notice (outside the inert body): why a card cannot show, or in customize mode the
   * failure of a card that can (reported by its boundary, so Retry stays reachable).
   */
  const noticeOf = (item: CardItem): ReactNode => {
    const availability = availabilityOf(item);
    if (availability.state !== 'unavailable') return customizing ? <CardFailureNotice item={item} /> : undefined;
    return renderUnavailable === undefined ? (
      <p className="type-meta text-foreground-secondary">{availability.reason}</p>
    ) : (
      renderUnavailable(item, availability.reason)
    );
  };
  const bodyOf = (item: CardItem): ReactElement => <CardBody item={item} CardBoundary={CardBoundary} />;

  let body: ReactElement;
  if (status === 'loading') {
    body = (
      <div role="status" aria-label={t('loading', { screen: definition.title })} className={containerClass}>
        {shownCards.map((item) => {
          const Skeleton = registeredCard(registry, item.type)?.Skeleton ?? CardSkeleton;
          return (
            <div key={item.id} className={cellClass(item)}>
              <Skeleton />
            </div>
          );
        })}
      </div>
    );
  } else if (customizing) {
    body = (
      // `relative`: what is placed inside the grid (the drop line) measures against the grid, not the section
      <div className={cn('relative', containerClass)}>
        <SortableGrid
          cards={shownCards}
          cellClass={cellClass}
          renderBody={bodyOf}
          renderNotice={noticeOf}
          columns={columns}
        />
        {shownCards.length === 0 ? (
          <p className="col-span-12 type-body text-foreground-secondary">
            {t(onAddCard === undefined ? 'emptyView' : 'empty')}
          </p>
        ) : null}
        {onAddCard !== undefined && cards.length < LIMITS.cards ? (
          <AddCardSlot index={cards.length} onAdd={onAddCard} cards={shownCards} />
        ) : null}
      </div>
    );
  } else if (shownCards.length === 0) {
    const unavailable = cards.filter((item) => availabilityOf(item).state === 'unavailable').length;
    body = (
      <EmptyState
        headingLevel={2}
        title={t('emptyView')}
        reason={unavailable > 0 ? t('emptyUnavailable', { count: unavailable }) : t('empty')}
        primaryAction={emptyAction}
      />
    );
  } else {
    body = (
      <div className={containerClass}>
        {shownCards.map((item) => (
          <CardFrame key={item.id} item={item} className={cellClass(item)} notice={noticeOf(item)}>
            {bodyOf(item)}
          </CardFrame>
        ))}
      </div>
    );
  }

  return (
    <CardFailuresContext value={failures}>
      <section ref={root} aria-label={label} className="relative">
        {refetching ? (
          <div
            aria-hidden="true"
            data-slot="layout-refetch-bar"
            className="absolute inset-x-0 top-0 h-0.5 bg-primary"
          />
        ) : null}
        {status === 'error' ? (
          <Banner
            tone="warning"
            placement="region"
            live
            message={t('readFailed')}
            actions={
              <Button size="sm" onClick={retry}>
                {tCommon('retry')}
              </Button>
            }
            className="mb-4"
          />
        ) : null}
        {body}
      </section>
    </CardFailuresContext>
  );
}
