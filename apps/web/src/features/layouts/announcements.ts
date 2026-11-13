'use client';

/**
 * Every word the layout screens say to a screen reader (docs/superpowers/plans/2026-11-13-ai-wp-15-layouts-core.md,
 * section 2.8): one function per key of `layouts.core.announce`, all through the one polite live region and under
 * one key, so a newer message replaces an older one that is still waiting.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { announce } from '@/lib/a11y/announcer';
import type { Width } from '@/lib/layouts';

const ANNOUNCE_KEY = 'layouts';

/** The `layouts.core.widths` key of each width. */
const WIDTH_KEY = { third: 'third', half: 'half', two_thirds: 'twoThirds', full: 'full' } as const satisfies Record<
  Width,
  string
>;

interface Place {
  card: string;
  /** 1 based. */
  position: number;
  total: number;
}

export interface LayoutAnnouncer {
  pickedUp(card: string): void;
  over(place: Place & { row: number }): void;
  overGap(place: { card: string; row: number }): void;
  first(card: string): void;
  last(card: string): void;
  dropped(place: Place): void;
  putBack(card: string): void;
  moved(place: Place): void;
  hidden(card: string): void;
  width(change: { card: string; width: Width }): void;
  option(change: { card: string; option: string; value: string }): void;
  added(place: Place): void;
  entered(screen: string): void;
  undone(): void;
  redone(): void;
  saved(): void;
  /** Any other sentence of the layout screens (a preset applied, a team default saved), on the same region. */
  say(message: string): void;
}

export function useLayoutAnnouncer(): LayoutAnnouncer {
  const t = useTranslations('layouts.core');
  return useMemo(() => {
    const say = (message: string): void => {
      announce(message, { key: ANNOUNCE_KEY });
    };
    return {
      say,
      pickedUp: (card) => {
        say(t('announce.pickedUp', { card }));
      },
      over: ({ card, position, total, row }) => {
        say(t('announce.over', { card, position, total, row }));
      },
      overGap: ({ card, row }) => {
        say(t('announce.overGap', { card, row }));
      },
      first: (card) => {
        say(t('announce.first', { card }));
      },
      last: (card) => {
        say(t('announce.last', { card }));
      },
      dropped: ({ card, position, total }) => {
        say(t('announce.dropped', { card, position, total }));
      },
      putBack: (card) => {
        say(t('announce.putBack', { card }));
      },
      moved: ({ card, position, total }) => {
        say(t('announce.moved', { card, position, total }));
      },
      hidden: (card) => {
        say(t('announce.hidden', { card }));
      },
      width: ({ card, width }) => {
        say(t('announce.width', { card, width: t(`widths.${WIDTH_KEY[width]}`) }));
      },
      option: ({ card, option, value }) => {
        say(t('announce.option', { card, option, value }));
      },
      added: ({ card, position, total }) => {
        say(t('announce.added', { card, position, total }));
      },
      entered: (screen) => {
        say(t('announce.entered', { screen }));
      },
      undone: () => {
        say(t('announce.undone'));
      },
      redone: () => {
        say(t('announce.redone'));
      },
      saved: () => {
        say(t('announce.saved'));
      },
    };
  }, [t]);
}
