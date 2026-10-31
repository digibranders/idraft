import { waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CANCEL_PATH } from './import-queries';
import {
  Controlled,
  MAP_INTRO,
  answerImportAs,
  csv,
  openImport,
  press,
  spy,
  uploadAndContinue,
} from '@/test/import-harness';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/keywords',
}));
vi.mock('@/lib/api/upload', async () => {
  const { fetchUpload } = await import('@/test/fetch-upload');
  return { uploadForm: fetchUpload };
});
// Three minutes is too long for a test to wait: a file is given up on after a second and a half
vi.mock('./import-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./import-queries')>()),
  READ_TIMEOUT_MS: 1_500,
}));

beforeEach(stubWideScreen);
afterEach(restoreWideScreen);

describe('Import dialog: a tab that is hidden while the file is read', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not give up on a file that was read in the meantime: the wait asks the API once more', async () => {
    // The API reads the file within the wait; a hidden tab's timers and polls are what the test stands for
    let reads = 0;
    answerImportAs((view) => {
      reads += 1;
      return reads <= 2 ? { ...view, status: 'uploaded' } : view;
    });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const cancels = spy('post', CANCEL_PATH);
    const { user } = renderWithProviders(<Controlled changes={[]} />);
    const { dialog } = await openImport(user);
    await uploadAndContinue(user, dialog, csv('keyword\nbacklink watcher'));
    expect(await within(dialog).findByText(MAP_INTRO, undefined, { timeout: 8_000 })).toBeInTheDocument();
    expect(within(dialog).queryByText('Reading the file is taking longer than expected. Try again.')).toBeNull();
    expect(cancels.bodies).toHaveLength(0);
  }, 20_000);
});

describe('Import dialog: a file the API reads slowly', () => {
  it('is not waited for forever: there is a message, and Start again stops the import', async () => {
    answerImportAs((view) => ({ ...view, status: 'uploaded' }));
    const cancels = spy('post', CANCEL_PATH);
    const { user } = renderWithProviders(<Controlled changes={[]} />);
    const { dialog } = await openImport(user);
    await uploadAndContinue(user, dialog, csv('keyword\nbacklink watcher'));
    expect(
      await within(dialog).findByText('Reading the file is taking longer than expected. Try again.', undefined, {
        timeout: 8_000,
      }),
    ).toBeInTheDocument();
    await press(dialog, 'Start again');
    expect(within(dialog).getByText('Drop a CSV file here, or choose one')).toBeInTheDocument();
    // The import that never finished reading is stopped
    await waitFor(() => expect(cancels.bodies).toHaveLength(1));
  }, 20_000);
});
