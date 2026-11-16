'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useOverview } from '../overview-context';
import { cardMinHeight } from './card-min-height';
import { singlePlatform } from '../scope/scope-model';
import type { ChartEmpty } from '@/components/app/chart/chart-frame';
import { cardName, type CardItem } from '@/lib/layouts';
import { cn } from '@/lib/utils';

/**
 * Why a card has nothing for the scope, in words that name the way out. A card stays in its place whatever the scope
 * is; one that cannot show it says why, and is never blank and never a zero. The reason is the platform's when one is
 * chosen (that platform does not measure what the card counts), else the group's (the card compares groups).
 */
export function useScopeUnavailable(card: string): ChartEmpty {
  const t = useTranslations('aiOverview.shell.unavailable');
  const { scope, engines } = useOverview();
  const code = singlePlatform(scope);
  const platform = engines.data?.find((engine) => engine.engine.engine_code === code)?.engine.label ?? code;
  return {
    title: t('title'),
    reason: platform === null ? t('group', { card }) : t('platform', { card, platform }),
  };
}

/**
 * The whole card of a type that has nothing for the scope: its name, the reason, and its place and smallest height.
 * A card that is only partly empty passes `useScopeUnavailable(title)` as the `empty` of its own `ChartFrame`.
 */
export function ScopeUnavailableCard({ item }: { item: CardItem }): ReactElement {
  const title = cardName(item);
  const { title: heading, reason } = useScopeUnavailable(title);
  return (
    <section
      data-slot="scope-unavailable-card"
      className={cn(
        'flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-4',
        cardMinHeight(item.type),
      )}
    >
      <h2 className="type-section-title">{title}</h2>
      <div className="my-auto flex flex-col items-center gap-1 py-6 text-center">
        <p className="type-subsection-title">{heading}</p>
        <p className="max-w-md type-body text-foreground-secondary">{reason}</p>
      </div>
    </section>
  );
}
