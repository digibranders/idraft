import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { ScreenshotCell, screenshotViewOf, type ScreenshotCellProps } from './screenshot-cell';
import type { LatestAnswer } from '../facts';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const PROJECT = { workspaceId: 'w', projectId: 'p' } as const;
const SHOT_PATH = '/api/v1/workspaces/w/projects/p/ai/observations/77/screenshot';
const ANSWER_PATH = '/api/v1/workspaces/w/projects/p/ai/observations/77';
const NEWEST = { observation_id: '77', observed_at: '2026-11-23T10:00:00Z' } as const;

const latest = (screenshot_url: string | null, screenshot_state: LatestAnswer['screenshot_state']): LatestAnswer => ({
  ...NEWEST,
  screenshot_url,
  screenshot_state,
});
const show = (over: Partial<ScreenshotCellProps> & Pick<ScreenshotCellProps, 'latest'>) =>
  renderWithProviders(
    <ScreenshotCell
      platform={{ code: 'chatgpt_web', name: 'ChatGPT' }}
      promptText="Best SOC providers in India"
      timeZone="Asia/Kolkata"
      project={PROJECT}
      canCapture
      {...over}
    />,
  );

const created = (over: { truncated?: boolean } = {}) =>
  HttpResponse.json(
    { data: { created: true, truncated: over.truncated ?? false, width: 1920, height: 4700, url: SHOT_PATH } },
    { status: 201 },
  );
const answerWith = (citations: readonly object[]) =>
  http.get(`*${ANSWER_PATH}`, () => HttpResponse.json({ data: { citations } }));
const CITATION = {
  citation_index: 1,
  title: 'Managed SOC guide',
  url: 'https://example.com/soc',
  raw_url: 'https://example.com/soc?utm_source=chatgpt.com',
  host: 'example.com',
  domain_role: 'third_party',
  flags: [],
  answer_block_index: null,
  citation_kind: 'url',
  first_char_offset: null,
  occurrences: 1,
  referral_tag: null,
  role_entity_id: null,
  source_name: null,
};

describe('screenshotViewOf', () => {
  it('names what the cell shows for each state and permission', () => {
    expect(screenshotViewOf(latest(SHOT_PATH, 'available'), false)).toBe('open');
    expect(screenshotViewOf(latest(null, 'capturable'), true)).toBe('get');
    expect(screenshotViewOf(latest(null, 'capturable'), false)).toBe('readOnly');
    expect(screenshotViewOf(latest(null, 'expired'), true)).toBe('expired');
    expect(screenshotViewOf(latest(null, 'unsupported'), true)).toBe('unsupported');
  });
});

describe('ScreenshotCell', () => {
  it('opens the stored screenshot with the answer cited pages beside it', async () => {
    server.use(answerWith([CITATION]));
    const { user } = show({ latest: latest(SHOT_PATH, 'available') });
    await user.click(screen.getByRole('button', { name: /Open the latest ChatGPT answer screenshot/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Answer screenshot' });
    expect(within(dialog).getByRole('img', { name: /as the page showed it/ })).toHaveAttribute('src', SHOT_PATH);
    expect(await within(dialog).findByRole('link', { name: 'Managed SOC guide' })).toHaveAttribute(
      'href',
      'https://example.com/soc',
    );
    expect(within(dialog).getByRole('heading', { name: 'Cited pages' })).toBeInTheDocument();
  });

  it('says so when the cited pages cannot be loaded, and keeps the image', async () => {
    server.use(http.get(`*${ANSWER_PATH}`, () => HttpResponse.json({ code: 'internal_error' }, { status: 500 })));
    const { user } = show({ latest: latest(SHOT_PATH, 'available') });
    await user.click(screen.getByRole('button', { name: /Open the latest ChatGPT answer screenshot/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Answer screenshot' });
    expect(await within(dialog).findByText('The cited pages could not be loaded.')).toBeInTheDocument();
    expect(within(dialog).getByRole('img')).toBeInTheDocument();
  });

  it('gets the screenshot on a press, then shows the image in the dialog', async () => {
    const seen: { observedAt: string | null }[] = [];
    server.use(
      http.post(`*${SHOT_PATH}`, ({ request }) => {
        seen.push({ observedAt: new URL(request.url).searchParams.get('observed_at') });
        return created();
      }),
      answerWith([]),
    );
    const { user } = show({ latest: latest(null, 'capturable') });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Get a screenshot of the latest ChatGPT answer/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Answer screenshot' });
    expect(seen).toEqual([{ observedAt: NEWEST.observed_at }]);
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', SHOT_PATH);
    expect(await within(dialog).findByText('This answer cites no pages.')).toBeInTheDocument();
    expect(within(dialog).queryByText(/longer than the screenshot/)).not.toBeInTheDocument();
  });

  it('is loading while the call runs and ignores a second press', async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`*${SHOT_PATH}`, async () => {
        calls += 1;
        await gate;
        return created();
      }),
      answerWith([]),
    );
    const { user } = show({ latest: latest(null, 'capturable') });
    const button = screen.getByRole('button', { name: /Get a screenshot of the latest ChatGPT answer/ });
    await user.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
    await user.click(button);
    release();
    await screen.findByRole('dialog', { name: 'Answer screenshot' });
    expect(calls).toBe(1);
  });

  it('says the end is missing when the answer is longer than the capture', async () => {
    server.use(
      http.post(`*${SHOT_PATH}`, () => created({ truncated: true })),
      answerWith([]),
    );
    const { user } = show({ latest: latest(null, 'capturable') });
    await user.click(screen.getByRole('button', { name: /Get a screenshot/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Answer screenshot' });
    expect(
      within(dialog).getByText('This answer is longer than the screenshot, so the end is missing.'),
    ).toBeInTheDocument();
  });

  it('says it failed and offers Try again, which then works', async () => {
    let attempts = 0;
    server.use(
      http.post(`*${SHOT_PATH}`, () => {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.json({ code: 'screenshot_failed', status: 502 }, { status: 502 })
          : created();
      }),
      answerWith([]),
    );
    const { user } = show({ latest: latest(null, 'capturable') });
    await user.click(screen.getByRole('button', { name: /Get a screenshot/ }));
    // The tooltip holds the same words as a hidden description; the alert is the one that is announced
    const words = await screen.findAllByText('The screenshot could not be taken. Try again.');
    expect(words.some((node) => node.getAttribute('role') === 'alert')).toBe(true);
    const retry = screen.getByRole('button', { name: /Try again to get a screenshot of the latest ChatGPT answer/ });
    expect(retry).toHaveTextContent('Try again');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(retry);
    expect(await screen.findByRole('dialog', { name: 'Answer screenshot' })).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it('turns to Expired when the provider says the answer is too old, with no button left', async () => {
    server.use(
      http.post(`*${SHOT_PATH}`, () => HttpResponse.json({ code: 'screenshot_expired', status: 410 }, { status: 410 })),
    );
    const { user } = show({ latest: latest(null, 'capturable') });
    await user.click(screen.getByRole('button', { name: /Get a screenshot/ }));
    expect(await screen.findByText('Expired')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says Expired for an answer past the provider window, with no button to press', () => {
    show({ latest: latest(null, 'expired') });
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows nothing to press for a platform without a page, and for a reader with nothing stored', () => {
    const first = show({ latest: latest(null, 'unsupported') });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    first.unmount();
    show({ latest: latest(null, 'capturable'), canCapture: false });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('n/a')).toBeInTheDocument();
  });

  it('lets a reader open a stored screenshot', async () => {
    server.use(answerWith([]));
    const { user } = show({ latest: latest(SHOT_PATH, 'available'), canCapture: false });
    await user.click(screen.getByRole('button', { name: /Open the latest ChatGPT answer screenshot/ }));
    expect(await screen.findByRole('dialog', { name: 'Answer screenshot' })).toBeInTheDocument();
  });
});
