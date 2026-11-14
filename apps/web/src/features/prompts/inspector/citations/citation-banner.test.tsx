import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CitationBanner } from './citation-banner';
import { axe } from '@/test/axe';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

const LAST_ANSWER = '2026-11-11T09:05:00Z';

const renderBanner = (over: Partial<Parameters<typeof CitationBanner>[0]> = {}): ProvidedRender =>
  renderWithProviders(
    <CitationBanner cited={3} answers={8} lastAnswerAt={LAST_ANSWER} ownPages={4} timeZone="UTC" {...over} />,
  );

const bannerOf = (container: HTMLElement): HTMLElement => {
  const banner = container.querySelector<HTMLElement>('[data-slot="banner"]');
  if (banner === null) throw new Error('No banner is drawn');
  return banner;
};

describe('the citation banner', () => {
  it('says Cited in 3 of 8 answers with the last answer and the own pages', () => {
    renderBanner();
    expect(
      screen.getByText('Cited in 3 of 8 answers; last answer Nov 11, 09:05; 4 own pages cited'),
    ).toBeInTheDocument();
  });

  it('says one own page in the singular', () => {
    renderBanner({ cited: 1, answers: 1, ownPages: 1 });
    expect(screen.getByText('Cited in 1 of 1 answer; last answer Nov 11, 09:05; 1 own page cited')).toBeInTheDocument();
  });

  it('uses the info tone when the own domain is cited and the neutral tone when it is not', () => {
    const cited = renderBanner();
    expect(bannerOf(cited.container).className).toContain('bg-info-subtle');
    cited.unmount();
    const notCited = renderBanner({ cited: 0, ownPages: 0 });
    expect(bannerOf(notCited.container).className).toContain('bg-surface-subtle');
    expect(bannerOf(notCited.container).className).not.toContain('bg-info-subtle');
  });

  it('says Cited in 0 of 8 answers, with no count of own pages, when it is not cited', () => {
    renderBanner({ cited: 0, ownPages: 0 });
    expect(screen.getByText('Cited in 0 of 8 answers; last answer Nov 11, 09:05')).toBeInTheDocument();
    expect(screen.queryByText(/own page/)).toBeNull();
  });

  it('leaves the own pages out when their count is not known', () => {
    renderBanner({ ownPages: null });
    expect(screen.getByText('Cited in 3 of 8 answers; last answer Nov 11, 09:05')).toBeInTheDocument();
  });

  it('says there is nothing to count with 0 answers, and draws no banner', () => {
    const { container } = renderBanner({ cited: 0, answers: 0, ownPages: 0 });
    expect(screen.getByText('No answers in this window, so there is nothing to count.')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="banner"]')).toBeNull();
  });

  it('draws nothing while the time of the last answer is not known', () => {
    const { container } = renderBanner({ lastAnswerAt: null });
    expect(container.querySelector('[data-slot="banner"]')).toBeNull();
    expect(screen.queryByText(/Cited in/)).toBeNull();
  });

  it('is a status, since it appears once the reads have answered', () => {
    const { container } = renderBanner();
    expect(bannerOf(container)).toHaveAttribute('role', 'status');
  });

  it('is axe clean', async () => {
    const { container } = renderBanner();
    expect(await axe(container)).toHaveNoViolations();
  });
});
