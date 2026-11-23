import { screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShareDialog } from './share-dialog';
import { Button } from '@/components/ui/button';
import { copyText } from '@/lib/dom/clipboard';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { EVENTUS } from '@/mocks/internal-links-world';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('@/lib/dom/clipboard', () => ({ copyText: vi.fn(() => Promise.resolve(true)) }));

const SCOPE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: EVENTUS.project_id };

afterEach(() => {
  server.events.removeAllListeners();
  vi.mocked(copyText).mockClear();
});

function Host({ canWrite }: { canWrite: boolean }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Share</Button>
      <ShareDialog open={open} onOpenChange={setOpen} scope={SCOPE} canWrite={canWrite} timeZone="UTC" />
    </>
  );
}

function render(role: 'editor' | 'viewer', canWrite: boolean): ReturnType<typeof renderWithProviders> {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return renderWithProviders(<Host canWrite={canWrite} />);
}

describe('Share link dialog', () => {
  it('creates a link, shows its address once with a Copy button, and lists it', async () => {
    const { user } = render('editor', true);
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('No links yet.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Link works for/ })).toHaveTextContent('30 days');

    await user.click(screen.getByRole('button', { name: 'Create link' }));
    const status = await screen.findByText(/\/public\/internal-links\/[0-9a-f]{48}$/);
    expect(status).toBeInTheDocument();
    expect(screen.getByText('Copy it now. It is shown only once.')).toBeInTheDocument();
    const address = status.textContent ?? '';

    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(copyText).toHaveBeenCalledWith(address);
    expect(await screen.findByText('Link copied')).toBeInTheDocument();

    // The list holds the link, without any token
    const item = await screen.findByRole('listitem');
    expect(within(item).getByText('Active')).toBeInTheDocument();
    expect(item.textContent).not.toContain(address.split('/').pop());
  });

  it('revokes an active link after one question, and the row then has no button', async () => {
    const { user } = render('editor', true);
    await user.click(screen.getByRole('button', { name: 'Share' }));
    await user.click(await screen.findByRole('button', { name: 'Create link' }));
    await screen.findByRole('listitem');

    await user.click(screen.getByRole('button', { name: /Revoke the link created/ }));
    expect(screen.getByText(/Anyone who has it can no longer open the summary/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revoke link' }));
    await waitFor(() => expect(screen.getByText('Revoked')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Revoke/ })).not.toBeInTheDocument();
  });

  it('lets a viewer read the list but not create or revoke', async () => {
    const editor = render('editor', true);
    await editor.user.click(screen.getByRole('button', { name: 'Share' }));
    await editor.user.click(await screen.findByRole('button', { name: 'Create link' }));
    await screen.findByRole('listitem');
    editor.unmount();

    const { user } = render('viewer', false);
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByRole('listitem')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Revoke/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Your role cannot create or revoke links/)).toBeInTheDocument();
  });
});
