'use client';

import type { ReactNode } from 'react';

import { SpecimenGroup } from './specimen';

/** The domain and URL cells, the count popover, the change feed and the inspector stepping of WP-08. */
export function DomainsFeedsSection(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <SpecimenGroup title="Domains, feeds and stepping" note="23-application-patterns.md sections 4.4, 9.2 and 9.3">
        <p className="type-body">
          The domain cell, the URL cell, the count popover, the change feed and the stepping are shown here as each one
          is built.
        </p>
      </SpecimenGroup>
    </div>
  );
}
