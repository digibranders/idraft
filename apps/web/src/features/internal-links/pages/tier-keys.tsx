'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { usePageShortcuts } from '@/components/app/shell/page-shortcuts';
import { useShortcut } from '@/lib/a11y/use-shortcut';
import type { PageTier } from '@/lib/internal-links/types';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8'] as const;

/** One key: a component per key, so each `useShortcut` is a hook of its own (decision W20). */
function TierKey({ digit, enabled, onPress }: { digit: string; enabled: boolean; onPress: () => void }): null {
  // A key held down repeats: only the first press acts, so a failing change is not sent again on every repeat
  useShortcut(
    digit,
    (event) => {
      if (!event.repeat) onPress();
    },
    { kind: 'single-key', enabled },
  );
  return null;
}

/**
 * Keys 1 to 8 set the selection's tier by its position and 0 sets Untiered (spec 5.2), while rows are selected and
 * the person may write. They follow the single-key switch through `useShortcut` (never while typing, never with a
 * dialog or menu open) and are listed in the shortcuts dialog. A key beyond the workspace's tiers does nothing.
 */
export function TierKeys({
  tiers,
  listed,
  enabled,
  onTier,
}: {
  tiers: readonly PageTier[];
  /** The person may write: the keys are in the shortcuts dialog, whether or not rows are selected. */
  listed: boolean;
  /** Rows are selected and nothing is being saved: the keys act. */
  enabled: boolean;
  onTier: (tier: PageTier | null) => void;
}): ReactElement {
  const t = useTranslations('internalLinks.bulk');
  const entries = useMemo(
    () =>
      listed
        ? [
            { id: 'internal-links-tier', label: t('keysTier'), keys: ['1', '8'] },
            { id: 'internal-links-untiered', label: t('keysUntiered'), keys: ['0'] },
          ]
        : [],
    [listed, t],
  );
  usePageShortcuts(entries);
  return (
    <>
      {DIGITS.map((digit) => {
        const tier = digit === '0' ? null : (tiers.find((candidate) => candidate.position === Number(digit)) ?? null);
        return (
          <TierKey
            key={digit}
            digit={digit}
            enabled={enabled && (digit === '0' || tier !== null)}
            onPress={() => onTier(tier)}
          />
        );
      })}
    </>
  );
}
