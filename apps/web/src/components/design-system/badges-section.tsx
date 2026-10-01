import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import { SpecimenGroup, SpecimenRow } from './specimen';
import { EvidenceHighlight } from '@/components/app/evidence/evidence-highlight';
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

      <SpecimenGroup
        title="Mention highlight"
        note="23 section 5.3. Own brand in the accent tints; others in their chart color at 18% with a 2 px edge."
      >
        <SpecimenRow label="Own, competitor, uncertain, past the sixth">
          <p className="max-w-reading type-prose">
            For a ten-person agency,{' '}
            <EvidenceHighlight
              entity={{ name: 'Fynix', own: true, colorIndex: 1 }}
              matchLabel="word boundary match"
              confidence={0.95}
              certainty="certain"
            >
              Fynix
            </EvidenceHighlight>{' '}
            and{' '}
            <EvidenceHighlight
              entity={{ name: 'Northwind', own: false, colorIndex: 3 }}
              matchLabel="word boundary match"
              confidence={0.95}
              certainty="certain"
            >
              Northwind Studio
            </EvidenceHighlight>{' '}
            are the usual picks, while{' '}
            <EvidenceHighlight
              entity={{ name: 'Orbit', own: false, colorIndex: 4 }}
              matchLabel="word boundary match"
              confidence={0.42}
              certainty="uncertain"
            >
              orbit
            </EvidenceHighlight>{' '}
            and{' '}
            <EvidenceHighlight
              entity={{ name: 'HubSpot', own: false, colorIndex: null }}
              matchLabel="word boundary match"
              confidence={0.9}
              certainty="certain"
              viaProduct="Sales Hub"
            >
              Sales Hub
            </EvidenceHighlight>{' '}
            come up for larger teams.
          </p>
        </SpecimenRow>
      </SpecimenGroup>
    </>
  );
}
