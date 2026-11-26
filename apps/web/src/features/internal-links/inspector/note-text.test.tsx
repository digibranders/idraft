import { screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it, vi } from 'vitest';

import { NoteText } from './note-text';
import type { NoteMention } from '@/lib/pages/note-mentions';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const PAGE: NoteMention = { type: 'page', label: '@/pricing', target: '108', path: '/pricing' };
const USER: NoteMention = { type: 'user', label: '@Priya Natarajan', target: 'u1' };
const ISSUE: NoteMention = { type: 'issue', label: '@Missing title', target: 'title_missing' };
const KEYWORD: NoteMention = { type: 'keyword', label: '@"managed soc"', target: 'managed soc' };

const route = (path: string): Route => path as Route;

function renderText(
  body: string,
  mentions: readonly NoteMention[],
  options: { issueHref?: (checkId: string) => Route | null; onOpenPage?: (urlId: string) => void } = {},
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <NoteText
      body={body}
      mentions={mentions}
      onOpenPage={options.onOpenPage ?? vi.fn()}
      issueHref={options.issueHref ?? (() => null)}
    />,
  );
}

describe('NoteText', () => {
  it('draws text, chip, text, chip, text in order and keeps the line breaks as text', () => {
    const { container } = renderText('See @/pricing then\nask @Priya Natarajan today', [PAGE, USER]);
    const paragraph = container.querySelector('p');
    expect(paragraph).toHaveClass('whitespace-pre-wrap', 'break-words');
    expect(paragraph?.textContent).toContain('then\nask');
    const nodes = [...(paragraph?.childNodes ?? [])].map((node) =>
      node.nodeType === Node.TEXT_NODE ? 'text' : (node as Element).tagName.toLowerCase(),
    );
    expect(nodes).toEqual(['text', 'button', 'text', 'span', 'text']);
  });

  it('draws a label that appears twice as two chips, and leaves out a label that is not in the text', () => {
    renderText('@/pricing and again @/pricing', [PAGE, USER]);
    expect(screen.getAllByRole('button', { name: 'Open /pricing' })).toHaveLength(2);
    expect(screen.queryByText(/Teammate/)).not.toBeInTheDocument();
  });

  it('keeps text that looks like a label but has no entry as plain text', () => {
    renderText('Ping @Arjun Mehta about @/pricing', [PAGE]);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByText(/Ping @Arjun Mehta about/)).toBeInTheDocument();
  });

  it('names a page chip by its current path, not its label, and opens that page by its target', async () => {
    const onOpenPage = vi.fn();
    const moved: NoteMention = { ...PAGE, label: '@/old-pricing', path: '/pricing' };
    const { user } = renderText('See @/old-pricing', [moved], { onOpenPage });
    const chip = screen.getByRole('button', { name: 'Open /pricing' });
    await user.click(chip);
    expect(onOpenPage).toHaveBeenCalledExactlyOnceWith('108');
    chip.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onOpenPage).toHaveBeenCalledTimes(3);
  });

  it('makes an issue chip a link to the check when the seam has a route', () => {
    renderText('Fix @Missing title', [ISSUE], { issueHref: (id) => route(`/seo/issues?check=${id}`) });
    const link = screen.getByRole('link', { name: 'Open this check on the Issues page' });
    expect(link).toHaveAttribute('href', '/seo/issues?check=title_missing');
  });

  it('draws an issue chip as plain text with its icon when the seam gives no route', () => {
    const { container } = renderText('Fix @Missing title', [ISSUE]);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('Missing title')).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('draws user and keyword chips as spans that are not focusable, with the full words as text', () => {
    const { container } = renderText('@Priya Natarajan and @"managed soc"', [USER, KEYWORD]);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    const chips = [...container.querySelectorAll('p > span')];
    expect(chips).toHaveLength(2);
    for (const chip of chips) {
      expect(chip).not.toHaveAttribute('tabindex');
      expect(chip.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
    expect(within(chips[0] as HTMLElement).getByText('Teammate Priya Natarajan')).toBeInTheDocument();
    expect(within(chips[1] as HTMLElement).getByText('Tracked keyword managed soc')).toBeInTheDocument();
  });

  it('draws markup as characters: the only extra element is the chip', () => {
    const { container } = renderText('<img src=x onerror=alert(1)> @/pricing', [PAGE]);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelectorAll('p > *')).toHaveLength(1);
    expect(container.querySelector('p')).toHaveTextContent('<img src=x onerror=alert(1)>');
  });

  it('shows a label with markup in it as text only', () => {
    const odd: NoteMention = { type: 'keyword', label: '@"<b>x</b>"', target: '<b>x</b>' };
    const { container } = renderText('See @"<b>x</b>"', [odd]);
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('p')).toHaveTextContent('"<b>x</b>"');
  });

  it('keeps a long label on one line of the chip and gives its full words to assistive technology', () => {
    const long: NoteMention = { type: 'page', label: `@/${'a'.repeat(200)}`, target: '9', path: `/${'a'.repeat(200)}` };
    renderText(long.label, [long]);
    const chip = screen.getByRole('button', { name: `Open /${'a'.repeat(200)}` });
    expect(chip).toHaveClass('max-w-full');
    expect(chip.querySelector('.truncate')).not.toBeNull();
  });

  it('has no axe violations with every kind of chip', async () => {
    const { container } = renderText('@/pricing @Priya Natarajan @Missing title @"managed soc"', [
      PAGE,
      USER,
      ISSUE,
      KEYWORD,
    ]);
    expect(await axe(container)).toHaveNoViolations();
  });
});
