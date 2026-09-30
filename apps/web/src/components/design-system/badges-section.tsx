import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import { SpecimenGroup, SpecimenRow } from './specimen';
import { Badge } from '@/components/ui/badge';

export function BadgesSection(): ReactNode {
  return (
    <>
      <SpecimenGroup title="Badge" note="14 section 1. 22 px, never a pill, never wrapping.">
        <SpecimenRow label="neutral">
          <Badge>Commercial</Badge>
          <Badge variant="outline">Core panel</Badge>
          <Badge variant="text">Question</Badge>
        </SpecimenRow>
        <SpecimenRow label="positive">
          <Badge tone="positive" icon={Check}>
            Cited
          </Badge>
          <Badge tone="positive" variant="outline">
            Owned
          </Badge>
          <Badge tone="positive" variant="text">
            New
          </Badge>
        </SpecimenRow>
        <SpecimenRow label="negative">
          <Badge tone="negative">Lost</Badge>
          <Badge tone="negative" variant="outline">
            Failed
          </Badge>
          <Badge tone="negative" variant="text">
            Lost
          </Badge>
        </SpecimenRow>
        <SpecimenRow label="warning">
          <Badge tone="warning">Stale</Badge>
          <Badge tone="warning" variant="text">
            Stale
          </Badge>
        </SpecimenRow>
        <SpecimenRow label="info">
          <Badge tone="info">Estimate</Badge>
          <Badge tone="info" variant="text">
            Estimate
          </Badge>
        </SpecimenRow>
      </SpecimenGroup>
    </>
  );
}
