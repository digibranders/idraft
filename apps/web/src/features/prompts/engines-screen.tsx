'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type ReactElement, type ReactNode } from 'react';

import { enginesQuery, PUT_ENGINE, refreshPrompts, type PromptScope } from './prompt-queries';
import { useMultiSelectHints } from '@/components/app/forms/use-multi-select-hints';
import { Banner } from '@/components/app/status/banner';
import { InlineError } from '@/components/app/status/inline-error';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { MultiSelect } from '@/components/ui/multi-select';
import { SettingRow } from '@/components/ui/setting-row';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { TextLink } from '@/components/ui/text-link';
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import { projectKey } from '@/lib/api/keys';
import { isApiProblem } from '@/lib/api/problem';
import { useErrorId } from '@/lib/api/use-error-id';
import type { ProjectEngine } from '@/lib/api/types';
import { formatCurrency } from '@/lib/format';
import { money } from '@/lib/format/money';
import { useCountries, type Country } from '@/lib/locations/countries';
import { useCan } from '@/lib/permissions';
import { projectPath } from '@/lib/routes/paths';

export interface EnginesScreenProps {
  workspaceId: string;
  projectId: string;
  workspaceSlug: string;
  projectSlug: string;
  /** The country of the project's default location, which an engine never set up starts with. */
  defaultCountryIso: string | null;
}

const SKELETON_ROWS = [0, 1, 2] as const;

/** The API refused a country: `422 validation_failed` with an error on `location_ids` (engine service `put`). */
const refusedCountry = (failure: unknown): boolean =>
  isApiProblem(failure, 'validation_failed') && failure.errors.some((item) => item.path.startsWith('location_ids'));

/**
 * Settings > Project settings > Engines (spec 2026-11-11 section 4.6): ChatGPT, Gemini and Google AI Mode,
 * each off until a member with `projects:write` turns it on. Turning one on asks first and names its monthly
 * cost, since it starts scheduled spend; turning one off saves at once and keeps its countries. The countries
 * of an engine that is on save as they change; those of one that is off wait for it to be turned on.
 */
export function EnginesScreen({
  workspaceId,
  projectId,
  workspaceSlug,
  projectSlug,
  defaultCountryIso,
}: EnginesScreenProps): ReactNode {
  const t = useTranslations('aiEngines');
  const common = useTranslations('common');
  const scope: PromptScope = { workspaceId, projectId };
  const canWrite = useCan('projects:write');
  const engines = useQuery(enginesQuery(scope));
  const countries = useCountries();
  const errorId = useErrorId(engines.error);
  return (
    <section aria-labelledby="engines-title" className="flex flex-col gap-5">
      <div>
        <h2 id="engines-title" className="type-section-title">
          {t('title')}
        </h2>
        <p className="mt-1 type-meta">
          {t.rich('description', {
            link: (chunks) => (
              <TextLink
                variant="inline"
                render={<Link href={projectPath(workspaceSlug, projectSlug, '/settings/schedules')} />}
              >
                {chunks}
              </TextLink>
            ),
          })}
        </p>
      </div>
      <Banner tone="info" placement="region" message={t('spendNote')} />
      {canWrite ? null : <Banner tone="info" placement="region" lead={t('readOnlyLead')} message={t('readOnly')} />}
      {countries.isError ? (
        <Banner
          tone="warning"
          placement="region"
          message={t('countriesFailed')}
          actions={
            <Button variant="secondary" size="sm" onClick={countries.retry}>
              {common('retry')}
            </Button>
          }
        />
      ) : null}
      {engines.isError ? (
        <InlineError
          title={t('loadFailed')}
          reason={t('loadFailedReason')}
          errorId={errorId}
          onRetry={() => void engines.refetch()}
          retrying={engines.isFetching}
          retryLabel={common('retry')}
        />
      ) : engines.data === undefined ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          {SKELETON_ROWS.map((row) => (
            <Skeleton key={row} shape="block" height="row" />
          ))}
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border bg-surface">
          {engines.data.data.map((engine) => (
            <li key={engine.engine.engine_code} className="px-4 pb-4">
              <EngineRow
                scope={scope}
                engine={engine}
                countries={countries.countries}
                canWrite={canWrite}
                defaultCountryIso={defaultCountryIso}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface EngineRowProps {
  scope: PromptScope;
  engine: ProjectEngine;
  countries: readonly Country[];
  canWrite: boolean;
  defaultCountryIso: string | null;
}

function EngineRow({ scope, engine, countries, canWrite, defaultCountryIso }: EngineRowProps): ReactElement {
  const t = useTranslations('aiEngines');
  const common = useTranslations('common');
  const hints = useMultiSelectHints();
  const queryClient = useQueryClient();
  const put = useMutation(PUT_ENGINE);
  const code = engine.engine.engine_code;
  const label = engine.engine.label;
  // The countries chosen here and not yet saved; `null` shows what the engine holds
  const [draft, setDraft] = useState<readonly Country[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The field is only said to be missing a country once it was changed, or turning the engine on was tried
  const [touched, setTouched] = useState(false);
  const byId = new Map(countries.map((country) => [country.location_id, country]));
  const saved = engine.location_ids.flatMap((id) => byId.get(id) ?? []);
  const projectCountry = countries.filter((country) => country.country_iso === defaultCountryIso).slice(0, 1);
  const chosen = draft ?? (engine.is_configured ? saved : projectCountry);
  // What a save sends: the engine's own countries until the person changes them, even while the list loads
  const ids =
    draft === null && engine.is_configured ? engine.location_ids : chosen.map((country) => country.location_id);
  const cost = engine.estimated_monthly_cost_usd === null ? null : money(engine.estimated_monthly_cost_usd);
  const prompts = engine.active_prompts;
  const missingCountry = touched && chosen.length === 0;

  const fail = (message: string): void => {
    setError(message);
    announce(message, { politeness: 'assertive' });
  };
  const save = async (isEnabled: boolean, locationIds: readonly number[]): Promise<void> => {
    setError(null);
    try {
      await put.mutateAsync({
        params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId, engine_code: code } },
        body: { location_ids: [...locationIds], is_enabled: isEnabled },
      });
    } catch (failure) {
      if (refusedCountry(failure)) fail(t('countriesRefused'));
      else if (isApiProblem(failure, 'forbidden')) fail(t('forbidden'));
      else fail(t('saveFailed'));
      throw failure;
    }
    setDraft(null);
    setTouched(false);
    // The first engine on makes the project's AI schedules. The key is the Schedules screen's (project-settings
    // keeps it, and features do not import each other), so it is spelled out here as the runs key is elsewhere
    void queryClient.invalidateQueries({ queryKey: [...projectKey(scope.workspaceId, scope.projectId), 'schedules'] });
    await refreshPrompts(queryClient, scope);
  };

  const turn = (on: boolean): void => {
    if (on) {
      setError(null);
      setAsking(true);
      return;
    }
    // Off keeps what the engine holds: the API needs a country even here, and a field the person emptied or a
    // change the API refused must not stop the engine from being turned off
    save(false, engine.location_ids).then(
      () => toast({ type: 'success', title: t('turnedOff', { engine: label }) }),
      // The row says why; the switch stays where it was
      () => undefined,
    );
  };
  const changeCountries = (next: readonly Country[]): void => {
    setDraft(next);
    setTouched(true);
    // An engine that is on saves its countries at once, like its switch; with none chosen nothing is sent
    if (engine.is_enabled && next.length > 0) {
      save(
        true,
        next.map((country) => country.location_id),
      ).catch(() => undefined);
    }
  };
  const turnOn = async (): Promise<void> => {
    if (ids.length === 0) {
      setTouched(true);
      fail(t('countriesRequired'));
      throw new Error('An engine needs a country before it is turned on');
    }
    await save(true, ids);
    toast({ type: 'success', title: t('turnedOn', { engine: label }), description: t('turnedOnHint') });
  };

  return (
    <div className="flex flex-col gap-3">
      <SettingRow
        label={label}
        description={cost === null ? t('noPrice') : t('estimate', { cost: formatCurrency(cost), prompts })}
        error={error}
        control={
          <Switch checked={engine.is_enabled} busy={put.isPending} disabled={!canWrite} onCheckedChange={turn} />
        }
      />
      <Field invalid={missingCountry} disabled={!canWrite}>
        <FieldLabel>{t('countriesLabel', { engine: label })}</FieldLabel>
        <MultiSelect<Country>
          value={chosen}
          onValueChange={changeCountries}
          items={countries}
          itemToString={(country) => country.name}
          itemKey={(country) => String(country.location_id)}
          placeholder={t('countriesPlaceholder')}
          emptyText={(query) => t('countriesEmpty', { query })}
          chipsLabel={t('chips', { engine: label })}
          removeLabel={(value) => t('remove', { value })}
          disabled={!canWrite}
          {...hints}
        />
        {missingCountry ? (
          <FieldError message={t('countriesRequired')} />
        ) : (
          <FieldDescription>{t('countriesHint')}</FieldDescription>
        )}
      </Field>
      <ConfirmDialog
        open={asking}
        onOpenChange={(open) => {
          setAsking(open);
          // A refusal belongs to the question: it does not stay on the row once the question is closed
          if (!open) setError(null);
        }}
        tone="neutral"
        title={t('confirmTitle', { engine: label })}
        description={
          cost === null
            ? t('confirmNoPrice', { engine: label })
            : t('confirmDescription', { engine: label, cost: formatCurrency(cost), prompts })
        }
        confirmLabel={t('confirm', { engine: label })}
        cancelLabel={common('cancel')}
        error={error}
        onConfirm={turnOn}
      />
    </div>
  );
}
