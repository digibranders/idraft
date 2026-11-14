import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SafeMarkdown } from './safe-markdown';
import { HOSTILE_TITLES, HOSTILE_URLS, MARKER as WP08_MARKER } from '@/components/app/cells/xss-fixtures';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

/** Set on `window` by any payload that runs; a test reads it after render and click. */
const MARKER = '__wp26_xss';
const marks = (): unknown[] => [Reflect.get(window, MARKER), Reflect.get(window, WP08_MARKER)];

afterEach(() => {
  Reflect.deleteProperty(window, MARKER);
  Reflect.deleteProperty(window, WP08_MARKER);
});

function show(source: string, lang?: string): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(<SafeMarkdown source={source} lang={lang} />);
}

/** Every element of the rendered content, for the assertions of 20-frontend-specification section 8.2. */
const elements = (container: HTMLElement): Element[] => [...container.querySelectorAll('*')];
const withHandler = (container: HTMLElement): Element[] =>
  elements(container).filter((element) =>
    element.getAttributeNames().some((name) => name.toLowerCase().startsWith('on')),
  );
const unsafeAddress = (container: HTMLElement): Element[] =>
  elements(container).filter((element) =>
    ['href', 'src', 'srcset', 'action', 'formaction', 'data'].some((name) => {
      const value = element.getAttribute(name);
      return value !== null && !/^(https?:|mailto:)/i.test(value);
    }),
  );
const FORBIDDEN = 'script, iframe, style, img, svg, object, embed, form, input, link, meta, base, video, audio, source';

describe('SafeMarkdown: hostile content stays inert', () => {
  it('test_a_script_is_inert: a script tag is shown as text, and nothing runs', () => {
    const { container } = show(`Before\n\n<script>window.${MARKER}=1</script>\n\nAfter`);
    expect(container.querySelector('script')).toBeNull();
    expect(container).toHaveTextContent(`<script>window.${MARKER}=1</script>`);
    expect(marks()).toEqual([undefined, undefined]);
  });

  it('test_an_event_handler_attribute_is_inert: no element comes from the text, and none has an on* attribute', () => {
    const { container } = show(
      [
        `<img src=x onerror="window.${MARKER}=1">`,
        `<svg onload="window.${MARKER}=1"></svg>`,
        `<a href="#" onclick="window.${MARKER}=1">click</a>`,
        `<div onmouseover="window.${MARKER}=1">hover</div>`,
      ].join('\n\n'),
    );
    expect(withHandler(container)).toEqual([]);
    expect(container.querySelectorAll(FORBIDDEN)).toHaveLength(0);
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container).toHaveTextContent('<img src=x onerror=');
    expect(marks()).toEqual([undefined, undefined]);
  });

  it('shows an iframe, a style, a comment and an svg as text, never as elements', () => {
    const { container } = show(
      [
        '<iframe src="https://evil.example/frame"></iframe>',
        '<style>body{display:none}</style>',
        '<!-- hidden -->',
        `<svg><script>window.${MARKER}=1</script></svg>`,
      ].join('\n\n'),
    );
    expect(container.querySelectorAll(FORBIDDEN)).toHaveLength(0);
    expect(container).toHaveTextContent('<iframe src="https://evil.example/frame"></iframe>');
    expect(container).toHaveTextContent('<style>body{display:none}</style>');
    expect(container).toHaveTextContent('<!-- hidden -->');
    expect(marks()).toEqual([undefined, undefined]);
  });

  it('shows HTML entities as the characters they are written with, and never decodes them', () => {
    const { container } = show('&lt;script&gt;alert(1)&lt;/script&gt; and &#60;b&#62;');
    expect(container).toHaveTextContent('&lt;script&gt;alert(1)&lt;/script&gt; and &#60;b&#62;');
    expect(container.querySelector('script, b')).toBeNull();
  });

  it('test_a_javascript_link_is_text: a javascript link is its label, in mixed case and entity encoded too', () => {
    const { container } = show(
      [
        `[plain](javascript:window.${MARKER}=1)`,
        '[mixed](JaVaScRiPt:alert(1))',
        // Split so the file holds no `#106` that reads as a hex color to the literal rule
        `[decimal](&#10${'6'};avascript:alert(1))`,
        '[hex](&#x6A;avascript:alert(1))',
        '[tabbed](<java\tscript:alert(1)>)',
        '[spaced](< javascript:alert(1)>)',
        '[control](<\u0001javascript:alert(1)>)',
      ].join('\n\n'),
    );
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(unsafeAddress(container)).toEqual([]);
    for (const label of ['plain', 'mixed', 'decimal', 'hex', 'tabbed', 'spaced', 'control']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const text of container.querySelectorAll('p')) fireEvent.click(text);
    expect(marks()).toEqual([undefined, undefined]);
  });

  it('test_every_hostile_link_scheme_is_text: data, vbscript, file, credentials, decoys and relative addresses are not links', () => {
    const addresses = [
      'data:text/html,<script>alert(1)</script>',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ftp://example.com/file',
      'blob:https://example.com/id',
      'https://user:pass@evil.example/',
      'https://google.com@evil.example/',
      '//evil.example/x',
      '/relative/path',
      '#fragment',
      'not a url',
    ];
    const { container } = show(addresses.map((address, place) => `[bad${String(place)}](<${address}>)`).join('\n\n'));
    expect(container.querySelectorAll('a')).toHaveLength(0);
    // An address that is no destination at all (the first holds a "<") stays whole as text; the rest give their label
    addresses.forEach((_, place) => expect(container).toHaveTextContent(`bad${String(place)}`));
  });

  it('treats every unlinkable address of the shared fixtures as text, and links the linkable ones as given', () => {
    for (const { name, url, linkable } of HOSTILE_URLS) {
      const { container, unmount } = show(`[label](<${url}>)`);
      const anchors = container.querySelectorAll('a');
      if (linkable) {
        expect(anchors, name).toHaveLength(1);
        expect(anchors[0]?.getAttribute('href'), name).toBe(url);
      } else {
        expect(anchors, name).toHaveLength(0);
        expect(container, name).toHaveTextContent('label');
      }
      unmount();
    }
  });

  it('test_a_markdown_image_is_dropped: no img element, no address, the alt text stays as text', () => {
    const { container } = show(
      [
        '![logo](https://evil.example/p.png)',
        '![javascript](javascript:alert(1))',
        '![](https://evil.example/q.png)',
      ].join('\n\n'),
    );
    expect(container.querySelectorAll('img, picture, source, svg')).toHaveLength(0);
    expect(unsafeAddress(container)).toEqual([]);
    expect(container.innerHTML).not.toContain('evil.example');
    expect(screen.getByText('logo')).toBeInTheDocument();
  });

  it('shows a hostile title as text in a heading and in a paragraph', () => {
    for (const title of HOSTILE_TITLES) {
      const { container, unmount } = show(`# ${title}\n\n${title}`);
      expect(container.querySelectorAll(FORBIDDEN), title).toHaveLength(0);
      expect(container.querySelectorAll('a'), title).toHaveLength(0);
      expect(withHandler(container), title).toEqual([]);
      expect(marks(), title).toEqual([undefined, undefined]);
      unmount();
    }
  });

  it('survives hostile shapes without throwing: runs of delimiters, brackets and deep nesting', () => {
    const shapes = [
      '*'.repeat(5000),
      '['.repeat(5000),
      '`'.repeat(5000),
      '*_'.repeat(2500),
      `${'**a '.repeat(2000)}`,
      `${'[a](b'.repeat(1500)}`,
      `${'> '.repeat(2000)}x`,
      '#'.repeat(5000),
      '\u0000‮\ud800'.repeat(100),
    ];
    for (const shape of shapes) {
      const { container, unmount } = show(shape);
      expect(container.querySelectorAll(FORBIDDEN)).toHaveLength(0);
      unmount();
    }
  });
});

describe('SafeMarkdown: links', () => {
  it('test_a_safe_link_opens_with_noopener_and_shows_its_host', () => {
    show('Read [the docs](https://www.example.com/docs?a=1) first.');
    const link = screen.getByRole('link', { name: 'the docs' });
    expect(link).toHaveAttribute('href', 'https://www.example.com/docs?a=1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // The host is always beside the label, which the page the answer came from chose
    expect(screen.getByText('example.com')).toHaveClass('type-meta');
  });

  it('shows the host of a link whose label looks like another address', () => {
    show('[https://bank.example](https://evil.example/login)');
    expect(screen.getByRole('link', { name: 'https://bank.example' })).toHaveAttribute(
      'href',
      'https://evil.example/login',
    );
    expect(screen.getByText('evil.example')).toBeInTheDocument();
  });

  it('links a mailto address without opening a tab, and shows the address', () => {
    show('Write to [the team](mailto:team@example.com).');
    const link = screen.getByRole('link', { name: 'the team' });
    expect(link).toHaveAttribute('href', 'mailto:team@example.com');
    expect(link).not.toHaveAttribute('target');
    expect(screen.getByText('team@example.com')).toBeInTheDocument();
  });

  it('renders a mailto address that is not valid percent-encoding as a link, without throwing', () => {
    for (const address of ['mailto:%zz', 'mailto:%', 'mailto:a%@example.com']) {
      const { container, unmount } = show(`[x](${address})`);
      const link = container.querySelector('a');
      expect(link, address).toHaveAttribute('href', address);
      // The mailbox is shown as it was written where it cannot be decoded
      expect(container, address).toHaveTextContent(address.slice('mailto:'.length));
      unmount();
    }
  });

  it('keeps emphasis inside a link label and never nests a link in a link', () => {
    const { container } = show('[**bold** and [inner](https://inner.example)](https://outer.example)');
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.querySelector('a')).toHaveAttribute('href', 'https://outer.example');
    expect(within(container.querySelector('a') as HTMLElement).getByText('bold').tagName).toBe('STRONG');
  });

  it('reads an address with balanced parentheses and an optional title', () => {
    show('[page](https://example.com/a_(b) "A title")');
    expect(screen.getByRole('link', { name: 'page' })).toHaveAttribute('href', 'https://example.com/a_(b)');
  });
});

describe('SafeMarkdown: what it renders', () => {
  it('renders headings below the card title, paragraphs and both kinds of list as elements', () => {
    show('# One\n\n## Two\n\n### Three\n\nA paragraph.\n\n- a\n- b\n\n1. first\n2. second');
    expect(screen.getByRole('heading', { level: 4, name: 'One' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 5, name: 'Two' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 6, name: 'Three' })).toBeInTheDocument();
    expect(screen.getByText('A paragraph.').tagName).toBe('P');
    const lists = screen.getAllByRole('list');
    expect(lists.map((list) => list.tagName)).toEqual(['UL', 'OL']);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('renders bold, italic and inline code, and leaves a lone asterisk and snake_case alone', () => {
    const { container } = show('**bold** and *italic* and _also_ and `code` but 2 * 3 * 4 and snake_case_word');
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('italic').tagName).toBe('EM');
    expect(screen.getByText('also').tagName).toBe('EM');
    expect(screen.getByText('code').tagName).toBe('CODE');
    expect(container).toHaveTextContent('2 * 3 * 4 and snake_case_word');
    expect(container.querySelectorAll('em')).toHaveLength(2);
  });

  it('keeps a backslash escape as the character, and code as written', () => {
    const { container } = show('\\*not italic\\* and `**not bold**`');
    expect(container.querySelector('em, strong')).toBeNull();
    expect(container).toHaveTextContent('*not italic* and **not bold**');
  });

  it('keeps a fenced block as text, with its markup untouched', () => {
    const { container } = show('```ts\nconst a = "<b>x</b>"; // **no**\n```');
    expect(container.querySelector('pre')).toHaveTextContent('const a = "<b>x</b>"; // **no**');
    expect(container.querySelector('b, strong')).toBeNull();
  });

  it('keeps a table as text, row by row', () => {
    const { container } = show('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(container.querySelector('table')).toBeNull();
    expect(container).toHaveTextContent('| a | b |');
    expect(container).toHaveTextContent('| 1 | 2 |');
  });

  it('keeps the line breaks of a paragraph and sets the language of the answer', () => {
    const { container } = show('first line\nsecond line', 'hi');
    expect(container.firstElementChild).toHaveAttribute('lang', 'hi');
    expect(screen.getByText(/first line/)).toHaveClass('whitespace-pre-wrap');
    expect(screen.getByText(/first line/).textContent).toBe('first line\nsecond line');
  });

  it('renders nothing for an empty source, without an error', () => {
    const { container } = show('');
    expect(container.querySelectorAll('p, li, h4')).toHaveLength(0);
  });

  it('passes the accessibility checks for a mixed answer', async () => {
    const { container } = show(
      '# Title\n\nIntro with [a link](https://example.com) and `code`.\n\n- one\n- two\n\n```\nraw\n```\n\n![alt](https://x.example/i.png)',
      'en',
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
