'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type ReactElement } from 'react';

import { reasonOf } from '@/lib/internal-links/problem-reason';
import {
  ALERT_DEFAULTS,
  AlertFields,
  alertPatch,
  checkThreshold,
  draftOf,
  type AlertDraft,
} from '@/components/app/link-alert-rules/alert-settings';
import { InlineError } from '@/components/app/status/inline-error';
import { Banner } from '@/components/app/status/banner';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { DiscardChangesDialog } from '@/components/ui/alert-dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { LinkButton } from '@/components/ui/link-button';
import { SaveBar } from '@/components/ui/save-bar';
import { Select } from '@/components/ui/select';
import { SettingRow } from '@/components/ui/setting-row';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { EMPTY_VALUE, formatCurrency, formatInteger, formatTableDateTime } from '@/lib/format';
import { failedText } from '@/lib/internal-links/crawl-failure';
import { updateSettingsMutation } from '@/lib/internal-links/mutations';
import { CRAWL_LIMIT, crawlsQuery, linkSettingsQuery, pageTiersQuery } from '@/lib/internal-links/queries';
import type { CrawlRun, CrawlSchedule, InternalLinksSettingsPatch } from '@/lib/internal-links/types';
import { useLeaveGuard } from '@/lib/navigation/use-leave-guard';
import { useCan } from '@/lib/permissions';
import { projectPath } from '@/lib/routes/paths';

const SCHEDULES = ['weekly', 'every_two_weeks', 'monthly', 'off'] as const satisfies readonly CrawlSchedule[];
const SCHEDULE_KEY: Readonly<Record<CrawlSchedule, 'weekly' | 'everyTwoWeeks' | 'monthly' | 'off'>> = {
  weekly: 'weekly',
  every_two_weeks: 'everyTwoWeeks',
  monthly: 'monthly',
  off: 'off',
};
const TRIGGER_KEY: Readonly<Record<CrawlRun['trigger'], 'websiteAdded' | 'schedule' | 'manual' | 'ceilingRetry'>> = {
  website_added: 'websiteAdded',
  schedule: 'schedule',
  manual: 'manual',
  ceiling_retry: 'ceilingRetry',
};
const STATE_KEY: Readonly<
  Record<
    CrawlRun['state'],
    'queued' | 'crawling' | 'processing' | 'ready' | 'stoppedAtCeiling' | 'failed' | 'cancelled'
  >
> = {
  queued: 'queued',
  crawling: 'crawling',
  processing: 'processing',
  ready: 'ready',
  stopped_at_ceiling: 'stoppedAtCeiling',
  failed: 'failed',
  cancelled: 'cancelled',
};
const MAX_SUBDOMAINS = 10;
const ACTIVE: ReadonlySet<CrawlRun['state']> = new Set(['queued', 'crawling', 'processing']);

/** What the person has changed and not saved; a member left out is as saved. */
interface Edits {
  schedule?: CrawlSchedule;
  render_javascript?: boolean;
  subdomains?: string;
  alerts?: Partial<AlertDraft>;
}

const hostsOf = (text: string): string[] =>
  text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
const sameHosts = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((host, index) => host === right[index]);

export interface InternalLinksSettingsScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  projectId: string;
  projectSlug: string;
  /** The project's website, for the subdomain hint; empty when none is set. */
  host: string;
  timeZone: string;
}

/**
 * Project settings > Internal links (spec 7.8): the crawl schedule, Render JavaScript with its cost, the allowed
 * subdomains and the recent crawls. Changes are held and saved together through the save bar
 * (`PATCH {P}/settings` with `internal_links`, only what changed); leaving with changes asks first. A member who
 * may not change the project reads the values.
 */
export function InternalLinksSettingsScreen({
  workspaceId,
  workspaceSlug,
  projectId,
  projectSlug,
  host,
  timeZone,
}: InternalLinksSettingsScreenProps): ReactElement {
  const t = useTranslations('internalLinksSettings');
  const states = useTranslations('internalLinks.states');
  const alerts = useTranslations('internalLinks.alerts');
  const common = useTranslations('common');
  const canWrite = useCan('projects:write');
  const scope = { workspaceId, projectId };
  const queryClient = useQueryClient();
  const formId = useId();
  const settings = useQuery(linkSettingsQuery(scope));
  const crawls = useQuery(crawlsQuery(scope));
  const tiers = useQuery(pageTiersQuery(workspaceId));
  const update = useMutation(updateSettingsMutation);
  const saved = settings.data?.data.internal_links;
  const [edits, setEdits] = useState<Edits>({});
  const [subdomainError, setSubdomainError] = useState<string | null>(null);
  const [thresholdError, setThresholdError] = useState<'range' | null>(null);
  const thresholdRef = useRef<HTMLInputElement>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const savedHosts = saved?.allowed_subdomains ?? [];
  const schedule = edits.schedule ?? saved?.schedule ?? 'weekly';
  const renderJavascript = edits.render_javascript ?? saved?.render_javascript ?? false;
  const subdomainText = edits.subdomains ?? savedHosts.join(', ');

  const savedAlerts = saved?.alerts ?? ALERT_DEFAULTS;
  const alertDraft: AlertDraft = { ...draftOf(savedAlerts), ...edits.alerts };
  const alertChanges = alertPatch(savedAlerts, alertDraft);
  // A threshold typed and not valid yet is a change the person has to fix before saving
  const thresholdInvalid = checkThreshold(alertDraft.threshold) !== null;

  // Only what differs from the saved settings is a change, and only that is sent
  const patch: InternalLinksSettingsPatch = {
    ...(Object.keys(alertChanges).length > 0 ? { alerts: alertChanges } : {}),
    ...(saved !== undefined && schedule !== saved.schedule ? { schedule } : {}),
    ...(saved !== undefined && renderJavascript !== saved.render_javascript
      ? { render_javascript: renderJavascript }
      : {}),
    ...(edits.subdomains !== undefined && !sameHosts(hostsOf(edits.subdomains), savedHosts)
      ? { allowed_subdomains: hostsOf(edits.subdomains) }
      : {}),
  };
  // Each changed alert member counts, as each of the other settings does, and so does a threshold left invalid
  const changes =
    Object.keys(patch).length -
    (patch.alerts === undefined ? 0 : 1) +
    Object.keys(alertChanges).length +
    (thresholdInvalid ? 1 : 0);
  const guard = useLeaveGuard(changes > 0);
  const discard = (): void => {
    setEdits({});
    setSubdomainError(null);
    setThresholdError(null);
    setFailure(null);
  };
  const edit = (next: Edits): void => {
    setEdits((current) => ({ ...current, ...next }));
    setFailure(null);
  };

  const save = (): void => {
    if (changes === 0) return;
    if (patch.allowed_subdomains !== undefined && patch.allowed_subdomains.length > MAX_SUBDOMAINS) {
      setSubdomainError(t('subdomainsTooMany'));
      return;
    }
    if (thresholdInvalid) {
      setThresholdError('range');
      thresholdRef.current?.focus();
      return;
    }
    if (Object.keys(patch).length === 0) return;
    setSubdomainError(null);
    setFailure(null);
    update.mutate(
      { params: { path: { workspace_id: workspaceId, project_id: projectId } }, body: { internal_links: patch } },
      {
        onSuccess: (answer) => {
          // The keyword defaults section reads the same document: one write feeds both
          queryClient.setQueryData(linkSettingsQuery(scope).queryKey, answer);
          void queryClient.invalidateQueries({ queryKey: linkSettingsQuery(scope).queryKey });
          setEdits({});
          toast({ type: 'success', title: t('saved') });
        },
        onError: (error) => {
          if (isApiProblem(error, 'validation_failed')) {
            const field = error.errors.find((item) => item.path.endsWith('allowed_subdomains'));
            if (field !== undefined) {
              // The host rule is the server's: it names the hosts it refused. Other codes get the catalog sentence.
              setSubdomainError(field.code === 'not_a_site_host' ? field.message : t('subdomainsInvalid'));
              return;
            }
            // The alert rules are the server's too: its reason names what it refused
            if (error.errors.some((item) => item.path.includes('alerts'))) {
              setFailure(reasonOf(error) || t('saveFailed'));
              return;
            }
          }
          setFailure(t('saveFailed'));
        },
      },
    );
  };

  const crawlColumns: PlainColumn<CrawlRun>[] = [
    { id: 'when', header: t('when'), cell: (run) => formatTableDateTime(run.created_at, timeZone) },
    {
      id: 'trigger',
      header: t('startedBy'),
      cell: (run) => run.requested_by?.name ?? t(`trigger.${TRIGGER_KEY[run.trigger]}`),
    },
    {
      id: 'state',
      header: t('state'),
      wrap: true,
      cell: (run) => (
        <span className="flex flex-col">
          <span>{t(`states.${STATE_KEY[run.state]}`)}</span>
          {run.state === 'failed' ? (
            <span className="type-meta text-foreground-secondary">{failedText(states, run, host)}</span>
          ) : null}
        </span>
      ),
    },
    { id: 'pages', header: t('crawlPages'), cell: (run) => formatInteger(run.pages) },
    {
      id: 'cost',
      header: t('cost'),
      cell: (run) => {
        if (run.cost_usd !== null) return formatCurrency(Number(run.cost_usd));
        // A crawl still under way has the estimate of what it will cost
        if (ACTIVE.has(run.state) && run.estimated_cost_usd !== null) {
          return t('costEstimate', { amount: formatCurrency(Number(run.estimated_cost_usd)) });
        }
        return EMPTY_VALUE;
      },
    },
  ];

  const heading = (
    <div className="flex flex-col gap-1">
      <h2 id="internal-links-settings-title" className="type-section-title">
        {t('title')}
      </h2>
      <p className="type-body text-foreground-secondary">{t('description')}</p>
    </div>
  );

  return (
    <section aria-labelledby="internal-links-settings-title" className="flex flex-col gap-5">
      {heading}
      {settings.isError ? (
        <InlineError
          title={t('loadFailed')}
          reason={t('loadFailedReason')}
          errorId={null}
          onRetry={() => void settings.refetch()}
          retrying={settings.isFetching}
          retryLabel={common('retry')}
        />
      ) : saved === undefined ? (
        <Skeleton shape="text-14" widthPct={48} />
      ) : (
        <form
          id={formId}
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          {canWrite ? null : <Banner tone="info" placement="region" message={t('readOnly')} />}
          {failure === null ? null : <FormAlert message={failure} />}
          <Field width="medium">
            <FieldLabel>{t('schedule')}</FieldLabel>
            <Select<CrawlSchedule>
              value={schedule}
              disabled={!canWrite || update.isPending}
              onValueChange={(next) => edit({ schedule: next })}
              placeholder={t('schedule')}
              options={SCHEDULES.map((value) => ({ value, label: t(SCHEDULE_KEY[value]) }))}
            />
            <FieldDescription>{t('scheduleHint')}</FieldDescription>
          </Field>
          <div className="flex flex-col gap-2">
            <SettingRow
              label={t('renderJavascript')}
              description={t('renderJavascriptHint')}
              control={
                <Switch
                  checked={renderJavascript}
                  disabled={!canWrite || update.isPending}
                  onCheckedChange={(next: boolean) => edit({ render_javascript: next })}
                />
              }
            />
            {renderJavascript ? (
              <Banner tone="warning" placement="region" message={t('renderJavascriptWarning')} />
            ) : null}
          </div>
          <Field width="long" invalid={subdomainError !== null}>
            <FieldLabel>{t('subdomains')}</FieldLabel>
            <Input
              value={subdomainText}
              disabled={!canWrite || update.isPending || host === ''}
              onValueChange={(next) => {
                setSubdomainError(null);
                edit({ subdomains: next });
              }}
            />
            <FieldDescription>{host === '' ? t('subdomainsNoSite') : t('subdomainsHint', { host })}</FieldDescription>
            {subdomainError === null ? null : <FieldError message={subdomainError} />}
          </Field>
          <div className="flex flex-col gap-3">
            <h3 className="type-subsection-title">{alerts('section')}</h3>
            <AlertFields
              draft={alertDraft}
              saved={savedAlerts}
              tierCount={tiers.data?.data.length ?? null}
              canEdit={canWrite}
              busy={update.isPending}
              thresholdError={thresholdError}
              thresholdRef={thresholdRef}
              onChange={(next) => {
                if (next.threshold !== undefined) setThresholdError(null);
                edit({ alerts: { ...edits.alerts, ...next } });
              }}
            />
          </div>
          <SaveBar
            visible={canWrite && changes > 0}
            summary={t('unsavedCount', { count: changes })}
            saving={update.isPending}
            onDiscard={discard}
            discardLabel={t('discardChanges')}
            saveLabel={t('save')}
            form={formId}
          />
        </form>
      )}
      <h3 className="type-subsection-title">{t('recent')}</h3>
      <PlainTable<CrawlRun>
        caption={t('recentCaption', { count: CRAWL_LIMIT })}
        rows={crawls.data?.data ?? []}
        rowKey={(run) => run.run_id}
        status={crawls.isError ? 'error' : crawls.isPending ? 'loading' : 'ready'}
        errorState={
          <InlineError
            title={t('crawlsLoadFailed')}
            reason={t('loadFailedReason')}
            errorId={null}
            onRetry={() => void crawls.refetch()}
            retrying={crawls.isFetching}
            retryLabel={common('retry')}
          />
        }
        emptyText={t('noCrawls')}
        columns={crawlColumns}
      />
      <LinkButton
        variant="secondary"
        size="sm"
        className="self-start"
        render={<Link href={projectPath(workspaceSlug, projectSlug, '/seo/internal-links')} />}
      >
        {t('open')}
      </LinkButton>
      <DiscardChangesDialog
        open={guard.pending !== null}
        title={t('discardTitle')}
        description={t('discardText')}
        keepEditingLabel={t('keepEditing')}
        discardLabel={t('discard')}
        onKeepEditing={guard.stay}
        onDiscard={() => {
          discard();
          guard.leave();
        }}
      />
    </section>
  );
}
