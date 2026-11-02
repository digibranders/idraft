import { ChevronLeft } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Children, type ReactElement, type ReactNode } from 'react';

import { PageHeader } from './page-header';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { TextLink } from '@/components/ui/text-link';

export interface DetailPageHeaderProps {
  /** The way back to the list the person came from. */
  back: { label: string; href: Route };
  /** The object's name, the page's only `h1`: the keyword text, a prompt, a URL path. */
  objectName: string;
  /** The language of the name, when it is not the interface's (a keyword in German). */
  lang?: string | undefined;
  /** The first meta line: where, on what, how deep, and how fresh. */
  facts: ReactNode;
  /** A second meta line, such as the target URL and the groups. */
  secondary?: ReactNode;
  /** State badges after the meta lines: Stale, Check failed. */
  badges?: ReactNode;
  /** At most two secondary actions, then the one primary action; left out when the person can do none. */
  actions?: ReactNode;
  /** `Tabs variant="underline"`, under the title row. */
  tabs?: ReactNode;
  /** The id the skip link and route focus use. */
  headingId?: string | undefined;
}

/** An archived object shows the neutral `archivedLabel` badge before the others. */
type ArchivedProps =
  { archived?: false | undefined; archivedLabel?: string | undefined } | { archived: true; archivedLabel: string };

/**
 * `PageHeader` for the full page of one object (16-drawers-dialogs-popovers.md section 3, 24 section 5):
 * the back link on a line of its own above the title, the name as `h1`, the object's facts in the meta
 * lines, the actions right-aligned and the tabs below. It reads no data and knows no feature.
 */
export function DetailPageHeader({
  back,
  objectName,
  lang,
  facts,
  secondary,
  badges,
  archived,
  archivedLabel,
  actions,
  tabs,
  headingId,
}: DetailPageHeaderProps & ArchivedProps): ReactElement {
  const hasBadges = archived === true || Children.toArray(badges).length > 0;
  return (
    <div data-slot="detail-page-header" className="flex flex-col gap-1">
      <TextLink
        render={<Link href={back.href} />}
        className="inline-flex min-h-6 items-center gap-0.5 self-start type-meta"
      >
        <Icon icon={ChevronLeft} size="sm" />
        {back.label}
      </TextLink>
      <PageHeader
        title={objectName}
        lang={lang}
        headingId={headingId}
        meta={
          <>
            <span className="block">{facts}</span>
            {secondary === undefined || secondary === null ? null : <span className="block">{secondary}</span>}
            {hasBadges ? (
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {archived === true && archivedLabel !== undefined ? <Badge>{archivedLabel}</Badge> : null}
                {badges}
              </span>
            ) : null}
          </>
        }
        actions={actions === undefined || actions === null ? undefined : actions}
        tabs={tabs}
      />
    </div>
  );
}
