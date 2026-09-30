import { screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Search } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { Avatar } from './avatar';
import { Badge } from './badge';
import { Icon } from './icon';
import { Kbd } from './kbd';
import { LinkButton } from './link-button';
import { Separator } from './separator';
import { Skeleton } from './skeleton';
import { Spinner } from './spinner';
import { TextLink } from './text-link';
import { Tooltip } from './tooltip';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const popup = (): Element | null => document.querySelector('[data-slot="tooltip"]');
const open = async (): Promise<Element> => {
  await waitFor(() => expect(popup()).not.toBeNull());
  return popup() as Element;
};

describe('Tooltip', () => {
  it('is closed until the trigger is hovered, then shows its text', async () => {
    const { user } = renderWithProviders(
      <Tooltip content="Volume-weighted visibility">
        <button type="button">Visibility</button>
      </Tooltip>,
    );
    expect(popup()).toBeNull();
    await user.hover(screen.getByRole('button', { name: 'Visibility' }));
    expect(await open()).toHaveTextContent('Volume-weighted visibility');
  });

  it('opens on keyboard focus and closes with Escape', async () => {
    const { user } = renderWithProviders(
      <Tooltip content="Copy the URL">
        <button type="button">Copy</button>
      </Tooltip>,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Copy' })).toHaveFocus();
    expect(await open()).toHaveTextContent('Copy the URL');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(popup()).toBeNull());
  });

  it('shows a second line and the shortcut, and exposes the shortcut on the trigger', async () => {
    const { user } = renderWithProviders(
      <Tooltip content="34%" detail="612 of 1,800 responses" shortcut={['mod', 'k']}>
        <button type="button">Mention rate</button>
      </Tooltip>,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-keyshortcuts', 'Control+k');
    await user.hover(screen.getByRole('button'));
    expect(await open()).toHaveTextContent('612 of 1,800 responses');
    expect([...document.querySelectorAll('kbd')].map((node) => node.textContent)).toEqual(['Ctrl', 'K']);
  });

  it('leaves a shortcut the trigger already declares', () => {
    renderWithProviders(
      <Tooltip content="Search" shortcut={['mod', 'k']}>
        <button type="button" aria-keyshortcuts="/">
          Search
        </button>
      </Tooltip>,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-keyshortcuts', '/');
  });

  it('describes the trigger, open or closed, so a screen reader reads it after the name', () => {
    renderWithProviders(
      <Tooltip content="Volume-weighted" detail="986 keywords">
        <button type="button">Visibility</button>
      </Tooltip>,
    );
    expect(popup()).toBeNull();
    expect(screen.getByRole('button', { name: 'Visibility' })).toHaveAccessibleDescription(
      'Volume-weighted 986 keywords',
    );
  });

  it('keeps a description the trigger already has', () => {
    renderWithProviders(
      <>
        <Tooltip content="Runs on the next check">
          <button type="button" aria-describedby="quota">
            Run now
          </button>
        </Tooltip>
        <span id="quota">3 of 5 runs left</span>
      </>,
    );
    expect(screen.getByRole('button')).toHaveAccessibleDescription('3 of 5 runs left Runs on the next check');
  });

  it('keeps that description when the trigger arrives from a Server Component as a lazy reference', () => {
    // What the React server renderer hands a client component in development: a lazy wrapper, not an element
    const fromServer = {
      $$typeof: Symbol.for('react.lazy'),
      _payload: (
        <button type="button" aria-describedby="quota">
          Run now
        </button>
      ),
      _init: (payload: ReactElement): ReactElement => payload,
    } as unknown as ReactElement<{ 'aria-describedby'?: string }>;
    renderWithProviders(
      <>
        <Tooltip content="Runs on the next check">{fromServer}</Tooltip>
        <span id="quota">3 of 5 runs left</span>
      </>,
    );
    expect(screen.getByRole('button')).toHaveAccessibleDescription('3 of 5 runs left Runs on the next check');
  });

  it('is not announced a second time from the popup', async () => {
    const { user } = renderWithProviders(
      <Tooltip content="Volume-weighted">
        <button type="button">Visibility</button>
      </Tooltip>,
    );
    await user.hover(screen.getByRole('button'));
    expect(await open()).toHaveAttribute('aria-hidden', 'true');
  });

  it('does not describe the trigger when it only repeats its name', async () => {
    const { user } = renderWithProviders(
      <Tooltip content="Close" purpose="label">
        <button type="button" aria-label="Close" />
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'Close' });
    expect(button).not.toHaveAttribute('aria-describedby');
    await user.hover(button);
    expect(await open()).toHaveTextContent('Close');
  });

  it('neither opens nor describes the trigger when it is disabled', async () => {
    const { user } = renderWithProviders(
      <>
        <Tooltip content="Full value" disabled>
          <button type="button">Short</button>
        </Tooltip>
        <Tooltip content="Other">
          <button type="button">Next</button>
        </Tooltip>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Short' })).not.toHaveAttribute('aria-describedby');
    // Without a hover delay an enabled tooltip is open when `hover` resolves, as the second one shows
    await user.hover(screen.getByRole('button', { name: 'Short' }));
    expect(popup()).toBeNull();
    await user.hover(screen.getByRole('button', { name: 'Next' }));
    expect(popup()).toHaveTextContent('Other');
  });

  it('asks before it opens, and stays closed on a no', async () => {
    const shouldOpen = vi.fn(() => false);
    const { user } = renderWithProviders(
      <>
        <Tooltip content="Full value" shouldOpen={shouldOpen}>
          <button type="button">Fits</button>
        </Tooltip>
        <Tooltip content="Other" shouldOpen={() => true}>
          <button type="button">Next</button>
        </Tooltip>
      </>,
    );
    await user.hover(screen.getByRole('button', { name: 'Fits' }));
    expect(shouldOpen).toHaveBeenCalled();
    expect(popup()).toBeNull();
    await user.hover(screen.getByRole('button', { name: 'Next' }));
    expect(popup()).toHaveTextContent('Other');
  });

  it.each<[string, () => ReactElement<{ 'aria-describedby'?: string }>]>([
    ['Badge', () => <Badge tone="info">Estimate</Badge>],
    ['Icon', () => <Icon icon={Search} label="Search" />],
    ['Avatar', () => <Avatar name="Ana Brandt" />],
    ['TextLink', () => <TextLink href="/methodology">Methodology</TextLink>],
    ['TextLink with a rendered link', () => <TextLink render={<a href="/methodology" />}>Methodology</TextLink>],
    ['LinkButton', () => <LinkButton render={<a href="/projects" />}>Open project</LinkButton>],
    ['Spinner', () => <Spinner label="Loading" />],
    ['Kbd', () => <Kbd keys={['mod', 'k']} />],
    ['Skeleton', () => <Skeleton shape="badge" />],
    ['Separator', () => <Separator />],
  ])('works on %s, because primitives pass their props and their ref on', async (_name, primitive) => {
    const { user, container } = renderWithProviders(
      <Tooltip content="Modeled from 40 responses">{primitive()}</Tooltip>,
    );
    const trigger = container.querySelector('[data-slot]');
    if (!(trigger instanceof Element)) throw new Error('The primitive has no data-slot');
    expect(trigger).toHaveAccessibleDescription('Modeled from 40 responses');
    await user.hover(trigger);
    expect(popup()).toHaveTextContent('Modeled from 40 responses');
  });

  it.each(['top', 'bottom', 'right'] as const)('opens on the %s side', async (side) => {
    const { user } = renderWithProviders(
      <Tooltip content="Keywords" side={side}>
        <button type="button">Keywords</button>
      </Tooltip>,
    );
    await user.hover(screen.getByRole('button'));
    expect((await open()).closest('[data-side]')).toHaveAttribute('data-side', side);
  });

  it('has no accessibility violations, closed or open', async () => {
    const { user, baseElement } = renderWithProviders(
      <Tooltip content="Explains the control" shortcut={['mod', 'k']}>
        <button type="button">Control</button>
      </Tooltip>,
    );
    expect(await axe(baseElement)).toHaveNoViolations();
    await user.hover(screen.getByRole('button'));
    await open();
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
