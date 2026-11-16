'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useOverview } from '../overview-context';
import { singlePlatform } from '../scope/scope-model';
import { ChartFrame, type ChartEmpty } from '@/components/app/chart/chart-frame';
import { cardName, type CardItem } from '@/lib/layouts';

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
 * The whole card of a type that has nothing for the scope: its name and the reason in the card's own frame, which
 * fills the cell the layout gives it (place and smallest height). A card that is only partly empty passes
 * `useScopeUnavailable(title)` as the `empty` of its own `ChartFrame`.
 */
export function ScopeUnavailableCard({ item }: { item: CardItem }): ReactElement {
  const title = cardName(item);
  const empty = useScopeUnavailable(title);
  return (
    <ChartFrame
      kind="html"
      variant="panel"
      status="empty"
      empty={empty}
      title={title}
      height={180}
      summary={empty.reason}
      body={null}
      table={null}
    />
  );
}
