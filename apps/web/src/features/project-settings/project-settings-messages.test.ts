import { describe, expect, it } from 'vitest';

import { DEFAULT_DEPTHS, DEFAULT_DEVICES, DEFAULT_FREQUENCIES, SEO_DEFAULTS } from './keyword-defaults-values';
import {
  CADENCES,
  OFFERED_PROVIDER_MODES,
  PROVIDER_MODE_KEYS,
  PROVIDER_MODES,
  SCHEDULE_ERROR_KEYS,
  SCHEDULE_PRIORITIES,
  SELECTOR_MODES,
  WEEKDAYS,
} from './schedule-model';
import messages from '../../../messages/en.json';
import { DEPTH_KEYS } from '@/lib/keywords/depth-profiles';
import {
  seoSettingsDefault_depth_profileValues,
  seoSettingsDefault_deviceValues,
  seoSettingsDefault_frequencyValues,
} from '@/lib/api/schema';

const { keywordDefaults, schedules } = messages.projectSettings;

describe('the words of Project settings', () => {
  it('has a sentence for every error key of the schedule form, and for no other', () => {
    expect([...new Set(Object.values(SCHEDULE_ERROR_KEYS))].sort()).toEqual(Object.keys(schedules.errors).sort());
  });

  it('names every value the schedule form offers', () => {
    const dialog = schedules.dialog;
    expect(Object.keys(dialog.cadences).sort()).toEqual([...CADENCES].sort());
    expect(Object.keys(dialog.priorities).sort()).toEqual([...SCHEDULE_PRIORITIES].sort());
    const modeKeys = OFFERED_PROVIDER_MODES.map((mode) => PROVIDER_MODE_KEYS[mode]).sort();
    expect(Object.keys(dialog.providerModes).sort()).toEqual(modeKeys);
    expect(Object.keys(dialog.providerModeHints).sort()).toEqual(modeKeys);
    // The live mode is named only for a rank schedule that still holds it, as a disabled option
    expect(PROVIDER_MODES).toContain('live');
    expect(dialog.providerModeRetired).toBe('Live (no longer available)');
    expect(dialog.providerModeRetiredHint.length).toBeGreaterThan(0);
    expect(Object.keys(dialog.selectorModes).sort()).toEqual([...SELECTOR_MODES].sort());
    expect(Object.keys(dialog.selectorModeHints).sort()).toEqual([...SELECTOR_MODES].sort());
    expect(WEEKDAYS.every((day) => day in messages.common.weekdays)).toBe(true);
  });

  it('keeps the depth profiles to the API’s, one message each, and offers all but the one not built yet', () => {
    expect(Object.keys(DEPTH_KEYS).sort()).toEqual([...seoSettingsDefault_depth_profileValues].sort());
    expect(Object.values(DEPTH_KEYS).sort()).toEqual(Object.keys(messages.common.depths).sort());
    expect([...DEFAULT_DEPTHS].sort()).toEqual(
      seoSettingsDefault_depth_profileValues.filter((depth) => depth !== 'until_own_match_100').sort(),
    );
    for (const depth of DEFAULT_DEPTHS) expect(DEPTH_KEYS[depth] in keywordDefaults.depthHints).toBe(true);
  });

  it('keeps the devices and frequencies to the API’s, one message each', () => {
    expect([...DEFAULT_DEVICES].sort()).toEqual([...seoSettingsDefault_deviceValues].sort());
    expect(Object.keys(keywordDefaults.devices).sort()).toEqual([...DEFAULT_DEVICES].sort());
    expect([...DEFAULT_FREQUENCIES].sort()).toEqual([...seoSettingsDefault_frequencyValues].sort());
    expect(Object.keys(keywordDefaults.frequencies).sort()).toEqual([...DEFAULT_FREQUENCIES].sort());
  });

  it('starts from the defaults the contract declares', () => {
    expect(SEO_DEFAULTS).toMatchObject({
      default_device: 'desktop',
      default_depth_profile: 'standard',
      default_frequency: 'daily',
    });
  });
});
