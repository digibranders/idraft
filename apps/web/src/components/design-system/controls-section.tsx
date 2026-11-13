'use client';

import type { ReactNode } from 'react';

import { SpecimenGroup } from './specimen';

/** The mobile list, the saved view menu and the date range picker of WP-10. */
export function ControlsSection(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <SpecimenGroup title="Lists, views and dates" note="19-responsive-behavior.md 6.7, 23-application-patterns.md 14">
        <p className="type-body">
          The mobile list, the saved view menu and the date range picker are shown here as each one is built.
        </p>
      </SpecimenGroup>
    </div>
  );
}
