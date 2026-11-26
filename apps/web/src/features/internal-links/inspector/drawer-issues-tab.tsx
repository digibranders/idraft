'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { AlertTriangle, Flag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { FlagsList, IssueText, SEVERITY_TONE } from './drawer-overview-tab';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { InlineError } from '@/components/app/status/inline-error';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/link-button';
import type { LinkScope } from '@/lib/internal-links/scopes';
import type { PageDetail } from '@/lib/internal-links/types';
import { sortIssues } from '@/lib/pages/drawer-tiles';
import type { PageIssue, Seam } from '@/lib/pages/issue-source';

export interface DrawerIssuesTabProps {
  issues: Seam<readonly PageIssue[]>;
  /** Null while the page read is pending: the flags then draw their skeleton. */
  detail: PageDetail | null;
  linkScope: LinkScope;
  /** The route of the Issues page for a check, or null while that page is not on the branch (spec 10.1). */
  issueHref: (checkId: string) => Route | null;
}

/**
 * The Issues tab of the page drawer (spec 9.4): every issue of the page from the Issues seam, or, while the seam is
 * unavailable, a line saying so above the page's flags, so the tab is never empty and never invents an issue.
 */
export function DrawerIssuesTab({ issues, detail, linkScope, issueHref }: DrawerIssuesTabProps): ReactElement {
  const t = useTranslations('pages.drawer.issues');
  const common = useTranslations('common');
  const inspector = useTranslations('internalLinks.inspector');
  if (issues.state === 'unavailable') {
    return (
      <>
        <p className="type-body text-foreground-secondary">{t('pending')}</p>
        <InspectorSection title={t('flags')} icon={Flag} status={detail === null ? 'loading' : 'ready'}>
          {detail === null ? null : <FlagsList page={detail.page} linkScope={linkScope} />}
        </InspectorSection>
      </>
    );
  }
  if (issues.state === 'loading') return <InspectorSection title={t('title')} icon={AlertTriangle} status="loading" />;
  if (issues.state === 'error') {
    return (
      <InspectorSection
        title={t('title')}
        icon={AlertTriangle}
        status="error"
        error={
          <InlineError
            title={t('loadFailed')}
            reason={inspector('loadFailedReason')}
            errorId={null}
            onRetry={issues.retry}
            retrying={false}
            retryLabel={common('retry')}
          />
        }
      />
    );
  }
  const found = sortIssues(issues.data);
  return (
    <InspectorSection title={t('title')} icon={AlertTriangle} status="ready">
      {found.length === 0 ? (
        <p className="type-body text-foreground-tertiary">{t('none')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {found.map((issue) => {
            const href = issueHref(issue.checkId);
            return (
              <li key={issue.checkId} className="flex flex-col items-start gap-1">
                <Badge tone={SEVERITY_TONE[issue.severity]}>{t(`severity.${issue.severity}`)}</Badge>
                <IssueText issue={issue} />
                {href === null ? null : (
                  <LinkButton variant="link" size="sm" render={<Link href={href} />}>
                    {t('seeAll')}
                  </LinkButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </InspectorSection>
  );
}
