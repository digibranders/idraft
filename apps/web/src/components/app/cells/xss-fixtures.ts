/**
 * Hostile input for the identity parts (DomainCell, DomainChip, URLCell, CountPopover, ChangeFeed) and for the
 * gallery. Every string is data from the outside world: a page title, a URL or a host that an answer engine
 * or a crawler gave us. A part renders each one as text, and never as an href it did not check. Written with
 * `\u{...}` escapes, so this file stays ASCII.
 */

export interface HostileUrl {
  name: string;
  url: string;
  /** Whether `webHref` accepts it: only then may it be an href. */
  linkable: boolean;
}

export interface HostileHost {
  host: string;
  registrable: string;
}

/** Set on `window` by any payload that runs. A test reads it after render, hover and click. */
export const MARKER = '__wp08_xss';

/** Markup and templates that must stay text, and bidi and script samples that must stay readable. */
export const HOSTILE_TITLES: readonly string[] = [
  `<img src=x onerror="window.${MARKER}=1">`,
  `"><script>window.${MARKER}=1</script>`,
  `<a href="javascript:window.${MARKER}=1">click</a>`,
  `{{constructor.constructor('window.${MARKER}=1')()}}`,
  // A right-to-left override: "gnp.exe" would read as "exe.png"
  '\u{202E}gnp.exe',
  // Arabic, then Hebrew, each with a Latin word inside
  '\u{646}\u{635}\u{627}\u{626}\u{62D} \u{644}\u{627}\u{62E}\u{62A}\u{64A}\u{627}\u{631} \u{646}\u{638}\u{627}\u{645} CRM',
  '\u{5D0}\u{5D9}\u{5DA} \u{5DC}\u{5D1}\u{5D7}\u{5D5}\u{5E8} \u{5DE}\u{5E2}\u{5E8}\u{5DB}\u{5EA} CRM',
  'A'.repeat(400),
];

export const HOSTILE_URLS: readonly HostileUrl[] = [
  { name: 'javascript scheme', url: `javascript:window.${MARKER}=1`, linkable: false },
  { name: 'mixed-case javascript scheme', url: 'JaVaScRiPt:alert(1)', linkable: false },
  { name: 'control character before the scheme', url: '\u{1}javascript:alert(1)', linkable: false },
  { name: 'space before the scheme', url: ' javascript:alert(1)', linkable: false },
  { name: 'tab inside the scheme', url: 'java\tscript:alert(1)', linkable: false },
  { name: 'data scheme', url: 'data:text/html;base64,PHNjcmlwdD4=', linkable: false },
  { name: 'vbscript scheme', url: 'vbscript:msgbox(1)', linkable: false },
  { name: 'credentials', url: 'https://user:pass@evil.example/', linkable: false },
  // The part before the "@" reads as the site, and the link would go to evil.example
  { name: 'username-only decoy', url: 'https://google.com@evil.example/', linkable: false },
  { name: 'protocol-relative', url: '//evil.example/x', linkable: false },
  { name: 'relative path', url: '/relative/path', linkable: false },
  { name: 'not an address', url: 'not a url', linkable: false },
  {
    name: 'decoded right-to-left override in the path',
    url: 'https://example.com/files/%E2%80%AEgnp.exe',
    linkable: true,
  },
  // The Cyrillic look-alike arrives as punycode, which the display keeps
  { name: 'homograph host', url: 'https://xn--80ak6aa92e.com/', linkable: true },
  {
    name: 'very long path',
    url: 'https://example.com/a/very/long/path/segment/that/goes/on/and/on/how-to-choose-a-crm-for-startups',
    linkable: true,
  },
];

export const HOSTILE_HOSTS: readonly HostileHost[] = [
  {
    host: 'a-very-long-subdomain-label-that-goes-on.another-long-label.example-registrable.co.uk',
    registrable: 'example-registrable.co.uk',
  },
  // Refused by `normalizeDomain`, so no icon is requested for it
  { host: `evil.com"><img src=x onerror=alert(1)>`, registrable: 'evil.com' },
  // A right-to-left override inside the host: it must not reorder the text around it
  { host: 'docs.\u{202E}moc.live.com', registrable: 'live.com' },
  // Private: no icon is requested either
  { host: 'localhost', registrable: 'localhost' },
  // The registrable part is not the end of the host: bad data, nothing is hidden
  { host: 'docs.a.com', registrable: 'b.com' },
];
