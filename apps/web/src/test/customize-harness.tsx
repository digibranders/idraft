import { waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useRef, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { expect, vi } from 'vitest';

import { CustomizableGrid, CustomizableScreen } from '@/features/layouts/customize/customizable-screen';
import { CustomizeButton } from '@/features/layouts/customize/customize-button';
import { useCustomize } from '@/features/layouts/customize/customize-controller';
import { CustomizingBadge } from '@/features/layouts/customize/customizing-badge';
import { LayoutGrid } from '@/features/layouts/layout-grid';
import { useLayoutScreen } from '@/features/layouts/layout-provider';
import { defineCards, type CardRegistry } from '@/features/layouts/registry';
import type { Capabilities, ScreenKey } from '@/lib/layouts';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { server } from '@/test/msw';

/*
 * What the tests of the customize controller, its button, its badge and its keys share: a customizable screen on
 * the mock API with buttons of its own for the actions a test needs (an edit, a leave, a save), a stand in for the
 * window's width, and the routes of the layout API.
 */
const WORKSPACE = MOCK_WORKSPACE.workspace_id;
const LAYOUTS = `/api/v1/workspaces/${WORKSPACE}/layouts/:screen`;
const PERSONAL = `/api/v1/workspaces/${WORKSPACE}/me/layouts/:screen`;

export const BOTH_CHANNELS: Capabilities = { channels: ['seo', 'ai'], permissions: [], integrations: [] };

export interface ServeOptions {
  /** `error`: a read that fails, so the layout never loads. */
  read?: 'ok' | 'error';
  /** A save that would succeed, and the removal of the team default, wait for this promise before they answer. */
  holdSave?: Promise<void>;
  /**
   * What a save answers, for the personal layout and the team default alike: 200 by default, 500 (a failure) or
   * 412 (the layout changed somewhere else). A list is one answer per save, in order; the last one repeats.
   */
  putStatus?: SaveStatus | readonly SaveStatus[];
  /** Fields of the layout a read answers, over the built-in layout: a personal layout, a team default. */
  layout?: Record<string, unknown>;
}

type SaveStatus = 200 | 412 | 500;

/** What the layout routes were asked to write: one entry per request, so a test can say that none was sent. */
export interface ServedLayouts {
  /** The `If-Match` of each personal save. */
  puts: string[];
  deletes: string[];
  /** The `If-Match` of each save of the team default. */
  teamPuts: string[];
  teamDeletes: string[];
  /** How many reads of the layout were answered. */
  reads: number;
}

/**
 * The layout routes: every screen reads as the built-in layout, and a save is accepted. Gives back the log of
 * the writes the routes received (a later `serveLayouts` call has its own log). Once the team default is
 * removed, a read answers without it.
 */
export function serveLayouts({
  read = 'ok',
  holdSave,
  putStatus = 200,
  layout = {},
}: ServeOptions = {}): ServedLayouts {
  const served: ServedLayouts = { puts: [], deletes: [], teamPuts: [], teamDeletes: [], reads: 0 };
  const statuses = typeof putStatus === 'number' ? [putStatus] : putStatus;
  let saves = 0;
  let teamRemoved = false;
  /** The answer to the next save. */
  const nextStatus = (): SaveStatus => statuses[Math.min(saves++, statuses.length - 1)] ?? 200;
  const failure = (status: 412 | 500): Response =>
    HttpResponse.json(
      {
        type: 'about:blank',
        title: status === 412 ? 'Precondition failed' : 'Internal',
        status,
        code: status === 412 ? 'precondition_failed' : 'internal',
      },
      { status },
    );
  server.use(
    http.get(mswPath(LAYOUTS), ({ params }) => {
      served.reads += 1;
      if (read === 'error') {
        return HttpResponse.json(
          { type: 'about:blank', title: 'Internal', status: 500, code: 'internal' },
          { status: 500 },
        );
      }
      return HttpResponse.json(
        {
          data: {
            screen: params.screen,
            source: 'builtin',
            document: null,
            team_default_exists: false,
            team_document: null,
            updated_at: null,
            updated_by: null,
            ...layout,
            ...(teamRemoved ? { team_default_exists: false, team_document: null } : {}),
          },
        },
        { headers: { etag: '"e1"' } },
      );
    }),
    http.put(mswPath(`${LAYOUTS}/default`), async ({ params, request }) => {
      served.teamPuts.push(request.headers.get('if-match') ?? '');
      const status = nextStatus();
      if (status === 200 && holdSave !== undefined) await holdSave;
      if (status !== 200) return failure(status);
      return HttpResponse.json(
        {
          data: {
            screen: params.screen,
            source: 'team',
            document: null,
            team_default_exists: true,
            team_document: null,
            updated_at: '2026-11-10T09:12:44Z',
            updated_by: null,
          },
        },
        { headers: { etag: '"t1"' } },
      );
    }),
    http.put(mswPath(PERSONAL), async ({ params, request }) => {
      served.puts.push(request.headers.get('if-match') ?? '');
      const status = nextStatus();
      if (status === 200 && holdSave !== undefined) await holdSave;
      if (status !== 200) return failure(status);
      return HttpResponse.json(
        {
          data: {
            screen: params.screen,
            source: 'personal',
            document: null,
            team_default_exists: false,
            team_document: null,
            updated_at: '2026-11-10T09:12:44Z',
            updated_by: null,
          },
        },
        { headers: { etag: '"p1"' } },
      );
    }),
    http.delete(mswPath(PERSONAL), () => {
      served.deletes.push('personal');
      return new HttpResponse(null, { status: 204 });
    }),
    // Removing the team default is a write that can be under way while the screen is in view mode
    http.delete(mswPath(`${LAYOUTS}/default`), async () => {
      served.teamDeletes.push('team');
      if (holdSave !== undefined) await holdSave;
      teamRemoved = true;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return served;
}

/**
 * A window of `widthRem` rem that a test can resize: `matchMedia` answers `(width >= Nrem)` from it, and
 * `(prefers-reduced-motion: reduce)` with `reducedMotion`.
 */
export function stubViewport(widthRem = 90, reducedMotion = false): { setWidth: (rem: number) => void } {
  let width = widthRem;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches(): boolean {
      if (query === '(prefers-reduced-motion: reduce)') return reducedMotion;
      const wanted = /\(width >= ([0-9.]+)rem\)/.exec(query);
      return wanted !== null && width >= Number(wanted[1]);
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  return {
    setWidth: (rem) => {
      width = rem;
      listeners.forEach((listener) => {
        listener();
      });
    },
  };
}

/** Buttons that call the actions of the screen they are in; the ones for leaving exist only while customizing. */
function Controls({ onThen }: { onThen: () => void }): ReactElement {
  const { mode, changes, shownCards, actions } = useLayoutScreen();
  const { enter, requestExit } = useCustomize();
  const menuEntry = useRef<HTMLButtonElement>(null);
  const customizing = mode === 'customize';
  const first = shownCards[0];
  return (
    <div>
      <p data-testid="state">{`${mode} ${String(changes)}`}</p>
      <button
        ref={menuEntry}
        type="button"
        onClick={() => {
          enter(menuEntry.current);
        }}
      >
        Menu entry
      </button>
      <input aria-label="Note" />
      <button
        type="button"
        onClick={() => {
          void actions.removeTeamDefault();
        }}
      >
        Remove default
      </button>
      {customizing ? (
        <>
          <button
            type="button"
            onClick={() => {
              if (first !== undefined) actions.hideCard(first.id);
            }}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              requestExit();
            }}
          >
            Leave
          </button>
          <button
            type="button"
            onClick={() => {
              requestExit(onThen);
            }}
          >
            Leave and run
          </button>
          <button
            type="button"
            onClick={() => {
              void actions.save();
            }}
          >
            Save now
          </button>
        </>
      ) : null}
    </div>
  );
}

export interface UnderTestProps {
  screen?: ScreenKey;
  /** Names the box, so two screens on one page can be told apart. */
  label?: string;
  onThen?: () => void;
  buttonLabel?: ComponentProps<typeof CustomizeButton>['label'];
  /** More parts of the screen, for a test of a part of its own. */
  extra?: ReactNode;
  /** What the project can use; both channels by default. */
  capabilities?: Capabilities;
  /** The grid of a page: its Add card slot opens the catalog. Without it the grid has no slot. */
  addSlot?: boolean;
  /** `none`: a screen whose save bar is somewhere else (the drawer). */
  saveBar?: ComponentProps<typeof CustomizableScreen>['saveBar'];
  /** The person's role in the workspace; an admin by default, who may set the team default. */
  workspaceRole?: Role;
  /** The cards that have code; none by default, so every card says it is not available yet. */
  registry?: CardRegistry;
  /** The presets of the page, for the Start from menu; none by default. */
  presets?: ComponentProps<typeof CustomizableScreen>['presets'];
}

/** One customizable screen: its header with the button and the badge, the test's controls, and the cards. */
export function ScreenUnderTest({
  screen: key = 'overview',
  label = 'Screen',
  onThen = () => undefined,
  buttonLabel,
  extra,
  capabilities = BOTH_CHANNELS,
  addSlot = false,
  saveBar,
  workspaceRole = 'admin',
  registry,
  presets,
}: UnderTestProps): ReactElement {
  return (
    <PermissionProvider membership={membershipFactory(workspaceRole)}>
      <section aria-label={label}>
        <CustomizableScreen
          screen={key}
          workspaceId={WORKSPACE}
          workspaceName="Acme"
          capabilities={capabilities}
          registry={registry ?? defineCards({})}
          {...(saveBar === undefined ? {} : { saveBar })}
          {...(presets === undefined ? {} : { presets })}
        >
          <header>
            <CustomizingBadge />
            <CustomizeButton {...(buttonLabel === undefined ? {} : { label: buttonLabel })} />
          </header>
          <Controls onThen={onThen} />
          {extra}
          {addSlot ? <CustomizableGrid label={`${label} cards`} /> : <LayoutGrid label={`${label} cards`} />}
        </CustomizableScreen>
      </section>
    </PermissionProvider>
  );
}

/** The box of one screen. Found by its label, not by role: a modal dialog takes the rest of the page out of the accessibility tree. */
export function box(label = 'Screen'): HTMLElement {
  const found = document.querySelector<HTMLElement>(`section[aria-label="${label}"]`);
  if (found === null) throw new Error(`no screen is labelled ${label}`);
  return found;
}

export const customizeButton = (label = 'Screen'): HTMLElement =>
  within(box(label)).getByRole('button', { name: 'Customize' });

/** What the screen says of its own state: "view 0", "customize 1". */
export const stateOf = (label = 'Screen'): string => within(box(label)).getByTestId('state').textContent ?? '';

/** The layout has loaded: the Customize button is no longer disabled. */
export async function loaded(label = 'Screen'): Promise<void> {
  const button = customizeButton(label);
  await waitFor(() => {
    expect(button).not.toHaveAttribute('aria-disabled', 'true');
  });
}

/** Presses Customize once the layout has loaded, and waits for the mode. */
export async function startCustomizing(user: UserEvent, label = 'Screen'): Promise<void> {
  await loaded(label);
  await user.click(customizeButton(label));
  await waitFor(() => {
    expect(stateOf(label)).toMatch(/^customize/);
  });
}

/** The first drag handle of a screen, where "Keep editing" puts focus. */
export const firstHandle = (label = 'Screen'): HTMLElement => {
  const handle = box(label).querySelector<HTMLElement>('[data-part="handle"]');
  if (handle === null) throw new Error('the screen has no drag handle');
  return handle;
};
