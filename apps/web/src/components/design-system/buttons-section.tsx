'use client';

import { Download, Ellipsis, Plus, Search, Settings, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { SpecimenGroup, SpecimenRow } from './specimen';
import { Button } from '@/components/ui/button';
import type { ButtonVariant } from '@/components/ui/button-variants';
import { IconButton } from '@/components/ui/icon-button';

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

export function ButtonsSection(): ReactNode {
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
    </>
  );
}
