/**
 * Opening a group from the heat map also sets the platform when a platform cell was clicked (OV-GRP-08). The platform
 * before the click is kept, so the Back button of the group's card (OV-GRP-11) returns to where the person was. It is
 * remembered for the session of the page, not written to the address: a link to a group has no "before".
 */

/** A platform code, or `null` for All platforms. */
export type DrillPlatform = string | null;

interface Drill {
  group: string;
  from: DrillPlatform;
  to: DrillPlatform;
}

let last: Drill | null = null;

/** Remembers a click that opened `group` and moved the platform from `from` to `to`. */
export function rememberDrill(group: string, from: DrillPlatform, to: DrillPlatform): void {
  last = { group, from, to };
}

/**
 * The platform Back puts on: where the person was before the click when the group and the platform are still those
 * the click set, otherwise the platform that is chosen now. Forgets the click either way.
 */
export function platformForBack(group: string, current: DrillPlatform): DrillPlatform {
  const drill = last;
  last = null;
  return drill !== null && drill.group === group && drill.to === current ? drill.from : current;
}

/** Forgets any click: for tests, which share the module. */
export function forgetDrill(): void {
  last = null;
}
