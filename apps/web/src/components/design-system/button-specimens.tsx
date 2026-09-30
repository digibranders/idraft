'use client';

import { Download, Ellipsis, Plus, Search, Settings, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { SpecimenGroup, SpecimenRow } from './specimen';
import { Button } from '@/components/ui/button';
import type { ButtonVariant } from '@/components/ui/button-variants';
import { IconButton } from '@/components/ui/icon-button';
import { Tabs, TabsPanel } from '@/components/ui/tabs';

const VARIANTS: readonly ButtonVariant[] = [
  'primary',
  'secondary',
  'subtle',
  'ghost',
  'destructive',
  'destructive-solid',
  'link',
];
const LABEL: Readonly<Record<ButtonVariant, string>> = {
  primary: 'Add keywords',
  secondary: 'Export CSV',
  subtle: 'Load more',
  ghost: 'Discard',
  destructive: 'Remove competitor',
  'destructive-solid': 'Delete project',
  link: 'View all 48',
};

type Section = 'overview' | 'serp' | 'competitors';
type Mode = 'rank' | 'visibility';

/** The examples of the buttons section that need a handler or state, so they render on the client. */
export function ButtonSpecimens(): ReactNode {
  const [section, setSection] = useState<Section>('overview');
  const [mode, setMode] = useState<Mode>('rank');
  return (
    <>
      <SpecimenGroup title="Button variants" note="09 section 2.3. One primary per region.">
        {VARIANTS.map((variant) => (
          <SpecimenRow key={variant} label={variant}>
            <Button variant={variant}>{LABEL[variant]}</Button>
            <Button variant={variant} icon={Plus}>
              {LABEL[variant]}
            </Button>
            <Button variant={variant} disabled>
              {LABEL[variant]}
            </Button>
            <Button variant={variant} loading>
              {LABEL[variant]}
            </Button>
            <Button variant={variant} loading icon={Plus}>
              {LABEL[variant]}
            </Button>
          </SpecimenRow>
        ))}
      </SpecimenGroup>

      <SpecimenGroup title="Button sizes" note="32, 36 and 40 px. The label is 14 px at every size.">
        <SpecimenRow label="sm">
          <Button size="sm">Columns</Button>
          <Button size="sm" icon={Download}>
            Export
          </Button>
          <Button size="sm" variant="primary">
            Apply
          </Button>
        </SpecimenRow>
        <SpecimenRow label="md (default)">
          <Button>Import</Button>
          <Button icon={Download}>Export CSV</Button>
          <Button variant="primary" icon={Plus}>
            Add keywords
          </Button>
        </SpecimenRow>
        <SpecimenRow label="lg (auth, onboarding)">
          <Button size="lg" variant="primary">
            Sign in
          </Button>
          <Button size="lg">Back</Button>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Disabled with a reason" note="Stays focusable, and a tooltip says why.">
        <SpecimenRow label="focusableWhenDisabled">
          <Button disabled focusableWhenDisabled>
            Archive
          </Button>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Icon button" note="09 section 3. Ghost by default; the tooltip repeats the name.">
        <SpecimenRow label="icon-xs, icon-sm, icon">
          <IconButton icon={X} label="Clear search" size="icon-xs" />
          <IconButton icon={Ellipsis} label="More actions" />
          <IconButton icon={Search} label="Search" size="icon" shortcut={['mod', 'k']} />
        </SpecimenRow>
        <SpecimenRow label="Top bar (18 px icon)">
          <IconButton icon={Settings} label="Settings" size="icon" iconSize="md" tooltipSide="bottom" />
        </SpecimenRow>
        <SpecimenRow label="Variants">
          <IconButton icon={Ellipsis} label="More actions" variant="secondary" />
          <IconButton icon={Trash2} label="Delete keyword" variant="destructive" />
          <IconButton icon={X} label="Close" disabled />
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Tabs" note="09 section 12. Underline for pages and inspectors, segmented inside panels.">
        <div className="flex w-full max-w-form flex-col gap-4">
          <Tabs
            variant="underline"
            label="Keyword sections"
            value={section}
            onValueChange={setSection}
            items={[
              { value: 'overview', label: 'Overview' },
              { value: 'serp', label: 'SERP history', count: '12' },
              { value: 'competitors', label: 'Competitors', count: '4' },
            ]}
          >
            <TabsPanel value="overview" className="pt-3 type-body">
              Rank over time
            </TabsPanel>
            <TabsPanel value="serp" className="pt-3 type-body">
              Twelve snapshots
            </TabsPanel>
            <TabsPanel value="competitors" className="pt-3 type-body">
              Four competitors
            </TabsPanel>
          </Tabs>
          <Tabs
            variant="segmented"
            label="Chart mode"
            value={mode}
            onValueChange={setMode}
            items={[
              { value: 'rank', label: 'Rank' },
              { value: 'visibility', label: 'Visibility' },
            ]}
          >
            <TabsPanel value="rank" className="pt-3 type-body">
              Rank chart
            </TabsPanel>
            <TabsPanel value="visibility" className="pt-3 type-body">
              Visibility chart
            </TabsPanel>
          </Tabs>
        </div>
      </SpecimenGroup>
    </>
  );
}
