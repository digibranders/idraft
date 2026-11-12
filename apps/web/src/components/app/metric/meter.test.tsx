import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BudgetMeter, Meter, type MeterProps } from './meter';
import type { BudgetStatus } from '@/lib/api/types';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const quota: MeterProps = {
  value: 120,
  max: 150,
  label: 'Active prompts',
  valueText: '120 of 150 active prompts',
  width: 'summary',
};

const status = (state: BudgetStatus['state']): BudgetStatus['state'] => state;

describe('Meter', () => {
  it('states its real share in words when the fill stops at the end', () => {
    const { container } = renderWithProviders(<Meter {...quota} value={168} valueText="168 of 150 active prompts" />);
    const meter = screen.getByRole('meter', { name: 'Active prompts' });
    expect(meter).toHaveAttribute('aria-valuenow', '100');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter).toHaveAttribute('aria-valuetext', '168 of 150 active prompts');
    expect(meter).toHaveClass('w-40');
    expect(container.querySelector<HTMLElement>('.bg-warning-solid')?.style.width).toBe('100%');
  });

  it('stays muted until the quota is passed', () => {
    const under = renderWithProviders(<Meter {...quota} value={149} warnFrom={150} />);
    expect(under.container.querySelector<HTMLElement>('.bg-warning-solid')?.style.width).toBe('0%');
    expect(under.container.querySelector<HTMLElement>('.bg-foreground-muted')?.style.width).toMatch(/^99\.3/);
    under.unmount();
    const over = renderWithProviders(<Meter {...quota} value={151} warnFrom={150} />);
    expect(over.container.querySelector<HTMLElement>('.bg-warning-solid')?.style.width).toBe('100%');
    expect(over.container.querySelector<HTMLElement>('.bg-foreground-muted')?.style.width).toBe('0%');
  });

  it('turns warning from the soft limit, and wholly at the hard limit', () => {
    const soft = renderWithProviders(
      <BudgetMeter pct={90} softLimitPct={80} state={status('soft_exceeded')} size="cell" label="soft" />,
    );
    expect(soft.container.querySelector<HTMLElement>('.bg-foreground-muted')?.style.width).toBe('80%');
    const warning = soft.container.querySelector<HTMLElement>('.bg-warning-solid');
    expect(warning?.style.left).toBe('80%');
    expect(warning?.style.width).toBe('10%');
    soft.unmount();
    const hard = renderWithProviders(
      <BudgetMeter pct={140} softLimitPct={80} state={status('hard_exceeded')} size="cell" label="hard" />,
    );
    expect(hard.container.querySelector<HTMLElement>('.bg-foreground-muted')?.style.width).toBe('0%');
    const whole = hard.container.querySelector<HTMLElement>('.bg-warning-solid');
    expect(whole?.style.left).toBe('0%');
    expect(whole?.style.width).toBe('100%');
  });

  it('fills the whole track in warning with allWarning, whatever the share', () => {
    const { container } = renderWithProviders(<Meter {...quota} value={30} warnFrom={100} allWarning />);
    expect(container.querySelector<HTMLElement>('.bg-warning-solid')?.style.left).toBe('0%');
    expect(container.querySelector<HTMLElement>('.bg-warning-solid')?.style.width).toBe('20%');
    expect(container.querySelector<HTMLElement>('.bg-foreground-muted')?.style.width).toBe('0%');
  });

  it('marks the soft limit with a tick hidden from screen readers', () => {
    const { container } = renderWithProviders(<Meter {...quota} tick={120} />);
    const tick = container.querySelector<HTMLElement>('[style*="left: 80%"]');
    expect(tick).toHaveAttribute('aria-hidden', 'true');
    expect(tick).toHaveClass('w-0.5', 'h-2.5', 'bg-foreground-secondary');
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
  });

  it('draws no tick without one', () => {
    const { container } = renderWithProviders(<Meter {...quota} tick={null} />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('refuses a max that is not positive', () => {
    expect(() => Meter({ ...quota, max: 0 })).toThrow('Meter: max must be a positive number, got 0');
    expect(() => Meter({ ...quota, max: -5 })).toThrow('Meter: max must be a positive number, got -5');
    expect(() => Meter({ ...quota, max: Number.NaN })).toThrow('Meter: max must be a positive number');
  });

  it('treats a value that is not a number as empty', () => {
    renderWithProviders(<Meter {...quota} value={Number.NaN} />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
  });

  it('is clean for assistive technology at both widths', async () => {
    const { container } = renderWithProviders(
      <div>
        <Meter {...quota} tick={120} />
        <Meter {...quota} width="cell" label="Active prompts in a row" />
      </div>,
    );
    expect(screen.getAllByRole('meter')[1]).toHaveClass('w-16');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('BudgetMeter', () => {
  it('is a meter named for its share, with a tick at the soft limit and a fill that stays in its track', () => {
    const { container } = renderWithProviders(
      <BudgetMeter pct={64} softLimitPct={80} state="ok" size="summary" label="64.0% of $2,000.00" />,
    );
    const meter = screen.getByRole('meter', { name: '64.0% of $2,000.00' });
    expect(meter).toHaveAttribute('aria-valuenow', '64');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveClass('w-40');
    expect(container.querySelector<HTMLElement>('[style*="left: 80%"]')).not.toBeNull();
    expect(container.querySelector<HTMLElement>('[style*="width: 64%"]')).not.toBeNull();
  });

  it('reads the real share to assistive technology when it passes the end of the track', () => {
    renderWithProviders(
      <BudgetMeter pct={112} softLimitPct={80} state="hard_exceeded" size="summary" label="112.0% of $100.00" />,
    );
    const meter = screen.getByRole('meter', { name: '112.0% of $100.00' });
    expect(meter).toHaveAttribute('aria-valuenow', '100');
    expect(meter).toHaveAttribute('aria-valuetext', '112.0%');
  });

  it('turns warning from the soft limit up, and wholly warning once the limit is reached', () => {
    const soft = renderWithProviders(
      <BudgetMeter pct={90} softLimitPct={80} state={status('soft_exceeded')} size="cell" label="soft" />,
    );
    expect(screen.getByRole('meter', { name: 'soft' })).toHaveClass('w-16');
    expect(soft.container.querySelector<HTMLElement>('.bg-foreground-muted')?.style.width).toBe('80%');
    const warning = soft.container.querySelector<HTMLElement>('.bg-warning-solid');
    expect(warning?.style.left).toBe('80%');
    expect(warning?.style.width).toBe('10%');
    soft.unmount();
    const hard = renderWithProviders(
      <BudgetMeter pct={140} softLimitPct={80} state={status('hard_exceeded')} size="cell" label="hard" />,
    );
    expect(hard.container.querySelector<HTMLElement>('.bg-foreground-muted')?.style.width).toBe('0%');
    const whole = hard.container.querySelector<HTMLElement>('.bg-warning-solid');
    expect(whole?.style.left).toBe('0%');
    expect(whole?.style.width).toBe('100%');
  });

  it('treats a share that is not a number as zero', () => {
    renderWithProviders(<BudgetMeter pct={Number.NaN} softLimitPct={80} state="ok" size="cell" label="unknown" />);
    const meter = screen.getByRole('meter', { name: 'unknown' });
    expect(meter).toHaveAttribute('aria-valuenow', '0');
    expect(meter).toHaveAttribute('aria-valuetext', '0.0%');
  });
});
