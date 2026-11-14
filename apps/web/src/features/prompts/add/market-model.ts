import type { Route } from 'next';

import type { ProjectEngine } from '@/lib/api/types';
import type { Country } from '@/lib/locations/countries';
import { isSlugShaped, projectPath } from '@/lib/routes/paths';

/** Pure parts of the market fields of the Add prompts dialog: what each engine's reach is, and where its settings are. */

export interface EngineReach {
  label: string;
  /** The countries of the list that the engine has a location in. */
  count: number;
}

/** How many countries each engine asks in, for the hint under the country: "ChatGPT asks in 4 countries". */
export function engineCountryCounts(engines: readonly ProjectEngine[], countries: readonly Country[]): EngineReach[] {
  const isoOf = new Map(countries.map((country) => [country.location_id, country.country_iso]));
  return engines.map((engine) => ({
    label: engine.engine.label,
    count: new Set(engine.location_ids.flatMap((id) => isoOf.get(id) ?? [])).size,
  }));
}

/**
 * The project's engine settings, from the address of the page the dialog is on (`/workspace/project/...`); the
 * dialog is given no slugs. `null` where the address names no project, which leaves the sentence without a link.
 */
export function engineSettingsHref(pathname: string | null): Route | null {
  const [workspace, project] = (pathname ?? '').split('/').filter((part) => part !== '');
  if (workspace === undefined || project === undefined || !isSlugShaped(workspace) || !isSlugShaped(project)) {
    return null;
  }
  return projectPath(workspace, project, '/settings/engines');
}
