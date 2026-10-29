'use client';

import {
  Bell,
  CalendarBlank,
  CaretDown,
  ChatCircle,
  ChatCircleText,
  Compass,
  FileText,
  GearSix,
  Globe,
  ListNumbers,
  MagnifyingGlass,
  MapPin,
  Plugs,
  Quotes,
  SquaresFour,
  Table,
  Users,
  type Icon,
} from '@phosphor-icons/react';

export type MockView = 'keywords' | 'ai' | 'matrix' | 'sources';

type NavItem = { label: string; icon: Icon; view?: MockView; badge?: string };

// The navigation of the real product (apps/web design preview). Only four entries open a view in this mock.
const NAV: readonly { group?: string; items: readonly NavItem[] }[] = [
  { items: [{ label: 'Overview', icon: SquaresFour }, { label: 'Matrix', icon: Table, view: 'matrix' }] },
  { group: 'SEO', items: [{ label: 'Keywords', icon: ListNumbers, view: 'keywords' }, { label: 'Pages', icon: FileText }] },
  {
    group: 'AI Visibility',
    items: [
      { label: 'Overview', icon: ChatCircleText },
      { label: 'Topics & Prompts', icon: ChatCircle, view: 'ai' },
      { label: 'Citations', icon: Quotes },
      { label: 'Sources', icon: Globe, view: 'sources' },
    ],
  },
  { items: [{ label: 'Competitors', icon: Users }, { label: 'Discover', icon: Compass, badge: '24' }] },
  { items: [{ label: 'Integrations', icon: Plugs }, { label: 'Settings', icon: GearSix }] },
];

const TITLES: Record<MockView, string> = { keywords: 'Keywords', ai: 'Topics & Prompts', matrix: 'Matrix', sources: 'Sources' };

type AppFrameProps = {
  view: MockView;
  onNavigate?: (view: MockView) => void;
  children: React.ReactNode;
  /** Hide the sidebar for small embeds. */
  compact?: boolean;
};

/**
 * The product shell: project switcher and navigation on the left, a top bar with search, date range and
 * location. It follows the real app so the page shows the product as it is, not a stylised stand-in.
 */
export function AppFrame({ view, onNavigate, children, compact = false }: AppFrameProps) {
  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden rounded-[inherit] bg-paper text-[13px] text-ink">
      {compact ? null : (
        <aside className="hidden w-[188px] shrink-0 flex-col gap-3 border-r border-line bg-[#F2F3F5] px-2 py-3 md:flex">
          <div className="flex items-center gap-2 px-2 py-1">
            <span className="grid size-6 place-items-center rounded-md bg-ink text-[12px] font-semibold text-white">i</span>
            <span className="font-semibold tracking-[-0.01em]">idraft</span>
            <CaretDown size={12} weight="bold" aria-hidden="true" className="ml-auto text-ink-3" />
          </div>
          <nav aria-label="Product mock navigation" className="flex flex-1 flex-col gap-2.5 overflow-hidden">
            {NAV.map((section, index) => (
              <div key={section.group ?? index} className="flex flex-col gap-0.5">
                {section.group ? <p className="px-2 pt-1 pb-0.5 text-[11px] text-ink-3">{section.group}</p> : null}
                {section.items.map((item) => {
                  const Glyph = item.icon;
                  const active = item.view === view;
                  const className = `flex w-full items-center gap-2.5 rounded-md px-2 py-[5px] text-left transition-colors duration-200 ${active ? 'bg-wash font-medium text-cobalt-deep' : 'text-ink-2'} ${item.view ? 'cursor-pointer hover:bg-ink/5' : 'cursor-default'}`;
                  const inner = (
                    <>
                      <Glyph size={16} weight={active ? 'fill' : 'regular'} aria-hidden="true" />
                      {item.label}
                      {item.badge ? <span className="ml-auto rounded bg-ink/5 px-1.5 text-[11px] text-ink-2">{item.badge}</span> : null}
                    </>
                  );
                  return item.view && onNavigate ? (
                    <button key={item.label} type="button" onClick={() => onNavigate(item.view as MockView)} aria-current={active ? 'page' : undefined} className={className}>
                      {inner}
                    </button>
                  ) : (
                    <div key={item.label} className={className}>
                      {inner}
                    </div>
                  );
                })}
              </div>
            ))}
          </nav>
          <p className="px-2 text-[11px] text-ink-3">Last run 06:12 · 1,000 keywords</p>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[46px] shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
          <p className="hidden min-w-0 truncate text-ink-3 sm:block">
            idraft <span aria-hidden="true">/</span> <span className="font-medium text-ink">{TITLES[view]}</span>
          </p>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden h-7 w-44 items-center gap-2 rounded-md bg-surface px-2.5 text-ink-3 ring-1 ring-ink/10 lg:flex">
              <MagnifyingGlass size={13} aria-hidden="true" />
              Search
              <kbd className="ml-auto rounded bg-ink/5 px-1 text-[10px]">⌘K</kbd>
            </span>
            <span className="hidden h-7 items-center gap-1.5 rounded-md px-2.5 ring-1 ring-ink/10 md:flex">
              <CalendarBlank size={13} aria-hidden="true" />
              Last 28 days
            </span>
            <span className="hidden h-7 items-center gap-1.5 rounded-md px-2.5 ring-1 ring-ink/10 md:flex">
              <MapPin size={13} aria-hidden="true" />
              United States
            </span>
            <Bell size={15} aria-hidden="true" className="text-ink-3" />
            <span className="grid size-6 place-items-center rounded-full bg-ink/10 text-[10px] font-medium">AB</span>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
