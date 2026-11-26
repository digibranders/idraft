import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AddPagesDialog } from './add-pages-dialog';
import type { Schemas } from '@/lib/api/types';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

type Outcome = Schemas['TrackOutcome'];
type Suggestion = Schemas['SuggestionRow'];

const TRACK = '*/api/v1/workspaces/:w/projects/:p/fp/tracked-pages';
const IDS = '*/api/v1/workspaces/:w/projects/:p/fp/tracked-pages/ids';
const SUGGESTIONS = '*/api/v1/workspaces/:w/projects/:p/fp/tracked-pages/suggestions';
const SCOPE = { workspaceId: 'w1', projectId: 'p1' };
const PROBLEM = { 'Content-Type': 'application/problem+json' };

const outcome = (input: string, kind: Outcome['outcome'], patch: Partial<Outcome> = {}): Outcome => ({
  input,
  outcome: kind,
  path: input.startsWith('/') ? input : null,
  url_id: null,
  clicks_28d: null,
  ...patch,
});
const suggestion = (path: string, id: string, clicks: number): Suggestion => ({
  path,
  url_id: id,
  url: `https://eventussecurity.com${path}`,
  title: `Title of ${path}`,
  clicks_28d: clicks,
  impressions_28d: clicks * 20,
});

interface Serving {
  tracked?: string[];
  suggestions?: Suggestion[];
  /** The answer to a dry run, by input. */
  checked?: Outcome[];
  failAdd?: boolean;
}

/** Serves the three requests and returns what the track requests carried. */
function serve({ tracked = ['1', '2'], suggestions = [], checked = [], failAdd = false }: Serving = {}): {
  bodies: Array<Record<string, unknown>>;
} {
  const bodies: Array<Record<string, unknown>> = [];
  server.use(
    http.get(IDS, () => HttpResponse.json({ data: tracked, meta: { limit: 200 } })),
    http.get(SUGGESTIONS, () => HttpResponse.json({ data: suggestions, meta: { state: 'ok' } })),
    http.post(TRACK, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      if (body.dry_run === false && failAdd) {
        return HttpResponse.json(
          { title: 'Failed', status: 500, detail: 'The store is busy.' },
          { status: 500, headers: PROBLEM },
        );
      }
      const added = body.dry_run === true ? 0 : ((body.urls ?? body.url_ids) as string[]).length;
      return HttpResponse.json({
        data: body.dry_run === true ? checked : checked.map((one) => ({ ...one, outcome: 'added' })),
        meta: { added, limit: 200, tracked: tracked.length + added },
      });
    }),
  );
  return { bodies };
}

function Host({ onAdded }: { onAdded: (count: number) => void }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Add pages
      </button>
      <AddPagesDialog scope={SCOPE} host="eventussecurity.com" open={open} onOpenChange={setOpen} onAdded={onAdded} />
    </>
  );
}

async function openDialog(onAdded: (count: number) => void = vi.fn()): Promise<ReturnType<typeof renderWithProviders>> {
  const view = renderWithProviders(<Host onAdded={onAdded} />);
  await view.user.click(screen.getByRole('button', { name: 'Add pages' }));
  await screen.findByRole('dialog', { name: 'Add pages' });
  return view;
}

const THREE = [
  outcome('/pricing', 'ok', { clicks_28d: 1240, url_id: '10' }),
  outcome('/blog', 'already_tracked', { url_id: '1' }),
  outcome('https://other.com/x', 'wrong_host'),
];

describe('AddPagesDialog', () => {
  it('checks pasted addresses and shows one outcome per line', async () => {
    const { bodies } = serve({ checked: THREE });
    const { user } = await openDialog();
    const area = screen.getByRole('textbox', { name: 'Addresses' });
    expect(area).toHaveFocus();
    await user.click(area);
    await user.paste('/pricing\n\n  /blog  \nhttps://other.com/x\n');
    await user.click(screen.getByRole('button', { name: 'Check pages' }));
    expect(await screen.findByText('Found, 1,240 clicks in 28 days')).toBeInTheDocument();
    expect(screen.getByText('Already tracked')).toBeInTheDocument();
    expect(screen.getByText('Not on eventussecurity.com')).toBeInTheDocument();
    expect(bodies).toEqual([{ dry_run: true, urls: ['/pricing', '/blog', 'https://other.com/x'] }]);
    expect(screen.getByText('Found, 1,240 clicks in 28 days')).toHaveClass('text-positive-text');
    expect(screen.getByText('Already tracked')).not.toHaveClass('text-positive-text');
    expect(screen.getByText('Not on eventussecurity.com')).toHaveClass('text-negative-text');
  });

  it('cuts the list to 500 lines', async () => {
    const { bodies } = serve();
    const { user } = await openDialog();
    await user.click(screen.getByRole('textbox', { name: 'Addresses' }));
    await user.paste(Array.from({ length: 520 }, (_, index) => `/p${String(index)}`).join('\n'));
    await user.click(screen.getByRole('button', { name: 'Check pages' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect((bodies[0]?.urls as string[]).length).toBe(500);
  });

  it('clears the outcomes when the text is edited after a check', async () => {
    serve({ checked: THREE });
    const { user } = await openDialog();
    await user.click(screen.getByRole('textbox', { name: 'Addresses' }));
    await user.paste('/pricing');
    await user.click(screen.getByRole('button', { name: 'Check pages' }));
    await screen.findByText('Already tracked');
    await user.type(screen.getByRole('textbox', { name: 'Addresses' }), 'x');
    expect(screen.queryByText('Already tracked')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add pages', hidden: false })).toBeDisabled();
  });

  it('adds only the lines that are ok', async () => {
    const { bodies } = serve({ checked: THREE });
    const onAdded = vi.fn();
    const { user } = await openDialog(onAdded);
    await user.click(screen.getByRole('textbox', { name: 'Addresses' }));
    await user.paste('/pricing\n/blog\nhttps://other.com/x');
    await user.click(screen.getByRole('button', { name: 'Check pages' }));
    await user.click(await screen.findByRole('button', { name: 'Add 1 page' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add pages' })).not.toBeInTheDocument());
    expect(bodies[1]).toEqual({ dry_run: false, urls: ['/pricing'] });
    expect(onAdded).toHaveBeenCalledWith(1);
    expect(await screen.findByText('Added 1 page')).toBeInTheDocument();
    expect(screen.getByText('Loading their history, the last 16 months.')).toBeInTheDocument();
  });

  it('is disabled with nothing to add, and says the count of tracked pages against the limit', async () => {
    serve();
    await openDialog();
    expect(await screen.findByText('2 of 200 pages tracked')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add pages' })).toBeDisabled();
  });

  it('lets suggested pages be ticked and added by url id', async () => {
    const { bodies } = serve({
      suggestions: [suggestion('/guide', '7', 90), suggestion('/pricing', '8', 40), suggestion('/old', '1', 500)],
    });
    const onAdded = vi.fn();
    const { user } = await openDialog(onAdded);
    await user.click(screen.getByRole('tab', { name: 'Suggested from Search Console' }));
    expect(await screen.findByRole('checkbox', { name: /\/guide/ })).toBeInTheDocument();
    expect(screen.getByText('90 clicks, 1,800 impressions')).toBeInTheDocument();
    // Page 1 is tracked already, so it is not offered
    expect(screen.queryByRole('checkbox', { name: /\/old/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /\/guide/ }));
    await user.click(screen.getByRole('checkbox', { name: /\/pricing/ }));
    await user.click(screen.getByRole('button', { name: 'Add 2 pages' }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(2));
    expect(bodies).toEqual([{ dry_run: false, url_ids: ['7', '8'] }]);
  });

  it('says when every suggested page is tracked already', async () => {
    serve({ suggestions: [suggestion('/old', '1', 500)] });
    const { user } = await openDialog();
    await user.click(screen.getByRole('tab', { name: 'Suggested from Search Console' }));
    expect(await screen.findByText('Every page found is already tracked.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('keeps the dialog open and shows the problem when adding fails', async () => {
    serve({ checked: THREE, failAdd: true });
    const onAdded = vi.fn();
    const { user } = await openDialog(onAdded);
    await user.click(screen.getByRole('textbox', { name: 'Addresses' }));
    await user.paste('/pricing');
    await user.click(screen.getByRole('button', { name: 'Check pages' }));
    await user.click(await screen.findByRole('button', { name: 'Add 1 page' }));
    const alert = await within(screen.getByRole('dialog', { name: 'Add pages' })).findByRole('alert');
    expect(alert).toHaveTextContent('The pages were not added. The store is busy.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onAdded).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add 1 page' })).toBeEnabled();
  });

  it('returns focus to the button that opened it, and has no accessibility violations', async () => {
    serve({ checked: THREE });
    const { user } = await openDialog();
    expect(await axe(screen.getByRole('dialog'))).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Add pages' })).toHaveFocus();
  });
});
