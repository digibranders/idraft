export type PagesTabId = 'overview' | 'all' | 'monitoring';

/** `path` is the part after `/seo/pages`. */
export interface PagesTab {
  id: PagesTabId;
  path: '' | '/all' | '/monitoring';
  status: 'live' | 'planned';
}

export const PAGES_TABS: readonly PagesTab[] = [
  { id: 'overview', path: '', status: 'live' },
  { id: 'all', path: '/all', status: 'live' },
  { id: 'monitoring', path: '/monitoring', status: 'live' },
];

export const livePagesTabs = (): readonly PagesTab[] => PAGES_TABS.filter((tab) => tab.status === 'live');
