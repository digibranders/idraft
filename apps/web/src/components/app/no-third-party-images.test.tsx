import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { DomainCell } from './cells/domain-cell';
import { URLCell } from './cells/url-cell';
import { ProjectMark } from './shell/project-mark';
import { renderWithProviders } from '@/test/render';

/** A cited domain must never be sent to a third party: no image of the app may point at a host outside it. */
const isFirstParty = (src: string): boolean => src.startsWith('/') || src.startsWith('data:') || src.startsWith('blob:');

describe('images that name a cited domain', () => {
  it('draw no image at all until the app has an icon route of its own, only the placeholder', () => {
    const { container } = renderWithProviders(
      <>
        <DomainCell host="hubspot.com" registrable="hubspot.com" favicon="show" />
        <URLCell url="https://www.g2.com/products/crm" hostDisplay="show" label="cited page" favicon="show" />
        <ProjectMark name="Eventus" domain="eventussecurity.com" />
      </>,
    );
    const sources = [...container.querySelectorAll('img')].map((image) => image.getAttribute('src') ?? '');
    expect(sources.filter((src) => !isFirstParty(src))).toEqual([]);
    expect(container.querySelectorAll('[data-slot="favicon-placeholder"]').length).toBe(2);
    expect(container).toHaveTextContent('E');
  });

  it('are not built from a third-party favicon host anywhere in the source', () => {
    const root = path.join(import.meta.dirname, '../../..');
    const files = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === '.next' ? [] : files(entryPath);
        return /\.(tsx?|js|mjs|html)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [entryPath] : [];
      });
    const offenders = ['src', 'design-preview'].flatMap((directory) =>
      files(path.join(root, directory)).filter((file) =>
        /google\.com\/s2|gstatic\.com|favicon\.(?:yandex|ico\.)|icon\.horse|faviconkit/i.test(
          readFileSync(file, 'utf8'),
        ),
      ),
    );
    expect(offenders.map((file) => path.relative(root, file))).toEqual([]);
  });
});
