import { Bell, ChevronRight, Globe, Search, Settings } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { SpecimenGroup, SpecimenRow } from './specimen';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon, type IconSize } from '@/components/ui/icon';
import { Kbd } from '@/components/ui/kbd';
import { LinkButton } from '@/components/ui/link-button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { TextLink } from '@/components/ui/text-link';
import { Tooltip } from '@/components/ui/tooltip';
import { Truncate } from '@/components/ui/truncate';

const ICON_SIZES: readonly [IconSize, string][] = [
  ['xs', '12 px, stroke 1.5'],
  ['sm', '14 px'],
  ['default', '16 px'],
  ['md', '18 px'],
  ['lg', '20 px, stroke 1.5'],
];
const NOTIFICATIONS = Array.from({ length: 24 }, (_, index) => `Rank change on keyword ${index + 1}`);

export function DisplaySection(): ReactNode {
  return (
    <>
      <SpecimenGroup title="Icon" note="07 section 2. Size and stroke are fixed by the wrapper.">
        {ICON_SIZES.map(([size, note]) => (
          <SpecimenRow key={size} label={`${size} (${note})`}>
            <Icon icon={Search} size={size} />
            <Icon icon={Bell} size={size} />
            <Icon icon={Globe} size={size} />
            <Icon icon={ChevronRight} size={size} />
          </SpecimenRow>
        ))}
      </SpecimenGroup>

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

      <SpecimenGroup title="Avatar" note="11 section 4. Decorative: the name is always beside it.">
        <SpecimenRow label="md, sm">
          <span className="flex items-center gap-2 type-body">
            <Avatar name="Ana Brandt" /> Ana Brandt
          </span>
          <span className="flex items-center gap-2 type-body">
            <Avatar name="Tomás Rivera" size="sm" /> Tomás Rivera
          </span>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Kbd" note="09 section 11. Glyphs on a Mac, words elsewhere.">
        <SpecimenRow label="Combination, single key">
          <Kbd keys={['mod', 'k']} />
          <Kbd keys={['shift', 'f10']} />
          <Kbd keys={['/']} />
          <Kbd keys={['esc']} />
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Separator" note="06 section 5.">
        <SpecimenRow label="Horizontal, subtle and default">
          <div className="flex w-64 flex-col gap-3">
            <Separator />
            <Separator tone="default" />
          </div>
        </SpecimenRow>
        <SpecimenRow label="Vertical in a toolbar">
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost">
              Columns
            </Button>
            <Separator orientation="vertical" className="h-6 self-center" />
            <Button size="sm" variant="ghost">
              Export
            </Button>
          </div>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup
        title="Text link"
        note="Underlined at rest in a sentence; on hover and focus when it stands alone."
      >
        <SpecimenRow label="inline, standalone, inherit">
          <p className="type-body">
            Rates use the{' '}
            <TextLink href="#display" variant="inline">
              Wilson interval
            </TextLink>
            .
          </p>
          <TextLink href="#display" className="type-body">
            View all 20 competitors
          </TextLink>
          <p className="type-meta">
            <TextLink href="#display" tone="inherit">
              All projects
            </TextLink>
          </p>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup
        title="Link button"
        note="09 section 2.7. Navigates, so it stays a link. Rendered by a Server Component."
      >
        <SpecimenRow label="primary, sm with icon">
          <LinkButton variant="primary" render={<Link href="/design-system/buttons" />}>
            Open project
          </LinkButton>
          <LinkButton size="sm" icon={Settings} render={<Link href="/design-system/buttons" />}>
            Settings
          </LinkButton>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Truncate" note="The tooltip appears only when the text is cut.">
        <SpecimenRow label="Fits, cut, shortened in the middle">
          <div className="w-40 type-table">
            <Truncate text="crm pricing" />
          </div>
          <div className="w-40 type-table">
            <Truncate text="What is the best CRM for a 20-person startup that sells to enterprises?" />
          </div>
          <div className="w-56 type-mono">
            <Truncate text="/blog/2026/guides/how-to-choose-a-crm" display="/blog/…/how-to-choose-a-crm" />
          </div>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Tooltip" note="16 section 6.1. Opens after 400 ms, on hover and on focus.">
        <SpecimenRow label="Text, detail, shortcut, below, right, on a badge">
          <Tooltip content="Volume-weighted visibility">
            <Button size="sm">One line</Button>
          </Tooltip>
          <Tooltip content="34%" detail="612 of 1,800 responses">
            <Button size="sm">With detail</Button>
          </Tooltip>
          <Tooltip content="Search" shortcut={['mod', 'k']}>
            <Button size="sm">With shortcut</Button>
          </Tooltip>
          <Tooltip content="Opens below the trigger" side="bottom">
            <Button size="sm">Below</Button>
          </Tooltip>
          <Tooltip content="Opens beside the trigger" side="right">
            <Button size="sm">Right</Button>
          </Tooltip>
          <Tooltip content="Modeled from a sample of 40 responses">
            <Badge tone="info">Estimate</Badge>
          </Tooltip>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Scroll area" note="16 section 5.1. A thin scrollbar in border-strong.">
        <SpecimenRow label="fill, 24 items">
          <div className="h-40 w-64 rounded-lg border border-border">
            <ScrollArea maxHeight="fill" label="Notifications">
              <ul className="flex flex-col p-1">
                {NOTIFICATIONS.map((text) => (
                  <li key={text} className="flex h-control-sm items-center px-2 type-body">
                    {text}
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>
        </SpecimenRow>
      </SpecimenGroup>
    </>
  );
}
