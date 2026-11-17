'use client';

import { useMemo, useState, type ReactElement } from 'react';

import { SpecimenGroup, SpecimenRow } from './specimen';
import { LinkCanvas, type CanvasFocus } from '@/components/app/link-canvas/link-canvas';
import { TierBadge } from '@/components/app/tier/tier-badge';
import type { View } from '@/lib/internal-links/canvas-view';
import { buildJourney, cardKey, type JourneyNeighbor, type ListLookup } from '@/lib/internal-links/journey-layout';

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

const page = (id: string, path: string, code: string | null, over: Partial<JourneyNeighbor> = {}): JourneyNeighbor => ({
  url_id: id,
  path,
  title: path,
  status_code: 200,
  redirect_url_id: null,
  tier: code === null ? null : { code, name: code === 'T1' ? 'Money pages' : 'Content pages' },
  linking_pages: 4,
  linking_pages_all: 9,
  click_depth: 1,
  anchor: `About ${path}`,
  placement: 'content',
  scope: 'editorial',
  rel: [],
  is_followed: true,
  has_children: true,
  reciprocal: false,
  ...over,
});
const LISTS: Record<string, readonly JourneyNeighbor[]> = {
  '1|out|editorial': [
    page('2', '/pricing', 'T1', { reciprocal: true }),
    page('3', '/blog', 'T3'),
    page('7', '/old-offer', null, { status_code: 301, has_children: false }),
    page('8', '/threat-hunting', 'T1', { status_code: 404, has_children: false }),
  ],
  '2|out|editorial': [page('4', '/blog/post', 'T3'), page('1', '/', 'T3')],
  '3|out|editorial': [page('4', '/blog/post', 'T3')],
  '4|out|editorial': [page('1', '/', 'T3'), page('2', '/pricing', 'T1')],
  '1|in|editorial': [page('2', '/pricing', 'T1'), page('5', '/about', null)],
};
const OTHER = { '1|out|editorial': [{ scope: 'template' as const, pages: 9 }] };
const lookup: ListLookup<JourneyNeighbor> = ({ urlId, direction, scope }) => {
  const key = `${urlId}|${direction}|${scope}`;
  const items = LISTS[key] ?? [];
  return {
    status: 'ready',
    items,
    total: items.length,
    otherScopes: key in OTHER ? OTHER[key as keyof typeof OTHER] : [],
  };
};
const FOCUS: CanvasFocus = {
  urlId: '1',
  path: '/',
  title: 'Home',
  tier: { code: 'T3', name: 'Content pages' },
  linkingPages: 4,
  linkingPagesAll: 9,
  linksOut: 7,
  statusCode: 200,
  clickDepth: 0,
};

const toggled = (set: ReadonlySet<string>, key: string): Set<string> => {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
};

/** A live canvas: cards and groups open and close in place, so focus, edges and the back-link marker can be tried. */
function CanvasSpecimen(): ReactElement {
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<ReadonlySet<string>>(
    new Set([cardKey('out', ['2']), cardKey('out', ['3']), cardKey('out', ['2', '4'])]),
  );
  const [groups, setGroups] = useState<ReadonlySet<string>>(new Set());
  const none = (): void => undefined;
  const layout = useMemo(
    () => buildJourney({ focus: '1', scope: 'editorial', open, groups, more: new Map() }, lookup),
    [open, groups],
  );
  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface">
      <LinkCanvas
        layout={layout}
        focus={FOCUS}
        focusNote={<p className="type-meta text-foreground-tertiary">4 editorial links in.</p>}
        view={view}
        onViewChange={setView}
        pinned={pinned}
        onTogglePin={(key) => setPinned((current) => toggled(current, key))}
        onToggleCard={(key) => setOpen((current) => toggled(current, key))}
        onToggleGroup={(key) => setGroups((current) => toggled(current, key))}
        onMore={none}
        onRefocus={none}
        onDetails={none}
        onRetry={none}
        onFull={none}
        onShowLinks={(keys) => setOpen((current) => new Set([...current, ...keys]))}
        onSetTier={none}
      />
    </div>
  );
}

/** Internal links (spec 7.9): the tier badge, the link card and the canvas. */
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
      <SpecimenGroup
        title="LinkCanvas and LinkCard"
        note="Drag the background, use the wheel or Ctrl and wheel, or press the controls at the bottom left (the map button shows the map at the bottom right, the question mark the legend and keys). The focus card is wider with a primary border. Drag a card to move it, Shift or Cmd and click or Shift and drag to select (the bar offers Show their links), the i button opens a card's info panel. Cards, a stub (Also at), a group card (Menu and footer), a back-link marker (hover, focus or pin it), a redirect and a broken target."
      >
        <CanvasSpecimen />
      </SpecimenGroup>
    </div>
  );
}
