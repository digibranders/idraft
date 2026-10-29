import {
  Activity,
  Compass,
  FileChartColumn,
  FileText,
  Globe,
  Grid2x2,
  LayoutDashboard,
  ListOrdered,
  MessageSquare,
  MessageSquareText,
  Plug,
  Quote,
  Receipt,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';

import type { Route } from 'next';

import type { Permission } from '@/lib/permissions/permissions';
import { projectPath, withQuery } from '@/lib/routes/paths';

/**
 * The destinations of a project (11-navigation.md section 1.1, 16 items in 3 sections), the one list the
 * sidebar, the breadcrumb and later the command palette read. Runs and Costs are in it too: Runs is the
 * project's own, and Costs shows the whole workspace's spend but is opened from the project, so the sidebar
 * stays on screen. A destination whose screen is not built yet is `planned`: it is absent from navigation
 * and its route is the 404 page (20-frontend-specification.md section 3.10, where phase gating is this
 * registry, not a flag list from the API).
 */
export type NavKey =
  | 'overview'
  | 'matrix'
  | 'rankings'
  | 'keywords'
  | 'pages'
  | 'aiOverview'
  | 'prompts'
  | 'citations'
  | 'sources'
  | 'competitors'
  | 'discover'
  | 'reports'
  | 'integrations'
  | 'runs'
  | 'costs'
  | 'settings';

/** The labelled groups inside the first section. A group label is text, never a link. */
export type NavGroup = 'seo' | 'ai';
export type NavSectionId = 1 | 2 | 3;

export interface NavDestination {
  key: NavKey;
  /** Below the project root: `''` is Overview, `/seo/rankings` is Rankings. */
  path: '' | `/${string}`;
  /** 07-icons.md section 6. */
  icon: LucideIcon;
  section: NavSectionId;
  group: NavGroup | null;
  /** What the role needs to open it; `null` for every member. */
  permission: Permission | null;
  status: 'live' | 'planned';
  /**
   * Another project opens on this destination with the page's query (the month, the tab, the filters). Only
   * for a page whose query means the same in any project; Rankings' filters belong to one project, so it is
   * not carried.
   */
  carriesQuery?: boolean;
}

export const NAVIGATION: readonly NavDestination[] = [
  {
    key: 'overview',
    path: '',
    icon: LayoutDashboard,
    section: 1,
    group: null,
    permission: 'data:read',
    status: 'planned',
  },
  {
    key: 'matrix',
    path: '/matrix',
    icon: Grid2x2,
    section: 1,
    group: null,
    permission: 'data:read',
    status: 'planned',
  },
  {
    key: 'rankings',
    path: '/seo/rankings',
    icon: ListOrdered,
    section: 1,
    group: 'seo',
    permission: 'data:read',
    status: 'planned',
  },
  {
    key: 'keywords',
    path: '/seo/keywords',
    icon: ListOrdered,
    section: 1,
    group: 'seo',
    permission: 'data:read',
    status: 'live',
  },
  {
    key: 'pages',
    path: '/seo/pages',
    icon: FileText,
    section: 1,
    group: 'seo',
    permission: 'data:read',
    status: 'planned',
  },
  {
    key: 'aiOverview',
    path: '/ai',
    icon: MessageSquareText,
    section: 1,
    group: 'ai',
    permission: 'data:read',
    status: 'planned',
  },
  {
    key: 'prompts',
    path: '/ai/prompts',
    icon: MessageSquare,
    section: 1,
    group: 'ai',
    permission: 'data:read',
    status: 'planned',
  },
  {
    key: 'citations',
    path: '/ai/citations',
    icon: Quote,
    section: 1,
    group: 'ai',
    permission: 'data:read',
    status: 'planned',
  },
  {
    key: 'sources',
    path: '/ai/sources',
    icon: Globe,
    section: 1,
    group: 'ai',
    permission: 'data:read',
    status: 'planned',
  },
  {
    key: 'competitors',
    path: '/competitors',
    icon: Users,
    section: 2,
    group: null,
    permission: 'data:read',
    status: 'planned',
  },
  {
    key: 'discover',
    path: '/discover',
    icon: Compass,
    section: 2,
    group: null,
    permission: 'data:read',
    status: 'planned',
  },
  {
    key: 'reports',
    path: '/reports',
    icon: FileChartColumn,
    section: 3,
    group: null,
    permission: 'data:read',
    status: 'planned',
  },
  {
    key: 'integrations',
    path: '/integrations',
    icon: Plug,
    section: 3,
    group: null,
    permission: 'data:read',
    status: 'planned',
  },
  {
    key: 'runs',
    path: '/ops/runs',
    icon: Activity,
    section: 3,
    group: null,
    permission: 'data:read',
    status: 'live',
    carriesQuery: true,
  },
  {
    key: 'costs',
    path: '/costs',
    icon: Receipt,
    section: 3,
    group: null,
    permission: 'costs:read',
    status: 'live',
    carriesQuery: true,
  },
  // Your account is in Settings, and every member has one
  { key: 'settings', path: '/settings', icon: Settings, section: 3, group: null, permission: null, status: 'live' },
];

/** The destinations that are pages now. */
export const LIVE_NAVIGATION: readonly NavDestination[] = NAVIGATION.filter((item) => item.status === 'live');

export interface NavGroupEntry {
  group: NavGroup | null;
  items: NavDestination[];
}
export interface NavSection {
  id: NavSectionId;
  groups: NavGroupEntry[];
}

/**
 * What the sidebar lists for a membership: live destinations the role can open, in their sections and
 * groups. A destination the role can never use is absent, not disabled (20 section 3.9); a group, or a
 * section, left with nothing is dropped with its label.
 */
export function visibleNavigation(registry: readonly NavDestination[], permissions: readonly string[]): NavSection[] {
  const sections: NavSection[] = [];
  for (const item of registry) {
    if (item.status !== 'live') continue;
    if (item.permission !== null && !permissions.includes(item.permission)) continue;
    let section = sections.find((candidate) => candidate.id === item.section);
    if (!section) {
      section = { id: item.section, groups: [] };
      sections.push(section);
    }
    const last = section.groups[section.groups.length - 1];
    if (last?.group === item.group) last.items.push(item);
    else section.groups.push({ group: item.group, items: [item] });
  }
  return sections;
}

/** Where a destination is for this project. */
export const navHref = (item: NavDestination, workspace: string, project: string): Route =>
  projectPath(workspace, project, item.path);

/** The keys of a page's query that name something of one project: an open inspector does not follow the person. */
const PROJECT_BOUND_KEYS: readonly string[] = ['inspect', 'itab'];

/**
 * Where choosing another project goes from `item`: the same destination in `project`, with the query of the
 * page (`search`, as `location.search` reads, with or without its `?`) when the destination carries it,
 * minus the keys that belong to one project.
 */
export function switchHref(item: NavDestination, workspace: string, project: string, search: string): Route {
  const href = navHref(item, workspace, project);
  if (item.carriesQuery !== true) return href;
  const query = new URLSearchParams(search);
  for (const key of PROJECT_BOUND_KEYS) query.delete(key);
  return withQuery(href, query.toString());
}

/**
 * The destination a path belongs to: the one whose route is the path or an ancestor of it, the longest
 * such (so `/settings/profile` is Settings). Overview matches only the project root itself.
 */
export function destinationOf(
  registry: readonly NavDestination[],
  pathname: string,
  workspace: string,
  project: string,
): NavDestination | null {
  const root: string = projectPath(workspace, project);
  if (pathname !== root && !pathname.startsWith(`${root}/`)) return null;
  const rest = pathname.slice(root.length);
  const matches = registry.filter((item) =>
    item.path === '' ? rest === '' || rest === '/' : rest === item.path || rest.startsWith(`${item.path}/`),
  );
  return matches.sort((a, b) => b.path.length - a.path.length)[0] ?? null;
}
