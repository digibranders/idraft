import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DesignSystemLayout from './layout';
import DesignSystemIndex from './page';
import SectionPage, { dynamicParams, generateMetadata, generateStaticParams } from './[section]/page';
import { PREVIEW_SECTIONS } from '@/components/design-system/registry';
import type { AppEnvironment } from '@/lib/env/public';
import { renderWithProviders } from '@/test/render';

const env = vi.hoisted(() => ({ NEXT_PUBLIC_APP_ENV: 'development' as AppEnvironment }));
vi.mock('@/lib/env/public', () => ({ publicEnv: env }));
vi.mock('next/navigation', async (original) => ({
  ...(await original<typeof import('next/navigation')>()),
  usePathname: (): string => '/design-system/tokens',
}));

/** What `notFound()` throws: Next.js reads the status from the digest of the error. */
const NOT_FOUND = expect.objectContaining({ digest: expect.stringContaining('404') as unknown });

describe('the design-system layout', () => {
  beforeEach(() => {
    env.NEXT_PUBLIC_APP_ENV = 'development';
  });

  it('does not exist in production', () => {
    env.NEXT_PUBLIC_APP_ENV = 'production';
    expect(() => DesignSystemLayout({ children: null })).toThrow(NOT_FOUND);
  });

  it.each(['development', 'test'] as const)('lists every section in %s, with the one on screen current', (mode) => {
    env.NEXT_PUBLIC_APP_ENV = mode;
    renderWithProviders(
      <DesignSystemLayout>
        <p>Section content</p>
      </DesignSystemLayout>,
    );
    const nav = screen.getByRole('navigation', { name: 'Design system sections' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(PREVIEW_SECTIONS.map((section) => section.title));
    expect(within(nav).getByRole('link', { current: 'page' })).toHaveTextContent('Color tokens');
    expect(within(screen.getByRole('main')).getByText('Section content')).toBeInTheDocument();
  });

  it('offers the three theme choices', () => {
    renderWithProviders(<DesignSystemLayout>{null}</DesignSystemLayout>);
    const theme = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(within(theme).getAllByRole('radio')).toHaveLength(3);
    for (const name of ['Light', 'Dark', 'System']) {
      expect(within(theme).getByRole('radio', { name })).toBeInTheDocument();
    }
  });
});

const params = (section: string): { params: Promise<{ section: string }> } => ({
  params: Promise.resolve({ section }),
});

describe('the section page', () => {
  beforeEach(() => {
    env.NEXT_PUBLIC_APP_ENV = 'development';
  });

  it('is built for the registered sections and no other', () => {
    expect(dynamicParams).toBe(false);
    expect(generateStaticParams()).toEqual(PREVIEW_SECTIONS.map((section) => ({ section: section.slug })));
  });

  it('renders the section under its title, and names the page after it', async () => {
    renderWithProviders(<>{await SectionPage(params('badges'))}</>);
    expect(screen.getByRole('heading', { level: 1, name: 'Badges' })).toBeInTheDocument();
    expect(await generateMetadata(params('badges'))).toEqual({ title: 'Badges' });
  });

  it('is a 404 for a slug that is no section', async () => {
    await expect(SectionPage(params('display'))).rejects.toEqual(NOT_FOUND);
    expect(await generateMetadata(params('display'))).toEqual({});
  });

  // A client navigation can render a page without running the layout again, so each page has its own gate
  it('is built for no section in production, and is a 404 there even for a registered one', async () => {
    env.NEXT_PUBLIC_APP_ENV = 'production';
    expect(generateStaticParams()).toEqual([]);
    await expect(SectionPage(params('badges'))).rejects.toEqual(NOT_FOUND);
    expect(await generateMetadata(params('badges'))).toEqual({});
  });
});

describe('the index page', () => {
  it('sends the reader to the first section', () => {
    env.NEXT_PUBLIC_APP_ENV = 'development';
    expect(() => DesignSystemIndex()).toThrow(
      expect.objectContaining({ digest: expect.stringContaining('/design-system/tokens') as unknown }),
    );
  });

  it('is a 404 in production', () => {
    env.NEXT_PUBLIC_APP_ENV = 'production';
    expect(() => DesignSystemIndex()).toThrow(NOT_FOUND);
  });
});

describe('the title of the route', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it.each([
    ['development', { title: { default: 'Design system', template: '%s: design system' } }],
    ['production', {}],
  ] as const)('in %s', async (mode, expected) => {
    env.NEXT_PUBLIC_APP_ENV = mode;
    vi.resetModules();
    const { metadata } = await import('./layout');
    expect(metadata).toEqual(expected);
  });
});
