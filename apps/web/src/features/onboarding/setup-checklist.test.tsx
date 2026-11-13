import { screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SetupChecklist } from './setup-checklist';
import type { SetupStep } from './setup-steps';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

/**
 * The setup checklist as a presentational component (23-application-patterns.md section 13, 25 section 13.1).
 * No page mounts it yet: the Overview owner (WP-33 or WP-40) mounts `AiSetupChecklist` later, so these tests
 * are the proof of the component.
 *
 * States: collapsed, expanded and complete are covered here. Loading, error, partial and stale belong to the
 * container, which reads the data (ai-setup-checklist.test.tsx); this component takes finished steps. Empty does
 * not apply: a checklist with no steps is not rendered by its container.
 */

const STEPS: SetupStep[] = [
  { id: 'engines', name: 'Select AI engines', done: true, fact: '2 of 3 engines on' },
  {
    id: 'prompts',
    name: 'Add prompts',
    done: false,
    fact: '0 active prompts',
    action: { label: 'Add prompts', href: '/acme/fynix/ai/prompts' as Route },
  },
  {
    id: 'answers',
    name: 'First answers',
    done: false,
    fact: 'Needs engines and prompts',
  },
];
const DONE: SetupStep[] = STEPS.map((step) => ({ id: step.id, name: step.name, done: true }));

interface HarnessProps {
  steps?: SetupStep[];
  progressText?: string;
  startExpanded?: boolean;
  onDismiss?: () => void;
  onExpandedChange?: (expanded: boolean) => void;
}

function Harness({
  steps = STEPS,
  progressText = 'Setup: 1 of 3 steps complete',
  startExpanded = false,
  onDismiss,
  onExpandedChange,
}: HarnessProps): ReactElement {
  const [expanded, setExpanded] = useState(startExpanded);
  return (
    <SetupChecklist
      steps={steps}
      progressText={progressText}
      expanded={expanded}
      onExpandedChange={(next) => {
        onExpandedChange?.(next);
        setExpanded(next);
      }}
      continueHref={'/acme/fynix/ai/prompts' as Route}
      {...(onDismiss === undefined ? {} : { onDismiss })}
    />
  );
}

describe('SetupChecklist, collapsed', () => {
  it('is a 40 px bar by default: the count, a progress bar, Continue setup and Show steps, no list', () => {
    renderWithProviders(<Harness />);
    const region = screen.getByRole('region', { name: 'Project setup' });
    expect(within(region).getByText('Setup: 1 of 3 steps complete')).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: 'Continue setup' })).toHaveAttribute(
      'href',
      '/acme/fynix/ai/prompts',
    );
    const toggle = within(region).getByRole('button', { name: 'Show steps' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('draws the progress as a progress bar with its value and a text for it', () => {
    renderWithProviders(<Harness />);
    const bar = screen.getByRole('progressbar', { name: 'Setup progress' });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '3');
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuetext', 'Setup: 1 of 3 steps complete');
  });

  it('is axe clean', async () => {
    const { container } = renderWithProviders(<Harness />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('SetupChecklist, expanded', () => {
  it('lists every step with its state spoken, its fact and, for a step to do, its action', () => {
    renderWithProviders(<Harness startExpanded />);
    const list = screen.getByRole('list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    // Done first, then the two still to do: the words a screen reader hears come before the name
    expect(rows[0]).toHaveTextContent('Done: Select AI engines');
    expect(rows[0]).toHaveTextContent('2 of 3 engines on');
    expect(rows[1]).toHaveTextContent('To do: Add prompts');
    expect(rows[2]).toHaveTextContent('To do: First answers');
    expect(rows[2]).toHaveTextContent('Needs engines and prompts');
    expect(within(rows[0] as HTMLElement).queryByRole('link')).not.toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: 'Add prompts' })).toHaveAttribute(
      'href',
      '/acme/fynix/ai/prompts',
    );
    expect(within(rows[2] as HTMLElement).queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the could not be checked fact at every width, since it is what tells that step from a plain to do', () => {
    const steps: SetupStep[] = [
      { id: 'engines', name: 'Select AI engines', done: false, fact: 'Could not be checked', unchecked: true },
      { id: 'prompts', name: 'Add prompts', done: false, fact: '0 active prompts' },
    ];
    renderWithProviders(<Harness steps={steps} startExpanded />);
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    const unchecked = within(rows[0] as HTMLElement).getByText('Could not be checked');
    expect(rows[0]).toHaveTextContent('To do: Select AI engines');
    expect(rows[0]).toHaveTextContent('Could not be checked');
    // Not display:none below 640 px: no `hidden` class, and none paired with `sm:inline` to bring it back
    expect(unchecked.classList.contains('hidden')).toBe(false);
    expect(unchecked.classList.contains('sm:inline')).toBe(false);
    // An ordinary fact keeps the preview's phone layout: hidden below 640 px
    const ordinary = within(rows[1] as HTMLElement).getByText('0 active prompts');
    expect(ordinary.classList.contains('hidden')).toBe(true);
    expect(ordinary.classList.contains('sm:inline')).toBe(true);
  });

  it('names the toggle Hide steps while open', () => {
    renderWithProviders(<Harness startExpanded />);
    const toggle = screen.getByRole('button', { name: 'Hide steps' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', screen.getByRole('list').id);
  });

  it('opens and closes with the button', async () => {
    const onExpandedChange = vi.fn();
    const { user } = renderWithProviders(<Harness onExpandedChange={onExpandedChange} />);
    await user.click(screen.getByRole('button', { name: 'Show steps' }));
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('list')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide steps' }));
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('is axe clean', async () => {
    const { container } = renderWithProviders(<Harness startExpanded />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('SetupChecklist, keyboard', () => {
  it('opens the steps with Enter and with Space, and closes them again', async () => {
    const onExpandedChange = vi.fn();
    const { user } = renderWithProviders(<Harness onExpandedChange={onExpandedChange} />);
    screen.getByRole('button', { name: 'Show steps' }).focus();
    await user.keyboard('{Enter}');
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);
    await user.keyboard(' ');
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
    await user.keyboard(' ');
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);
    expect(onExpandedChange).toHaveBeenCalledTimes(3);
  });

  it('tabs from the bar to Continue setup, then Show steps, then the links of the rows', async () => {
    const { user } = renderWithProviders(<Harness startExpanded />);
    await user.tab();
    expect(screen.getByRole('link', { name: 'Continue setup' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Hide steps' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Add prompts' })).toHaveFocus();
  });
});

describe('SetupChecklist, complete', () => {
  it('reads Setup complete, with no Continue setup and no Dismiss while nothing handles dismissal', () => {
    renderWithProviders(<Harness steps={DONE} progressText="Setup: 3 of 3 steps complete" />);
    expect(screen.getByText('Setup complete')).toBeInTheDocument();
    expect(screen.queryByText('Setup: 3 of 3 steps complete')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Continue setup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('aria-valuenow', '3');
  });

  it('offers Dismiss when the owner of the page handles it', async () => {
    const onDismiss = vi.fn();
    const { user } = renderWithProviders(
      <Harness steps={DONE} progressText="Setup: 3 of 3 steps complete" onDismiss={onDismiss} />,
    );
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('cannot be dismissed before it is complete, even when a handler is given', () => {
    renderWithProviders(<Harness onDismiss={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
  });

  it('is axe clean', async () => {
    const { container } = renderWithProviders(
      <Harness steps={DONE} progressText="Setup: 3 of 3 steps complete" onDismiss={vi.fn()} startExpanded />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
