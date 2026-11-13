'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type ReactElement, type ReactNode } from 'react';

import { engineCostChange, type EngineCostChange } from './engine-cost-model';
import { enginesQuery, PUT_ENGINE, refreshPrompts, type PromptScope } from './prompt-queries';
import { useMultiSelectHints } from '@/components/app/forms/use-multi-select-hints';
import { Banner } from '@/components/app/status/banner';
import { InlineError } from '@/components/app/status/inline-error';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
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

/** The class of the Perplexity API: an official API, never pooled with the other classes (spec 2026-11-11). */
const PERPLEXITY_CLASS = 'official_api';

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
  // The engine the last successful save switched on or off. It stays until the next save starts, and the
  // summary is read from the list as it is now, so it follows the refetch that comes after the save.
  const [switched, setSwitched] = useState<{ code: string; on: boolean } | null>(null);
  const change =
    switched === null || engines.data === undefined
      ? null
      : engineCostChange(engines.data.data, switched.code, switched.on);
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
      {change === null ? null : <CostChangeSummary change={change} />}
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
                onSaveStart={() => setSwitched(null)}
                onSwitched={(code, on) => setSwitched({ code, on })}
              />
            </li>
          ))}
          <li className="px-4 pb-4">
            <PerplexityRow />
          </li>
        </ul>
      )}
    </section>
  );
}

/** What the last switch did to the monthly estimate. A condition of the page, so a banner, read out as it appears. */
function CostChangeSummary({ change }: { change: EngineCostChange }): ReactElement {
  const t = useTranslations('aiEngines');
  if (change.delta === null) return <Banner tone="info" placement="region" live message={t('costChangeNoPrice')} />;
  const amount = formatCurrency(Math.abs(change.delta));
  const direction = change.delta < 0 ? 'down' : 'up';
  return (
    <Banner
      tone="info"
      placement="region"
      live
      message={
        change.enabledTotal === null
          ? t('costChangeNoTotal', { amount, direction })
          : t('costChange', {
              amount,
              direction,
              count: change.enabledCount,
              total: formatCurrency(change.enabledTotal),
            })
      }
    />
  );
}

/** The class of an engine (doc 04 section 8.1). A class a newer API sends shows as its code, never as nothing. */
function EngineClass({ code }: { code: string }): ReactElement {
  const t = useTranslations('aiEngines');
  const labels = new Map([
    ['consumer_ui', t('classes.consumerUi')],
    ['serp_ai', t('classes.serpAi')],
    ['official_api', t('classes.officialApi')],
  ]);
  return (
    <span className="inline-flex items-center">
      <span className="sr-only">{t('classPrefix')} </span>
      <Badge>{labels.get(code) ?? code}</Badge>
    </span>
  );
}

/** The Perplexity API is planned, not built: a row that cannot be switched, never queried, saved or counted. */
function PerplexityRow(): ReactElement {
  const t = useTranslations('aiEngines');
  return (
    <SettingRow
      label={t('perplexityName')}
      description={t('perplexityState')}
      disabled
      control={
        <div className="flex items-center gap-3">
          <EngineClass code={PERPLEXITY_CLASS} />
          <Switch checked={false} disabled />
        </div>
      }
    />
  );
}

interface EngineRowProps {
  scope: PromptScope;
  engine: ProjectEngine;
  countries: readonly Country[];
  canWrite: boolean;
  defaultCountryIso: string | null;
  /** A save starts: the cost summary of the one before is no longer the last word. */
  onSaveStart: () => void;
  /** A save turned the engine on or off (not one that only changed its countries). */
  onSwitched: (code: string, on: boolean) => void;
}

function EngineRow({
  scope,
  engine,
  countries,
  canWrite,
  defaultCountryIso,
  onSaveStart,
  onSwitched,
}: EngineRowProps): ReactElement {
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
    onSaveStart();
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
    // Only a switch changes the cost: the price of an engine does not depend on its countries
    if (isEnabled !== engine.is_enabled) onSwitched(code, isEnabled);
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
          <div className="flex items-center gap-3">
            <EngineClass code={engine.engine.observation_class} />
            <Switch checked={engine.is_enabled} busy={put.isPending} disabled={!canWrite} onCheckedChange={turn} />
          </div>
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
