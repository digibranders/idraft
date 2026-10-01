/**
 * Time zone names as the API takes them (backend `api/timezones.py`): `UTC`, or an IANA `Area/Location`
 * name. Browsers still report some zones by the name they had before a rename (`Asia/Calcutta` for India);
 * the API stores the current name, so the app sends and lists the current one too.
 */
const TIMEZONE_PATTERN = /^(UTC|[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2})$/;
const TIMEZONE_MAX = 64;

/** The renamed zones, as the API replaces them (its `_RENAMED`). */
const RENAMED: Readonly<Record<string, string>> = {
  'Africa/Asmera': 'Africa/Asmara',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Godthab': 'America/Nuuk',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Louisville': 'America/Kentucky/Louisville',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
};

/** The name the API stores for `zone`: the current one of a renamed zone, `zone` itself otherwise. */
export const currentTimeZoneName = (zone: string): string => RENAMED[zone] ?? zone;

/** Whether the runtime has a zone by this name; old and new names both count. */
function runtimeKnows(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

let names: readonly string[] | null = null;

/** Every zone the runtime knows, by its current name, sorted, with `UTC` first. */
export function timeZoneNames(): readonly string[] {
  names ??= [
    'UTC',
    ...[...new Set(Intl.supportedValuesOf('timeZone').map(currentTimeZoneName))]
      .filter((zone) => zone !== 'UTC' && TIMEZONE_PATTERN.test(zone) && runtimeKnows(zone))
      .sort(),
  ];
  return names;
}

/** Whether the API would take `zone`: the right shape, and a zone that exists. */
export const isKnownTimeZone = (zone: string): boolean =>
  zone.length <= TIMEZONE_MAX && TIMEZONE_PATTERN.test(zone) && runtimeKnows(zone);

/** The browser's zone by the name the API stores, or `UTC` when the browser reports none the API takes. */
export function browserTimeZoneName(): string {
  const own = currentTimeZoneName(Intl.DateTimeFormat().resolvedOptions().timeZone);
  return isKnownTimeZone(own) ? own : 'UTC';
}
