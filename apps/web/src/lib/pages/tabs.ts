export type PagesTabId = 'overview' | 'all' | 'monitoring';

/** `path` is the part after `/seo/pages`. */
export interface PagesTab {
  id: PagesTabId;
  path: '' | '/all' | '/performance';
  status: 'live' | 'planned';
}

/** Monitoring turns `live` the day the Monitoring session adds its route; nothing else changes. */
export const PAGES_TABS: readonly PagesTab[] = [
  { id: 'overview', path: '', status: 'live' },
  { id: 'all', path: '/all', status: 'live' },
  { id: 'monitoring', path: '/performance', status: 'planned' },
];

export const livePagesTabs = (): readonly PagesTab[] => PAGES_TABS.filter((tab) => tab.status === 'live');
