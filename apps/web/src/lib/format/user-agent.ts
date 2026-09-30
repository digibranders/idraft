/**
 * The browser and system of a session, from its user agent, for the session list of Settings > Security,
 * which words them from the catalog ("Chrome on macOS"). The names are product names, the same in every
 * language. Only the common ones are named; anything else is `null`, and the list says it does not know.
 * Order matters: Edge and Opera also say "Chrome", Chrome also says "Safari".
 */
const BROWSERS: readonly [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const SYSTEMS: readonly [RegExp, string][] = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

const nameOf = (userAgent: string, table: readonly [RegExp, string][]): string | null =>
  table.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;

export interface UserAgentNames {
  browser: string | null;
  system: string | null;
}

/** The browser and system named in `userAgent`, or `null` when neither is known. */
export function parseUserAgent(userAgent: string | null): UserAgentNames | null {
  if (userAgent === null || userAgent.trim() === '') return null;
  const browser = nameOf(userAgent, BROWSERS);
  const system = nameOf(userAgent, SYSTEMS);
  return browser === null && system === null ? null : { browser, system };
}
