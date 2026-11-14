/**
 * The layout routes of contract C12a through the typed client (docs/ai-visibility/contracts/c12a-layouts.md):
 * one read with an `ETag`, and four writes (the personal layout and the team default, each saved and removed).
 * The calls do not use `unwrap`, which drops the headers: the `ETag` of an answer is what the next save sends
 * back as `If-Match`.
 */
import type { ApiClient } from '@/lib/api/client';
import { queryKey, type QueryKey } from '@/lib/api/keys';
import { problemFrom } from '@/lib/api/problem';
import type { Schemas } from '@/lib/api/types';
import {
  SCREENS,
  isLayoutDocument,
  sanitizeLayout,
  upgradeDocument,
  type LayoutDocument,
  type LayoutSource,
  type SanitizeResult,
  type ScreenKey,
} from '@/lib/layouts';

export type ApiResolvedLayout = Schemas['ResolvedLayout'];
type ApiLayoutDocument = Schemas['LayoutDocument'];

export const LAYOUT_PATH = '/api/v1/workspaces/{workspace_id}/layouts/{screen}';
const PERSONAL_PATH = '/api/v1/workspaces/{workspace_id}/me/layouts/{screen}';
const TEAM_PATH = '/api/v1/workspaces/{workspace_id}/layouts/{screen}/default';

/** A layout as the API answered it, with the `ETag` that guards the next save (null when the answer has none). */
export interface LayoutRead {
  layout: ApiResolvedLayout;
  etag: string | null;
}

export const layoutQueryKey = (workspaceId: string, screen: ScreenKey): QueryKey =>
  queryKey(LAYOUT_PATH, { workspace_id: workspaceId, screen });

/** The `ETag` as `If-Match` wants it: a weak `W/` prefix (added by a compressing proxy) removed. */
export function ifMatchOf(etag: string | null): string | undefined {
  return etag === null ? undefined : etag.replace(/^W\//, '');
}

const pathOf = (workspaceId: string, screen: ScreenKey): { workspace_id: string; screen: string } => ({
  workspace_id: workspaceId,
  screen,
});

/** What `If-Match` carries, when an `ETag` was read: a first save has none to send. */
function headerOf(etag: string | null): { 'If-Match'?: string } {
  const ifMatch = ifMatchOf(etag);
  return ifMatch === undefined ? {} : { 'If-Match': ifMatch };
}

interface Outcome {
  error?: unknown;
  response: Response;
}

/** An error response rejects with its `ApiProblem`, so a `412` arrives with `code === 'precondition_failed'`. */
function assertOk({ error, response }: Outcome): void {
  if (!response.ok || error !== undefined) throw problemFrom(response, error);
}

function readOf(outcome: Outcome & { data?: Schemas['ResolvedLayoutResponse'] | undefined }): LayoutRead {
  assertOk(outcome);
  if (outcome.data === undefined) throw new Error('The layout answer has no body');
  return { layout: outcome.data.data, etag: outcome.response.headers.get('etag') };
}

export async function fetchLayout(
  client: ApiClient,
  workspaceId: string,
  screen: ScreenKey,
  signal?: AbortSignal,
): Promise<LayoutRead> {
  return readOf(
    await client.GET(LAYOUT_PATH, {
      params: { path: pathOf(workspaceId, screen) },
      ...(signal === undefined ? {} : { signal }),
    }),
  );
}

export async function putPersonalLayout(
  client: ApiClient,
  workspaceId: string,
  screen: ScreenKey,
  document: LayoutDocument,
  etag: string | null,
): Promise<LayoutRead> {
  return readOf(
    await client.PUT(PERSONAL_PATH, {
      params: { path: pathOf(workspaceId, screen), header: headerOf(etag) },
      body: document,
    }),
  );
}

export async function putTeamLayout(
  client: ApiClient,
  workspaceId: string,
  screen: ScreenKey,
  document: LayoutDocument,
  etag: string | null,
): Promise<LayoutRead> {
  return readOf(
    await client.PUT(TEAM_PATH, {
      params: { path: pathOf(workspaceId, screen), header: headerOf(etag) },
      body: document,
    }),
  );
}

export async function deletePersonalLayout(client: ApiClient, workspaceId: string, screen: ScreenKey): Promise<void> {
  assertOk(await client.DELETE(PERSONAL_PATH, { params: { path: pathOf(workspaceId, screen) } }));
}

export async function deleteTeamLayout(client: ApiClient, workspaceId: string, screen: ScreenKey): Promise<void> {
  assertOk(await client.DELETE(TEAM_PATH, { params: { path: pathOf(workspaceId, screen) } }));
}

/** The API's answer as the page uses it. */
export interface ResolvedLayoutView {
  source: LayoutSource;
  document: LayoutDocument;
  teamDefaultExists: boolean;
  /** The team default, upgraded and sanitized, also when a personal layout wins; null without a usable one. */
  teamDocument: LayoutDocument | null;
  updatedAt: string | null;
  updatedBy: { userId: string; name: string } | null;
  /** Sanitizing changed the stored document: it is shown as it came out, never as an error. */
  repaired: boolean;
}

const present = (item: object): Record<string, unknown> =>
  Object.fromEntries(Object.entries(item).filter(([, value]) => value !== null));

/**
 * The members the API fills with null are left out again, as the pure layer (and a saved draft) have them. A zone the
 * screen has and the document lacks is an empty one, and a zone the screen has not is left out, so neither is
 * counted as a repair.
 */
function leaveOutNulls(document: ApiLayoutDocument, screen: ScreenKey): Record<string, unknown> {
  const { zones } = SCREENS[screen];
  return {
    schema: document.schema,
    ...(zones.numbers ? { numbers: (document.numbers ?? []).map((item) => present(item)) } : {}),
    ...(zones.cards ? { cards: (document.cards ?? []).map((item) => present(item)) } : {}),
  };
}

/** A stored document raised to the current schema and made safe to show; null when it is none of this app's. */
function sanitized(document: ApiLayoutDocument | null | undefined, screen: ScreenKey): SanitizeResult | null {
  if (document == null) return null;
  const stored = upgradeDocument(leaveOutNulls(document, screen));
  return isLayoutDocument(stored) ? sanitizeLayout(stored, screen) : null;
}

/** The built-in layout of the screen when the API holds none, else the stored document upgraded and sanitized. */
export function toResolved(layout: ApiResolvedLayout, screen: ScreenKey): ResolvedLayoutView {
  const own = layout.source === 'builtin' ? null : sanitized(layout.document, screen);
  const team = sanitized(layout.team_document, screen);
  return {
    source: own === null ? 'builtin' : layout.source,
    document: own?.document ?? structuredClone(SCREENS[screen].builtin),
    teamDefaultExists: layout.team_default_exists,
    teamDocument: team?.document ?? null,
    updatedAt: own === null ? null : layout.updated_at,
    updatedBy:
      own === null || layout.updated_by === null
        ? null
        : { userId: layout.updated_by.user_id, name: layout.updated_by.name },
    repaired: own?.changed ?? false,
  };
}
