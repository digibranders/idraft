import { describe, expect, it } from 'vitest';

import { engineCountryCounts, engineSettingsHref } from './market-model';
import type { Country } from '@/lib/locations/countries';
import type { ProjectEngine } from '@/lib/api/types';

const country = (id: number, iso: string): Country => ({ location_id: id, country_iso: iso }) as Country;
const engine = (code: string, label: string, locationIds: number[]): ProjectEngine =>
  ({ engine: { engine_code: code, label }, location_ids: locationIds }) as ProjectEngine;

const COUNTRIES = [country(1, 'DE'), country(2, 'IN'), country(3, 'US')];

describe('the countries each engine asks in', () => {
  it('counts the listed countries among an engine’s locations, in the engines’ order', () => {
    const counts = engineCountryCounts(
      [engine('chatgpt_web', 'ChatGPT', [1, 2, 3]), engine('google_ai_mode', 'AI Mode', [1, 99])],
      COUNTRIES,
    );
    expect(counts).toEqual([
      { label: 'ChatGPT', count: 3 },
      { label: 'AI Mode', count: 1 },
    ]);
  });

  it('is empty without an engine', () => {
    expect(engineCountryCounts([], COUNTRIES)).toEqual([]);
  });
});

describe('the engine settings link', () => {
  it('is the project’s engine settings, read from the page the dialog is on', () => {
    expect(engineSettingsHref('/digibranders/fynix/ai/prompts')).toBe('/digibranders/fynix/settings/engines');
  });

  it('is absent where the address names no project', () => {
    expect(engineSettingsHref(null)).toBeNull();
    expect(engineSettingsHref('/')).toBeNull();
    expect(engineSettingsHref('/digibranders')).toBeNull();
    expect(engineSettingsHref('/Digi Branders/fynix')).toBeNull();
  });
});
