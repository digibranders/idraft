import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChangeInline } from './change-inline';
import { DETECTABLE, WITHIN, cell, engineOf } from './change-test-data';
import type { RateChange } from '@/lib/compare/change-model';
import { engineChangeOf } from '@/lib/compare/change-model';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const change = (pair: readonly [ReturnType<typeof cell>, ReturnType<typeof cell>]): RateChange | null =>
  engineChangeOf([engineOf('chatgpt_web', pair[0], pair[1])], 'chatgpt_web', 'mentioned');

const FALL = change([cell(12, 60), cell(30, 60)]);

describe('ChangeInline', () => {
  it('colours a detectable change by its polarity and says it is detectable and interim', () => {
    renderWithProviders(<ChangeInline change={change(DETECTABLE)} />);
    expect(screen.getByText('+30.0 pts')).toHaveClass('text-positive-text');
    expect(screen.getByText('up 30.0 pts, detectable, interim test')).toBeInTheDocument();
  });

  it('colours a detectable fall by its polarity, the sign alone decides nothing', () => {
    renderWithProviders(<ChangeInline change={FALL} />);
    expect(screen.getByText(/30\.0 pts$/)).toHaveClass('text-negative-text');
  });

  it('keeps a change within normal variation neutral and says so', () => {
    renderWithProviders(<ChangeInline change={change(WITHIN)} />);
    const text = screen.getByText('+6.7 pts');
    expect(text).toHaveClass('text-foreground-secondary');
    expect(text).not.toHaveClass('text-positive-text');
    expect(screen.getByText('up 6.7 pts, within normal variation, interim test')).toBeInTheDocument();
  });

  it('keeps a change that cannot be tested neutral and says nothing about variation', () => {
    const untested = change(DETECTABLE);
    renderWithProviders(<ChangeInline change={untested === null ? null : { ...untested, detectable: null }} />);
    expect(screen.getByText('+30.0 pts')).toHaveClass('text-foreground-secondary');
    expect(screen.getByText('up 30.0 pts')).toBeInTheDocument();
  });

  it('holds its hidden text inside a positioned box, so it cannot widen a scroller around it', () => {
    const { container } = renderWithProviders(<ChangeInline change={change(DETECTABLE)} />);
    const hidden = container.querySelector('.sr-only');
    // The visually hidden text is absolutely placed: it needs a positioned ancestor inside this component
    expect(hidden?.closest('.relative')).not.toBeNull();
    expect(container.contains(hidden?.closest('.relative') ?? null)).toBe(true);
  });

  it('says no change, not up or down, for a change that rounds to 0 pts', () => {
    // 29.98 of 60 against 30 of 60 is a fall of 0.03 points: the text rounds to 0 pts
    const tiny = change(DETECTABLE);
    renderWithProviders(<ChangeInline change={tiny === null ? null : { ...tiny, points: -0.0003 }} />);
    expect(screen.getByText('0 pts')).toBeInTheDocument();
    expect(screen.getByText(/^no change/)).toBeInTheDocument();
    expect(screen.queryByText(/^(up|down) /)).toBeNull();
  });

  it('draws nothing for a change that is not known, never a zero', () => {
    const { container } = renderWithProviders(<ChangeInline change={null} />);
    expect(container.querySelector('.num')).toBeNull();
    expect(container).not.toHaveTextContent(/pts|0/);
  });

  it('draws nothing while comparison is off, whatever the change', () => {
    const { container } = renderWithProviders(<ChangeInline change={change(DETECTABLE)} />, {
      searchParams: '?cmp=off',
    });
    expect(container.querySelector('.num')).toBeNull();
    expect(container).not.toHaveTextContent(/pts/);
  });

  it('is not a tab stop of its own: the cell or chip that holds it carries the tooltip', async () => {
    const { container } = renderWithProviders(<ChangeInline change={change(DETECTABLE)} />);
    expect(container.querySelector('[tabindex]')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});
