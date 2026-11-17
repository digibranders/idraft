'use client';

import { useTranslations } from 'next-intl';
import { useId, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import type { LayoutMode } from '@/lib/internal-links/journey-codec';
import { UNTIERED_POSITION } from '@/lib/internal-links/tiers';

/** "By step | By tier": the two layouts of the journey canvas (spec 7.5 "Two layouts"). */
export function LayoutSwitch({
  value,
  onChange,
}: {
  value: LayoutMode;
  onChange: (value: LayoutMode) => void;
}): ReactElement {
  const t = useTranslations('linkCanvas.layout');
  return (
    <SegmentedControl<LayoutMode>
      semantics="view"
      label={t('label')}
      value={value}
      onValueChange={(next) => onChange(next)}
      items={[
        { value: 'step', label: t('step') },
        { value: 'tier', label: t('tier') },
      ]}
      size="sm"
    />
  );
}

export interface LaneChipTier {
  position: number;
  code: string;
  name: string;
}

/**
 * One chip for each tier and for Untiered: pressed while its lane is shown. The lane of the focus page cannot be turned
 * off, so its chip is pressed and disabled whatever the address says, and a hidden description gives the reason.
 */
export function LaneChips({
  tiers,
  hidden,
  focusPosition,
  onToggle,
}: {
  tiers: readonly LaneChipTier[];
  hidden: ReadonlySet<number>;
  focusPosition: number;
  onToggle: (position: number) => void;
}): ReactElement {
  const t = useTranslations('linkCanvas');
  const reason = useId();
  // The order of the lanes, left to right: Untiered, then the lowest tier up to T1
  const chips = [
    { position: UNTIERED_POSITION, code: t('untiered'), label: t('untiered') },
    ...[...tiers]
      .filter((tier) => tier.position !== UNTIERED_POSITION)
      .sort((a, b) => b.position - a.position)
      .map((tier) => ({ position: tier.position, code: tier.code, label: `${tier.code} ${tier.name}` })),
  ];
  return (
    <div role="group" aria-label={t('lanes.label')} className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => {
        const locked = chip.position === focusPosition;
        return (
          <Button
            key={chip.position}
            size="sm"
            aria-pressed={locked || !hidden.has(chip.position)}
            aria-label={chip.label}
            aria-describedby={locked ? reason : undefined}
            disabled={locked}
            onClick={() => onToggle(chip.position)}
          >
            {chip.code}
          </Button>
        );
      })}
      <span id={reason} className="sr-only">
        {t('lanes.focusLocked')}
      </span>
    </div>
  );
}
