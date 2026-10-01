'use client';

import { useState, type ReactNode } from 'react';

import { SpecimenGroup } from './specimen';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { MetricStrip, type MetricStripGroup } from '@/components/app/metric/metric-strip';
import { CollectionProgress } from '@/components/app/status/collection-progress';
import { Button } from '@/components/ui/button';
import { StepperDialog } from '@/components/ui/stepper-dialog';
import type { CategorySeries } from '@/lib/charts/category-chart';
import { formatInteger } from '@/lib/format';

const STRIP: MetricStripGroup[] = [
  {
    id: 'seo',
    items: [
      { id: 'tracked', label: 'Tracked keywords', value: '986', context: '12 archived' },
      { id: 'volume', label: 'Search volume', value: '48,210', delta: '+4%', context: 'per month, Google Ads' },
      { id: 'kd', label: 'Average KD', value: '41', context: '972 of 986 measured' },
      {
        id: 'pending',
        label: 'Metrics pending',
        value: 'Insufficient data',
        unknown: { kind: 'insufficient' },
        context: '14 new keywords',
      },
    ],
  },
  { id: 'cost', items: [{ id: 'cost', label: 'Metrics cost this month', value: '$12.40', context: 'of $50.00' }] },
];

const MONTHS = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
const VOLUME: CategorySeries[] = [
  {
    id: 'volume',
    name: 'Search volume',
    role: { kind: 'brand' },
    values: [6600, 7400, 5400, 8100, 8100, 9900, 8100, 8100, 6600, null, 8100, 9900],
  },
  {
    id: 'previous',
    name: 'Previous year',
    role: { kind: 'reference' },
    values: [5400, 6600, 4400, 6600, 6600, 8100, 6600, 6600, 5400, 6600, 6600, 8100],
  },
];
const COMPETITORS: CategorySeries[] = [
  { id: 'you', name: 'You', role: { kind: 'brand' }, values: [12, 15, 18, 21] },
  { id: 'hubspot', name: 'hubspot.com', role: { kind: 'palette', index: 2 }, values: [22, 21, 23, 24] },
  { id: 'pipedrive', name: 'pipedrive.com', role: { kind: 'palette', index: 3 }, values: [9, 11, 10, 12] },
];
const STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'map', label: 'Map columns' },
  { id: 'review', label: 'Review' },
  { id: 'confirm', label: 'Confirm' },
] as const;
type Step = (typeof STEPS)[number]['id'];

function StepperSpecimen(): ReactNode {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<Step>('upload');
  const [completed, setCompleted] = useState<ReadonlySet<Step>>(new Set());
  return (
    <>
      <Button
        onClick={() => {
          setCurrent('upload');
          setCompleted(new Set());
          setOpen(true);
        }}
      >
        Import keywords
      </Button>
      <StepperDialog<Step>
        open={open}
        onOpenChange={setOpen}
        title="Import keywords"
        steps={STEPS}
        current={current}
        completed={completed}
        onStepChange={setCurrent}
        onContinue={() => {
          setCompleted((done) => new Set([...done, current]));
          if (current === 'confirm') setOpen(false);
          return Promise.resolve('ok');
        }}
        finalLabel="Import 1,204 keywords"
        labels={{
          steps: 'Import steps',
          close: 'Close',
          back: 'Back',
          cancel: 'Cancel',
          continue: 'Continue',
          completed: 'completed',
        }}
        discard={{
          title: 'Discard this import?',
          description: 'The file and the column mapping are not kept.',
          keepEditingLabel: 'Keep editing',
          discardLabel: 'Discard',
        }}
      >
        <p className="type-body text-foreground-secondary">{`The ${current} step holds its form here.`}</p>
      </StepperDialog>
    </>
  );
}

export function DataDisplaySection(): ReactNode {
  return (
    <>
      <SpecimenGroup
        title="MetricStrip"
        note="23 section 2. One panel, never cards; a stronger divider between channel groups."
      >
        <div className="flex flex-col gap-4">
          <MetricStrip size="md" label="Summary for the tracked keywords" groups={STRIP} status="ready" />
          <MetricStrip size="md" label="Summary while loading" groups={STRIP} status="loading" />
          <div className="w-100">
            <MetricStrip
              size="sm"
              label="Keyword summary"
              groups={[{ id: 'seo', items: STRIP[0]?.items.slice(0, 3) ?? [] }]}
              status="ready"
            />
          </div>
        </div>
      </SpecimenGroup>
      <SpecimenGroup
        title="ChartFrame"
        note="15 section 2. React legend that toggles series, a Table view of the same numbers, Patterns for bars."
      >
        <div className="flex flex-col gap-4">
          <ChartFrame
            title="Search volume by month"
            variant="panel"
            meta="Last 12 months · Google Ads data"
            kind="bar"
            categories={MONTHS}
            categoryHeader="Month"
            series={VOLUME}
            formatValue={formatInteger}
            height={240}
            summary="Monthly searches run from 5,400 to 9,900, higher than the previous year in every month."
            status="ready"
          />
          <ChartFrame
            title="Average rank vs competitors"
            variant="panel"
            meta="Last 4 weeks"
            kind="line"
            categories={['Week 36', 'Week 37', 'Week 38', 'Week 39']}
            categoryHeader="Week"
            series={COMPETITORS}
            formatValue={formatInteger}
            height={180}
            summary="Your average rank fell from 12 to 21 while hubspot.com stayed between 21 and 24."
            status="ready"
          />
        </div>
      </SpecimenGroup>
      <SpecimenGroup
        title="CollectionProgress"
        note="17 section 4. Compact for meta lines, standard under a page header."
      >
        <div className="flex flex-col gap-3">
          <CollectionProgress density="compact" status="running" text="Running: 412 of 1,000 keywords · 3 failed" />
          <CollectionProgress
            density="compact"
            status="completed"
            text="Completed Sep 29, 04:12 CEST: 1,000 keywords"
          />
          <CollectionProgress
            density="compact"
            status="budget_blocked"
            text="Blocked by budget: estimate $84.20, $40.00 left"
          />
          <CollectionProgress
            density="standard"
            status="running"
            text="Import running"
            counts={{ done: 412, failed: 3, total: 1000 }}
            countsText="409 done · 3 failed · 588 in flight"
            progressText="412 of 1,000 rows, 3 failed"
            meta="Started 02:00 CEST"
          />
        </div>
      </SpecimenGroup>
      <SpecimenGroup
        title="StepperDialog"
        note="16 section 4.6. Completed steps are buttons back; closing past the first step asks first."
      >
        <StepperSpecimen />
      </SpecimenGroup>
    </>
  );
}
