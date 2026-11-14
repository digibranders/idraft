import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePromptActions } from './use-prompt-actions';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { promptId } from '@/mocks/prompt-fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const BULK_ARCHIVE = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/bulk-archive');
const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const SCOPE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const RANGE = { from: '2026-10-16', to: '2026-11-12' };

/** More prompts than one archive request takes, which the list of the screen (at most 1,000) cannot hold. */
const IDS = Array.from({ length: 1100 }, (_, at) => promptId(1000 + at));
const NO_ROWS = new Map();

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

/** The archive action of the bulk bar for 1,100 prompts, and what it lets go of. */
function Harness({ onDone }: { onDone: (ids: readonly string[]) => void }): ReactElement {
  const actions = usePromptActions({ scope: SCOPE, rowsById: NO_ROWS, engines: [], shown: [], range: RANGE, onDone });
  const archive = actions.bar(IDS).find((action) => action.id === 'archive');
  return (
    <>
      <button type="button" onClick={() => archive?.run()}>
        Archive them
      </button>
      {actions.dialogs}
    </>
  );
}

function renderHarness(onDone: (ids: readonly string[]) => void): ReturnType<typeof renderWithProviders> {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return renderWithProviders(
    <PermissionProvider membership={membershipFactory('editor')}>
      <Harness onDone={onDone} />
    </PermissionProvider>,
  );
}

interface Sent {
  size: number;
  archive: boolean;
}

describe('Archive above the 1,000 prompts of one request', () => {
  it('sends requests of 1,000, lets go of every prompt, and brings back the same prompts in the same requests with Undo', async () => {
    const sent: Sent[] = [];
    server.use(
      http.post(BULK_ARCHIVE, async ({ request }) => {
        const body = (await request.json()) as { ids: string[]; archive: boolean };
        sent.push({ size: body.ids.length, archive: body.archive });
        return HttpResponse.json({ data: { matched: body.ids.length, updated: body.ids.length } });
      }),
    );
    const done = vi.fn();
    const { user } = renderHarness(done);
    await user.click(screen.getByRole('button', { name: 'Archive them' }));
    await user.click(await screen.findByRole('button', { name: 'Archive 1,100 prompts' }));
    expect((await screen.findAllByText('1,100 prompts archived')).length).toBeGreaterThan(0);
    expect(sent).toEqual([
      { size: 1000, archive: true },
      { size: 100, archive: true },
    ]);
    expect(done).toHaveBeenCalledOnce();
    expect(done.mock.calls[0]?.[0]).toEqual(IDS);
    await user.click((await screen.findAllByRole('button', { name: 'Undo' }))[0] as HTMLElement);
    expect((await screen.findAllByText('1,100 prompts restored')).length).toBeGreaterThan(0);
    expect(sent.slice(2)).toEqual([
      { size: 1000, archive: false },
      { size: 100, archive: false },
    ]);
  });

  it('says how many were archived when a later request fails, lets go of those only, and offers Undo for them', async () => {
    const sent: Sent[] = [];
    server.use(
      http.post(BULK_ARCHIVE, async ({ request }) => {
        const body = (await request.json()) as { ids: string[]; archive: boolean };
        sent.push({ size: body.ids.length, archive: body.archive });
        return sent.length === 2 && body.archive
          ? HttpResponse.json({ code: 'boom', title: 'boom', status: 500, type: 'x' }, { status: 500 })
          : HttpResponse.json({ data: { matched: body.ids.length, updated: body.ids.length } });
      }),
    );
    const done = vi.fn();
    const { user } = renderHarness(done);
    await user.click(screen.getByRole('button', { name: 'Archive them' }));
    await user.click(await screen.findByRole('button', { name: 'Archive 1,100 prompts' }));
    expect((await screen.findAllByText('Archived 1,000 of 1,100 prompts')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Try again in a moment.')).length).toBeGreaterThan(0);
    expect(done.mock.calls[0]?.[0]).toEqual(IDS.slice(0, 1000));
    await user.click((await screen.findAllByRole('button', { name: 'Undo' }))[0] as HTMLElement);
    expect((await screen.findAllByText('1,000 prompts restored')).length).toBeGreaterThan(0);
    await waitFor(() => expect(sent.at(-1)).toEqual({ size: 1000, archive: false }));
  });
});
