import type { ReactElement } from 'react';

import { SpecimenGroup, SpecimenRow } from './specimen';
import { TierBadge } from '@/components/app/tier/tier-badge';

const TIERS = [
  { code: 'T1', name: 'Money pages' },
  { code: 'T2', name: 'Supporting pages' },
  { code: 'T3', name: 'Content pages' },
  { code: 'T4', name: 'Utility pages' },
  { code: 'T5', name: 'Campaign pages' },
  { code: 'T6', name: 'Archive' },
  { code: 'T7', name: 'Legal' },
  { code: 'T8', name: 'Other' },
];

/** Internal links (spec 7.9): the tier badge, and in Task 4 the link card and the canvas. */
export function LinkCanvasSection(): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <SpecimenGroup
        title="TierBadge"
        note="Code only in tables and cards; code and name in filters and the inspector."
      >
        <SpecimenRow label="Code">
          {TIERS.map((tier) => (
            <TierBadge key={tier.code} tier={tier} />
          ))}
          <TierBadge tier={null} />
        </SpecimenRow>
        <SpecimenRow label="Code and name">
          {TIERS.slice(0, 4).map((tier) => (
            <TierBadge key={tier.code} tier={tier} withName />
          ))}
          <TierBadge tier={null} withName />
        </SpecimenRow>
      </SpecimenGroup>
    </div>
  );
}
