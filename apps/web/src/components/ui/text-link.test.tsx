import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TextLink, type TextLinkProps } from './text-link';
import { axe } from '@/test/axe';

describe('TextLink', () => {
  it('is an anchor to its destination in the link color, underlined on hover and focus when it stands alone', () => {
    render(<TextLink href="/competitors">View all 20 competitors</TextLink>);
    const link = screen.getByRole('link', { name: 'View all 20 competitors' });
    expect(link).toHaveAttribute('href', '/competitors');
    expect(link).toHaveAttribute('data-slot', 'text-link');
    expect(link).toHaveClass('text-link', 'hover:underline', 'focus-visible:underline', 'focus-visible:focus-ring');
    expect(link).not.toHaveClass('underline');
  });

  it('is underlined at rest inside a sentence, where color alone would not mark it as a link', () => {
    render(
      <p>
        Rates use the{' '}
        <TextLink href="/methodology" variant="inline">
          Wilson interval
        </TextLink>
        .
      </p>,
    );
    expect(screen.getByRole('link')).toHaveClass('underline', 'text-link');
  });

  it('takes the color of the text around it when it inherits', () => {
    render(
      <TextLink href="/projects" tone="inherit">
        All projects
      </TextLink>,
    );
    expect(screen.getByRole('link')).toHaveClass('text-inherit');
    expect(screen.getByRole('link')).not.toHaveClass('text-link');
  });

  it('renders the router link it is given, with the same look and its own classes kept', () => {
    render(
      <TextLink render={<a href="/competitors" data-router="" className="ml-auto" />}>
        View all 20 competitors
      </TextLink>,
    );
    const link = screen.getByRole('link', { name: 'View all 20 competitors' });
    expect(link).toHaveAttribute('data-router');
    expect(link).toHaveAttribute('href', '/competitors');
    expect(link).toHaveAttribute('data-slot', 'text-link');
    expect(link).toHaveClass('ml-auto', 'text-link', 'hover:underline');
  });

  it('passes other attributes on to the anchor, in both forms', () => {
    render(
      <>
        <TextLink href="https://example.com/report" target="_blank" rel="noreferrer" aria-describedby="new-tab">
          Open report
        </TextLink>
        <TextLink render={<a href="/keywords" />} aria-current="page">
          Keywords
        </TextLink>
      </>,
    );
    const external = screen.getByRole('link', { name: 'Open report' });
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noreferrer');
    expect(external).toHaveAttribute('aria-describedby', 'new-tab');
    expect(screen.getByRole('link', { name: 'Keywords' })).toHaveAttribute('aria-current', 'page');
  });

  it('takes its destination from `href` or from the rendered link, never from both', () => {
    // @ts-expect-error the rendered link carries the destination
    const both: TextLinkProps = { href: '/a', render: <a href="/a" />, children: 'A' };
    // @ts-expect-error a link needs a destination
    const neither: TextLinkProps = { children: 'A' };
    expect([both, neither]).toHaveLength(2);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <p>
        Rates use the{' '}
        <TextLink href="/methodology" variant="inline">
          Wilson interval
        </TextLink>
        .
      </p>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
