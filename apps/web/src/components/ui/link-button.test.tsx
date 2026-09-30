import { render, screen } from '@testing-library/react';
import { Download } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { LinkButton } from './link-button';
import { axe } from '@/test/axe';

describe('LinkButton', () => {
  it('is a link that looks like a button', () => {
    render(
      <LinkButton variant="primary" icon={Download} render={<a href="/projects" />}>
        Open project
      </LinkButton>,
    );
    const link = screen.getByRole('link', { name: 'Open project' });
    expect(link).toHaveAttribute('href', '/projects');
    expect(link).toHaveClass('bg-primary', 'h-control', 'type-body-strong');
    expect(link).not.toHaveAttribute('type');
    expect(link).toHaveAttribute('data-slot', 'link-button');
    expect(link.querySelector('svg')).toHaveClass('size-icon');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the classes of the link it was given', () => {
    render(
      <LinkButton size="sm" render={<a href="/x" className="ml-auto" />}>
        View all
      </LinkButton>,
    );
    expect(screen.getByRole('link')).toHaveClass('ml-auto', 'h-control-sm');
  });

  it('passes other attributes on to the link', () => {
    render(
      <LinkButton render={<a href="/keywords" />} aria-current="page" data-testid="nav" id="keywords-link">
        Keywords
      </LinkButton>,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link).toHaveAttribute('id', 'keywords-link');
    expect(link).toHaveAttribute('data-testid', 'nav');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <LinkButton icon={Download} render={<a href="/exports" />}>
        Exports
      </LinkButton>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
