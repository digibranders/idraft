'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { projectDomainsQuery, type ProjectRole, type ProjectScope } from './entity-queries';
import { SCOPE_KEY } from './labels';
import { InlineError } from '@/components/app/status/inline-error';
import { Skeleton } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import type { components } from '@/lib/api/schema';
import { projectPath } from '@/lib/routes/paths';

type ProjectDomain = components['schemas']['ProjectDomain'];
const ROLE_ORDER: readonly ProjectRole[] = ['own', 'competitor', 'watch'];
const SKELETON_ROWS = 3;
/** The id of a role's heading, which names its table. */
const headingIdOf = (role: ProjectRole): string => `domains-${role}`;

/** How a rule reads: the host, with the path for a path rule. */
const ruleText = (rule: ProjectDomain): string =>
  rule.match_scope === 'registrable'
    ? rule.domain.registrable_domain
    : rule.path_prefix === null
      ? rule.domain.host
      : `${rule.domain.host}${rule.path_prefix}`;

export interface DomainsScreenProps extends ProjectScope {
  workspaceSlug: string;
  projectSlug: string;
}

/**
 * Settings > Project settings > Domains: every domain of the project's entities by role, as rankings and
 * cited sources are attributed. Read-only: domains are changed in each entity's editor.
 */
export function DomainsScreen({ workspaceId, projectId, workspaceSlug, projectSlug }: DomainsScreenProps): ReactNode {
  const t = useTranslations('domainSettings');
  const scopes = useTranslations('entitySettings.domains.scopes');
  const roles = useTranslations('entitySettings.roles');
  const common = useTranslations('common');
  const domains = useQuery(projectDomainsQuery({ workspaceId, projectId }));
  const rows = domains.data?.data ?? [];
  return (
    <section aria-labelledby="domains-title" className="flex flex-col gap-5">
      <div>
        <h2 id="domains-title" className="type-section-title">
          {t('title')}
        </h2>
        <p className="mt-1 type-meta">
          {t.rich('description', {
            link: (chunks) => (
              <TextLink
                variant="inline"
                render={<Link href={projectPath(workspaceSlug, projectSlug, '/settings/entities')} />}
              >
                {chunks}
              </TextLink>
            ),
          })}
        </p>
      </div>
      {domains.isError ? (
        <InlineError
          title={t('loadFailed')}
          reason={t('loadFailedReason')}
          errorId={null}
          onRetry={() => void domains.refetch()}
          retrying={domains.isFetching}
          retryLabel={common('retry')}
        />
      ) : (
        ROLE_ORDER.map((role) => {
          const titleId = headingIdOf(role);
          const ofRole = rows.filter((row) => row.entity.role === role);
          return (
            <div key={role} className="flex flex-col gap-2">
              <h3 id={titleId} className="type-subsection-title">
                {roles(role)}
              </h3>
              {!domains.isPending && ofRole.length === 0 ? (
                <p className="type-meta">{t(`empty.${role}`)}</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border bg-surface">
                  <table className="w-full type-table" aria-labelledby={titleId}>
                    <thead className="bg-surface-subtle">
                      <tr>
                        <th scope="col" className="h-row-header px-4 text-left type-table-header">
                          {t('columns.domain')}
                        </th>
                        <th scope="col" className="h-row-header px-3 text-left type-table-header">
                          {t('columns.counts')}
                        </th>
                        <th scope="col" className="h-row-header px-4 text-left type-table-header">
                          {t('columns.entity')}
                        </th>
                      </tr>
                    </thead>
                    <tbody aria-busy={domains.isPending}>
                      {domains.isPending
                        ? Array.from({ length: SKELETON_ROWS }, (_, index) => (
                            <tr key={index} className="h-row-compact border-t border-border-subtle">
                              <td colSpan={3} className="px-4">
                                <Skeleton shape="text-12" widthPct={56} />
                              </td>
                            </tr>
                          ))
                        : ofRole.map((row) => (
                            <tr
                              key={`${row.entity.entity_id}-${ruleText(row)}-${row.match_scope}`}
                              className="h-row-compact border-t border-border-subtle"
                            >
                              <th scope="row" className="px-4 py-2 text-left font-normal">
                                {ruleText(row)}
                              </th>
                              <td className="px-3 whitespace-nowrap text-foreground-secondary">
                                {scopes(SCOPE_KEY[row.match_scope])}
                              </td>
                              <td className="px-4">
                                <TextLink
                                  render={
                                    <Link
                                      href={projectPath(
                                        workspaceSlug,
                                        projectSlug,
                                        `/settings/entities/${row.entity.entity_id}`,
                                      )}
                                    />
                                  }
                                >
                                  {row.entity.canonical_name}
                                </TextLink>
                              </td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
