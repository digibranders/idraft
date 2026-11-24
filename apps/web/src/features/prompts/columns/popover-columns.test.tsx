import { screen, waitFor, within } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { brandsColumn } from './brands-column';
import { linksColumn } from './links-column';
import { popoverColumns } from './popover-columns';
import { screenshotColumn } from './screenshot-column';
import { indexFacts, type FactsRow, type PromptFacts } from '../facts';
import { cellOf, engine, entityCells, rowOf } from '../facts/test-helpers';
import { chatgptRow, PROJECT, platformName, TRACKED } from '@/test/prompt-lists-fixtures';
import type { PromptRow } from '../prompt-columns';
import { SORT_ID } from '../prompt-model';
import { COLUMN_AFTER, withColumnEntries, type PromptColumnContext } from '../seams/columns';
import { col } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import type { PromptsSummaryWithFacts, ScreenshotState } from '@/lib/api/prompt-facts';
import type { ProjectEngine } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { renderWithProviders } from '@/test/render';
import messages from '../../../../messages/en.json';

const t = createTranslator({ locale: 'en', messages });
const IMAGE = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>';

/** Any row type will do: the Groups tab reuses the Brands column on its own rows. */
interface Row {
  id: string;
  facts: FactsRow | undefined;
}
const row = (facts: FactsRow | undefined): Row => ({ id: 'row', facts });

/** The cell and the tooltip of one row, as the table draws them. */
function Cell<TRow>({ column, value }: { column: DataTableColumn<TRow>; value: TRow }): ReactElement {
  const tip = column.cellTip?.(value);
  return (
    <>
      <div data-testid="cell">{column.cell(value)}</div>
      <p data-testid="tip">{tip?.content ?? ''}</p>
    </>
  );
}

const brands = (loaded: boolean, scope: readonly string[] = ['chatgpt_web']): DataTableColumn<Row> =>
  brandsColumn<Row>({
    rowsOf: (value) => (value.facts === undefined ? [] : [value.facts]),
    labelOf: () => 'Startups',
    loaded,
    scope,
    entities: TRACKED,
    project: PROJECT,
    platformName,
    t,
  });

const links = (loaded: boolean): DataTableColumn<Row> =>
  linksColumn<Row>({ rowOf: (value) => value.facts, labelOf: () => 'This prompt', loaded, code: 'chatgpt_web', t });

const shot = (loaded: boolean, canCapture = true): DataTableColumn<Row> =>
  screenshotColumn<Row>({
    rowOf: (value) => value.facts,
    promptTextOf: () => 'What CRM do small teams choose?',
    loaded,
    platform: { code: 'chatgpt_web', name: 'ChatGPT' },
    timeZone: 'UTC',
    project: PROJECT,
    canCapture,
    t,
  });

const show = <TRow,>(column: DataTableColumn<TRow>, value: TRow) =>
  renderWithProviders(
    <PermissionProvider membership={membershipFactory('editor')}>
      <Cell column={column} value={value} />
    </PermissionProvider>,
  );
const cellText = (): string => screen.getByTestId('cell').textContent;
const tipText = (): string => screen.getByTestId('tip').textContent;

describe('the Brands column', () => {
  it('is a plain, wide column that its cells open from with the keyboard, and takes any row type', () => {
    const column = brands(true);
    expect(column).toMatchObject({ id: 'brands', header: 'Brands', width: 272, hasControls: true });
    expect(column.sortValue).toBeUndefined();
    expect(column.headerTooltip).toBe('The brands the answers mention, most mentioned first. Opens the list.');
  });

  it('names the group in the list for a row of another table', async () => {
    const { user } = show(brands(true), row(chatgptRow()));
    await user.click(screen.getByRole('button', { name: /for Startups: 3 brands/ }));
    expect(await screen.findByText('Startups · ChatGPT only · 12 answers')).toBeInTheDocument();
  });

  it('says not collected yet, never a value, while the facts are not read', () => {
    show(brands(false), row(undefined));
    expect(cellText()).toBe('n/a');
    expect(tipText()).toBe('Not collected yet');
  });

  it('says there are no answers when the facts are read and the row has none', () => {
    show(brands(true), row(undefined));
    expect(cellText()).toBe('n/a');
    expect(tipText()).toBe('No answers in this period');
  });

  it('says there are too few answers when no platform has four', () => {
    show(brands(true), row(rowOf(engine('chatgpt_web', { valid: 3, entities: [entityCells('own', cellOf(1, 3))] }))));
    expect(cellText()).toBe('n/a');
    expect(tipText()).toBe('Too few answers to list the brands they mention');
  });

  it('says not collected yet for a row whose platform carries no brand cells', () => {
    show(brands(true), row(rowOf(engine('chatgpt_web', { valid: 12 }))));
    expect(tipText()).toBe('Not collected yet');
  });
});

describe('the Cited pages column', () => {
  const answers = (over: Parameters<typeof engine>[1]): FactsRow =>
    rowOf(engine('chatgpt_web', { valid: 12, ...over }));

  it('shows the most cited page, the others as +N and a green check when the own site is among them', () => {
    show(
      links(true),
      row(
        answers({
          top_links: [
            {
              url: 'https://forbes.com/advisor/best-crm-software',
              domain: 'forbes.com',
              domain_role: 'third_party',
              answers: 8,
            },
            { url: 'https://northwind.com/crm', domain: 'northwind.com', domain_role: 'own', answers: 3 },
          ],
        }),
      ),
    );
    expect(screen.getByRole('img', { name: 'Your site is cited in these answers' })).toBeInTheDocument();
    const opener = screen.getByRole('button', {
      name: 'Pages cited in the answers for This prompt: 2 pages. Open the list',
    });
    expect(opener).toHaveTextContent('forbes.com/advisor/best-crm-software');
    expect(opener).toHaveTextContent('+1');
  });

  it('opens a list of the pages with how many answers cited each and a badge on the own site', async () => {
    const { user } = show(
      links(true),
      row(
        answers({
          top_links: [
            {
              url: 'https://forbes.com/advisor/best-crm-software',
              domain: 'forbes.com',
              domain_role: 'third_party',
              answers: 8,
            },
            { url: 'https://northwind.com/crm', domain: 'northwind.com', domain_role: 'own', answers: 3 },
          ],
        }),
      ),
    );
    await user.click(screen.getByRole('button', { name: /Open the list/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Pages cited in answers' });
    expect(within(dialog).getByText('This prompt · 12 answers')).toBeInTheDocument();
    const items = within(dialog).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/^1forbes\.com\/advisor\/best-crm-software.*8 of 12$/);
    expect(items[1]).toHaveTextContent(/^2northwind\.com\/crm.*Your site3 of 12$/);
    expect(within(dialog).getByText('How many of the answers cite each page, most cited first.')).toBeInTheDocument();
  });

  it('shows a grey dash when the own site is not among the pages', () => {
    show(
      links(true),
      row(
        answers({
          top_links: [{ url: 'https://g2.com/crm', domain: 'g2.com', domain_role: 'third_party', answers: 4 }],
        }),
      ),
    );
    expect(screen.getByRole('img', { name: 'Your site is not cited in these answers' })).toBeInTheDocument();
  });

  it('says None when the answers cited no page, and how many answers that is', () => {
    show(links(true), row(answers({ top_links: [] })));
    expect(cellText()).toBe('None');
    expect(tipText()).toBe('None of 12 answers cited a page');
  });

  it('says not collected yet, or no answers, instead of a value', () => {
    const first = show(links(false), row(undefined));
    expect(cellText()).toBe('n/a');
    expect(tipText()).toBe('Not collected yet');
    first.unmount();
    show(links(true), row(undefined));
    expect(tipText()).toBe('No answers in this period');
  });

  it('has the platform mark in its header and no order', () => {
    const column = links(true);
    expect(column).toMatchObject({ id: 'links', header: 'Cited pages', width: 344 });
    expect(column.headerIcon).toBeTruthy();
    expect(column.sortValue).toBeUndefined();
  });
});

describe('the Screenshot column', () => {
  const latest = (screenshot_url: string | null, screenshot_state?: ScreenshotState): FactsRow =>
    rowOf(
      engine('chatgpt_web', {
        latest: {
          observation_id: '41',
          observed_at: '2026-09-28T01:14:00Z',
          screenshot_url,
          screenshot_state: screenshot_state ?? (screenshot_url === null ? 'capturable' : 'available'),
        },
      }),
    );

  it('shows the day of the latest answer on a button named for the platform and the prompt', () => {
    show(shot(true), row(latest(IMAGE)));
    const button = screen.getByRole('button', {
      name: 'Open the latest ChatGPT answer screenshot for What CRM do small teams choose?',
    });
    expect(button).toHaveTextContent('Sep 28');
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('opens a modal with the platform, the prompt and the stored image, and Escape returns focus to the button', async () => {
    const { user } = show(shot(true), row(latest(IMAGE)));
    const button = screen.getByRole('button', { name: /Open the latest ChatGPT answer screenshot/ });
    await user.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Answer screenshot' });
    expect(within(dialog).getByText('ChatGPT · Sep 28, 01:14')).toBeInTheDocument();
    expect(within(dialog).getByText('What CRM do small teams choose?')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('img', { name: 'The latest ChatGPT answer to the prompt, as the page showed it' }),
    ).toHaveAttribute('src', IMAGE);
    // The first control of the dialog takes the focus: the Zoom choice, set to Fit
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'Fit' })).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Answer screenshot' })).not.toBeInTheDocument());
    await waitFor(() => expect(button).toHaveFocus());
  });

  it('does not draw an address that is not a web address or an inline image', async () => {
    const { user } = show(shot(true), row(latest('javascript:alert(1)')));
    await user.click(screen.getByRole('button', { name: /Open the latest ChatGPT answer screenshot/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Answer screenshot' });
    expect(within(dialog).queryByRole('img', { name: /as the page showed it/ })).not.toBeInTheDocument();
  });

  it('offers Get screenshot, never a picture, when the answer has none stored and the person may spend', () => {
    show(shot(true), row(latest(null)));
    expect(
      screen.getByRole('button', {
        name: 'Get a screenshot of the latest ChatGPT answer for What CRM do small teams choose?',
      }),
    ).toHaveTextContent('Get screenshot');
    expect(tipText()).toBe('');
  });

  it('says n/a with its reason to a reader, who may see an image but not spend', () => {
    show(shot(true, false), row(latest(null)));
    expect(cellText()).toBe('n/a');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(tipText()).toBe('No screenshot of the latest answer has been collected yet');
  });

  it('keeps the image for a reader when one is stored', () => {
    show(shot(true, false), row(latest(IMAGE)));
    expect(screen.getByRole('button', { name: /Open the latest ChatGPT answer screenshot/ })).toBeInTheDocument();
  });

  it('says Expired with the reason for an answer past the window, and n/a for a platform with no page', () => {
    const first = show(shot(true), row(latest(null, 'expired')));
    expect(cellText()).toBe('Expired');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(tipText()).toBe('A screenshot can only be taken for an answer less than 7 days old');
    first.unmount();
    show(shot(true), row(latest(null, 'unsupported')));
    expect(cellText()).toBe('n/a');
    expect(tipText()).toBe('This platform has no page to take a screenshot of');
  });

  it('says No answer when the platform has none in the period', () => {
    const first = show(shot(true), row(rowOf(engine('chatgpt_web', { latest: null }))));
    expect(cellText()).toBe('No answer');
    expect(tipText()).toBe('No answer in this period yet');
    first.unmount();
    show(shot(true), row(undefined));
    expect(cellText()).toBe('No answer');
  });

  it('says not collected yet while the backend sends no latest answer', () => {
    show(shot(false), row(undefined));
    expect(cellText()).toBe('n/a');
    expect(tipText()).toBe('Not collected yet');
  });
});

describe('the entry of the popover columns', () => {
  const engines = (...codes: string[]): ProjectEngine[] =>
    codes.map((code) => ({ engine: { engine_code: code, label: platformName(code) } }) as unknown as ProjectEngine);
  const facts = (): PromptFacts =>
    indexFacts(
      {
        prompts: [],
        topics: [],
        entities: [...TRACKED],
        engine_codes: ['chatgpt_web'],
      } as unknown as PromptsSummaryWithFacts,
      true,
    );
  const context = (single: string | null): PromptColumnContext => ({
    engines: engines('chatgpt_web', 'gemini_web'),
    scope: single === null ? ['chatgpt_web', 'gemini_web'] : [single],
    single,
    facts: facts(),
    metric: 'mention',
    t,
    locale: 'en',
    compare: false,
    comparedWindow: null,
    changeWords: { tip: () => '', label: () => '', gap: () => '' },
    project: PROJECT,
    canCapture: true,
    timeZone: 'UTC',
  });
  const builtIns = [SORT_ID.prompt, SORT_ID.citation, SORT_ID.mention].map((id) =>
    col.text<PromptRow>(id, () => id, { header: id }),
  );
  const idsOf = (single: string | null): string[] =>
    withColumnEntries(builtIns, [popoverColumns], context(single)).map((column) => column.id);

  it('places Brands alone after the Citation rate while several platforms are in view', () => {
    expect(idsOf(null)).toEqual(['prompt', 'citation', 'brands', 'mention']);
  });

  it('adds Cited pages before Brands and Screenshot after it while one platform is in view', () => {
    expect(idsOf('chatgpt_web')).toEqual(['prompt', 'citation', 'links', 'brands', 'screenshot', 'mention']);
  });

  it('follows the same anchor as the rates of the seam', () => {
    expect(popoverColumns.after).toEqual(COLUMN_AFTER.rates);
  });
});
