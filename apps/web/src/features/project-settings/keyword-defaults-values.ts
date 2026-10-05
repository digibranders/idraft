import type { components } from '@/lib/api/schema';

type SeoSettings = components['schemas']['SeoSettings'];

/** The values of the project's keyword defaults (`seo` in the settings document), as the API names them. */
export type DefaultDevice = SeoSettings['default_device'];
export type DefaultDepth = SeoSettings['default_depth_profile'];
export type DefaultFrequency = SeoSettings['default_frequency'];

export const DEFAULT_DEVICES = ['desktop', 'mobile', 'both'] as const satisfies readonly DefaultDevice[];

/**
 * The depth profiles a default can be set to. `until_own_match_100` is left out: a later step of the backend
 * answers it `422 depth_profile_not_available`, so it is not offered until that step is built.
 */
export const DEFAULT_DEPTHS = [
  'light',
  'standard',
  'deep',
  'full',
  'weekly',
  'weekly_light',
] as const satisfies readonly DefaultDepth[];

export const DEFAULT_FREQUENCIES = ['daily', 'weekly'] as const satisfies readonly DefaultFrequency[];

/** The catalog key of a depth profile under `projectSettings.keywordDefaults.depths`: keys are camel case. */
export const DEPTH_KEYS = {
  light: 'light',
  standard: 'standard',
  deep: 'deep',
  full: 'full',
  weekly: 'weekly',
  weekly_light: 'weeklyLight',
  until_own_match_100: 'untilOwnMatch100',
} as const satisfies Record<DefaultDepth, string>;

/** The defaults a project has while its settings name none, as the contract declares them. */
export const SEO_DEFAULTS: SeoSettings = {
  default_device: 'desktop',
  default_depth_profile: 'standard',
  default_frequency: 'daily',
  visibility_volume_mode: 'annual_average',
  visibility_weight_scheme: 'uniform',
};

/** The three defaults the section edits. */
export interface DefaultsValues {
  default_device: DefaultDevice;
  default_depth_profile: DefaultDepth;
  default_frequency: DefaultFrequency;
}

export const valuesOfSeo = (seo: SeoSettings | undefined): DefaultsValues => ({
  default_device: seo?.default_device ?? SEO_DEFAULTS.default_device,
  default_depth_profile: seo?.default_depth_profile ?? SEO_DEFAULTS.default_depth_profile,
  default_frequency: seo?.default_frequency ?? SEO_DEFAULTS.default_frequency,
});
