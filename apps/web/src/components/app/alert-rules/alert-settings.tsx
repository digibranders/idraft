'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ReadOnlyField, ReadOnlyList } from '@/components/ui/read-only-field';
import { Select, type SelectOption } from '@/components/ui/select';
import { SettingRow } from '@/components/ui/setting-row';
import { Switch } from '@/components/ui/switch';
import { alertTierText } from '@/lib/internal-links/changes-format';
import { MAX_TIERS } from '@/lib/internal-links/tiers';
import type { AlertSettings, AlertSettingsPatch } from '@/lib/internal-links/types';

const THRESHOLD_MIN = 1;
const THRESHOLD_MAX = 50;
const WHOLE_NUMBER = /^\d+$/;
const CHANNELS = ['app', 'email', 'slack'] as const satisfies readonly AlertSettings['channel'][];
/** Delivery by email and Slack is refused by the API until the alerts service ships (WP-47). */
const SELECTABLE: ReadonlySet<AlertSettings['channel']> = new Set(['app']);

/** What the person has typed: the threshold stays text until it is checked. */
export interface AlertDraft {
  enabled: boolean;
  max_position: number;
  threshold: string;
  channel: AlertSettings['channel'];
}

/** What the API holds for a project that never set the rules (`crawl/changes.py` `alert_settings`). */
export const ALERT_DEFAULTS: AlertSettings = { enabled: true, max_position: 2, threshold: 1, channel: 'app' };

export const draftOf = (saved: AlertSettings): AlertDraft => ({
  enabled: saved.enabled,
  max_position: saved.max_position,
  threshold: String(saved.threshold),
  channel: saved.channel,
});

/** `'range'` unless the text is a whole number from 1 to 50 (the API's bounds). */
export function checkThreshold(text: string): 'range' | null {
  const trimmed = text.trim();
  if (!WHOLE_NUMBER.test(trimmed)) return 'range';
  const value = Number(trimmed);
  return value >= THRESHOLD_MIN && value <= THRESHOLD_MAX ? null : 'range';
}

/** Only the members that differ from what is saved; a threshold that is not valid yet is not a change. */
export function alertPatch(saved: AlertSettings, draft: AlertDraft): AlertSettingsPatch {
  const threshold = checkThreshold(draft.threshold) === null ? Number(draft.threshold.trim()) : saved.threshold;
  return {
    ...(draft.enabled !== saved.enabled ? { enabled: draft.enabled } : {}),
    ...(draft.max_position !== saved.max_position ? { max_position: draft.max_position } : {}),
    ...(threshold !== saved.threshold ? { threshold } : {}),
    ...(draft.channel !== saved.channel ? { channel: draft.channel } : {}),
  };
}

/** The tier positions the select offers: 1 up to the workspace's tiers (8 at most), and always the saved one. */
export function tierChoices(tierCount: number | null, saved: number): number[] {
  const last = Math.min(MAX_TIERS, Math.max(tierCount ?? 0, saved, 1));
  return Array.from({ length: last }, (_, index) => index + 1);
}

export interface AlertFieldsProps {
  draft: AlertDraft;
  saved: AlertSettings;
  /** How many tiers the workspace has; `null` until they are read. */
  tierCount: number | null;
  canEdit: boolean;
  busy: boolean;
  thresholdError: 'range' | null;
  onChange: (next: Partial<AlertDraft>) => void;
}

/**
 * The alert rules as a form body (spec 7.10 "Alert rules"): the switch, the important tiers, the threshold and the
 * channel. The host owns the draft and the save, so the project settings screen can hold it in its save bar and the
 * Changes tab dialog can save it alone. A member who may not change the project reads the values as text.
 */
export function AlertFields({
  draft,
  saved,
  tierCount,
  canEdit,
  busy,
  thresholdError,
  onChange,
}: AlertFieldsProps): ReactElement {
  const t = useTranslations('internalLinks.alerts');
  const words = useTranslations('internalLinks.context');
  const tierWords = {
    tierPair: (first: string, second: string) => words('tierPair', { first, second }),
    tierRange: (first: string, last: string) => words('tierRange', { first, last }),
  };
  const tierLabel = (position: number): string => (position === 1 ? t('onlyT1') : alertTierText(position, tierWords));
  const channelLabel = (channel: AlertSettings['channel']): string => t(channel);
  const tierOptions: SelectOption<string>[] = tierChoices(tierCount, saved.max_position).map((position) => ({
    value: String(position),
    label: tierLabel(position),
  }));
  const channelOptions: SelectOption<AlertSettings['channel']>[] = CHANNELS.map((value) => ({
    value,
    label: channelLabel(value),
    // The reason is shown, and the option cannot be chosen, until the alerts service ships
    ...(SELECTABLE.has(value) ? {} : { description: t('unavailable'), disabled: true }),
  }));

  if (!canEdit) {
    return (
      <ReadOnlyList>
        <ReadOnlyField label={t('enabled')} value={draft.enabled ? t('on') : t('off')} />
        <ReadOnlyField label={t('important')} value={tierLabel(draft.max_position)} />
        <ReadOnlyField label={t('threshold')} value={draft.threshold} />
        <ReadOnlyField label={t('channel')} value={channelLabel(draft.channel)} />
      </ReadOnlyList>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingRow
        label={t('enabled')}
        description={t('enabledHint')}
        control={
          <Switch
            checked={draft.enabled}
            disabled={busy}
            onCheckedChange={(enabled: boolean) => onChange({ enabled })}
          />
        }
      />
      <Field width="medium">
        <FieldLabel>{t('important')}</FieldLabel>
        <Select<string>
          value={String(draft.max_position)}
          disabled={busy}
          onValueChange={(next) => onChange({ max_position: Number(next) })}
          placeholder={t('important')}
          options={tierOptions}
        />
      </Field>
      <Field width="short" invalid={thresholdError !== null}>
        <FieldLabel>{t('threshold')}</FieldLabel>
        <Input
          value={draft.threshold}
          disabled={busy}
          inputMode="numeric"
          autoComplete="off"
          onValueChange={(threshold) => onChange({ threshold })}
        />
        <FieldDescription>{t('thresholdHint')}</FieldDescription>
        {thresholdError === null ? null : <FieldError message={t('thresholdError')} />}
      </Field>
      <Field width="medium">
        <FieldLabel>{t('channel')}</FieldLabel>
        <Select<AlertSettings['channel']>
          value={draft.channel}
          disabled={busy}
          onValueChange={(channel) => onChange({ channel })}
          placeholder={t('channel')}
          options={channelOptions}
        />
      </Field>
    </div>
  );
}
