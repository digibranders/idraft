'use client';

import { createContext, use, type Context } from 'react';

/**
 * Below this width a favicon source sent its own placeholder globe (16 px, with a 404 status that an image
 * element still draws), so the caller shows its own mark instead. A real icon arrives at 32 px or more.
 */
export const FAVICON_MIN_WIDTH = 32;

/**
 * The address of a site's icon in the workspace `workspaceId`: the API's own route (backend request 22 in
 * docs/ai-visibility/backend-requests-prompts-page.md), on the app's origin, so the icon is fetched and kept by the
 * server and a cited domain is never sent to a third party. The route answers `404` for a site with no icon
 * of 32 px or more, and the caller then draws its placeholder mark. `null` with no workspace to ask in.
 */
export function faviconUrl(host: string, workspaceId: string | null): string | null {
  if (workspaceId === null) return null;
  return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/favicons/${encodeURIComponent(host)}`;
}

/** The workspace whose icon route is asked: set by `WorkspaceProviders`, absent outside a workspace page. */
export const FaviconWorkspaceContext: Context<string | null> = createContext<string | null>(null);

/** `faviconUrl` for the workspace being shown; `null` outside one. */
export function useFaviconUrl(host: string | null): string | null {
  const workspaceId = use(FaviconWorkspaceContext);
  return host === null ? null : faviconUrl(host, workspaceId);
}
