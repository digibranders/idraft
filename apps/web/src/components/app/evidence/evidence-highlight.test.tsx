import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EvidenceHighlight, type HighlightEntity } from './evidence-highlight';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const OWN: HighlightEntity = { name: 'Fynix', own: true, colorIndex: 1 };
const RIVAL: HighlightEntity = { name: 'Northwind', own: false, colorIndex: 3 };

describe('EvidenceHighlight', () => {
  it('names the mention with its entity, match and confidence, and is not a tab stop', async () => {
    const { container } = renderWithProviders(
      <p>
        Agencies often pick{' '}
        <EvidenceHighlight entity={RIVAL} matchLabel="word boundary match" confidence={0.95} certainty="certain">
          Northwind
        </EvidenceHighlight>{' '}
        for audits.
      </p>,
    );
    const mark = screen.getByText('Northwind');
    expect(mark.tagName).toBe('MARK');
    expect(mark).toHaveAttribute('aria-label', 'Northwind mention, word boundary match, confidence 0.95');
    expect(mark).not.toHaveAttribute('tabindex');
    expect(mark).toHaveClass('bg-entity-3-highlight', 'border-chart-3', 'border-l-2', 'text-foreground');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('draws the own brand in the accent tints, without an edge', () => {
    renderWithProviders(
      <EvidenceHighlight entity={OWN} matchLabel="exact match" confidence={1} certainty="certain">
        Fynix
      </EvidenceHighlight>,
    );
    const mark = screen.getByText('Fynix');
    expect(mark).toHaveClass('bg-primary-subtle', 'text-primary-text', 'type-inline-strong');
    expect(mark).not.toHaveClass('border-l-2');
  });

  it('says an uncertain match is left out of rates, with a dashed edge and no fill', () => {
    renderWithProviders(
      <EvidenceHighlight entity={RIVAL} matchLabel="word boundary match" confidence={0.42} certainty="uncertain">
        northwind
      </EvidenceHighlight>,
    );
    const mark = screen.getByText('northwind');
    expect(mark).toHaveAttribute(
      'aria-label',
      'Northwind mention, word boundary match, confidence 0.42. Uncertain match, excluded from rates',
    );
    expect(mark).toHaveClass('border-dashed', 'border-chart-3', 'bg-transparent');
    expect(mark).not.toHaveClass('bg-entity-3-highlight');
  });

  it('names the product a mention came through, and uses chart-other past the sixth entity', () => {
    renderWithProviders(
      <EvidenceHighlight
        entity={{ name: 'HubSpot', own: false, colorIndex: null }}
        matchLabel="word boundary match"
        confidence={0.9}
        certainty="certain"
        viaProduct="Sales Hub"
      >
        Sales Hub
      </EvidenceHighlight>,
    );
    const mark = screen.getByText('Sales Hub');
    expect(mark).toHaveAttribute('aria-label', 'HubSpot via Sales Hub mention, word boundary match, confidence 0.90');
    expect(mark).toHaveClass('bg-entity-other-highlight', 'border-chart-other', 'border-dashed');
  });
});
