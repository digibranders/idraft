'use client';

import type { ReactNode } from 'react';

import { SpecimenGroup, SpecimenRow } from './specimen';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

const EXPORT_DELAY_MS = 2500;

export function FeedbackSection(): ReactNode {
  return (
    <>
      <SpecimenGroup title="Spinner" note="21 section 8.2. Always beside text; stands still under reduced motion.">
        <SpecimenRow label="sm, md">
          <span className="flex items-center gap-2 type-body">
            <Spinner size="sm" /> Checking
          </span>
          <span className="flex items-center gap-2 type-body">
            <Spinner /> Updating
          </span>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Skeleton" note="17 section 3. Pulses, never shimmers.">
        <SpecimenRow label="text-14, text-13, text-12">
          <div className="flex w-64 flex-col gap-1">
            <Skeleton shape="text-14" widthPct={72} />
            <Skeleton shape="text-13" widthPct={56} />
            <Skeleton shape="text-12" widthPct={48} />
          </div>
        </SpecimenRow>
        <SpecimenRow label="badge, sparkline">
          <Skeleton shape="badge" />
          <Skeleton shape="sparkline" />
        </SpecimenRow>
        <SpecimenRow label="block (row, chart-140)">
          <div className="flex w-64 flex-col gap-2">
            <Skeleton shape="block" />
            <Skeleton shape="block" height="chart-140" />
          </div>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Toast" note="18 section 3. Three visible at most; errors and toasts with an action stay.">
        <SpecimenRow label="Success, info, error, action, progress">
          <Button size="sm" onClick={() => toast({ type: 'success', title: 'Competitor added: HubSpot' })}>
            Success
          </Button>
          <Button
            size="sm"
            onClick={() => toast({ type: 'info', title: 'Too many requests', description: 'Retrying in 12 seconds' })}
          >
            Info
          </Button>
          <Button
            size="sm"
            onClick={() =>
              toast({
                type: 'error',
                title: 'Import failed: file has no keyword column',
                description: 'Choose a file with a column named keyword, then import again.',
              })
            }
          >
            Error
          </Button>
          <Button
            size="sm"
            onClick={() =>
              toast({
                type: 'success',
                title: '12 keywords archived',
                action: { label: 'Undo', onAction: () => undefined },
              })
            }
          >
            With Undo
          </Button>
          <Button
            size="sm"
            onClick={() => {
              toast({ id: 'export', type: 'progress', title: 'Preparing export' });
              setTimeout(
                () =>
                  toast({
                    id: 'export',
                    type: 'success',
                    title: 'Export ready: rankings.csv',
                    action: { label: 'Download', onAction: () => undefined },
                  }),
                EXPORT_DELAY_MS,
              );
            }}
          >
            Progress
          </Button>
        </SpecimenRow>
      </SpecimenGroup>
    </>
  );
}
