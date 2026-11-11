'use client';

import { ExternalLink, MoreHorizontal } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState, Fragment, type ReactElement, type ReactNode } from 'react';

import { detailStateOf, statusBadges, type StatusBadge } from './detail-state';
import type { CheckNowResult } from '../check-now/use-check-now';
import { DepthDialog } from '../keyword-inspector/depth-dialog';
import type { KeywordDetail, KeywordScope } from '../keyword-inspector/inspector-queries';
import { useKeywordArchive } from '../keyword-inspector/use-keyword-archive';
import { DetailPageHeader } from '@/components/app/shell/detail-page-header';
import { Badge } from '@/components/ui/badge';
import { IconButton } from '@/components/ui/icon-button';
import { LinkButton } from '@/components/ui/link-button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import { copyText } from '@/lib/dom/clipboard';
import { formatList, formatRelative, webHref } from '@/lib/format';
import { languageName } from '@/lib/format/language';
import { formatInspectTarget } from '@/lib/inspector/placement';
import { useDepthLabel } from '@/lib/keywords/use-depth-label';
import { useCan } from '@/lib/permissions';
import { keywordDetailPath, rankingsPath, withQuery } from '@/lib/routes/paths';

export interface KeywordDetailHeaderProps {
  scope: KeywordScope;
  detail: KeywordDetail;
  workspaceSlug: string;
  projectSlug: string;
  timeZone: string;
  /** The list as the person left it. */
  backHref: Route;
  checkNow: CheckNowResult;
}

const BADGE_TONE: Readonly<Record<Exclude<StatusBadge, 'archived'>, 'neutral' | 'warning'>> = {
  pending: 'neutral',
  failed: 'warning',
  stale: 'warning',
  failing: 'warning',
};

/**
 * The header of the keyword page (24-page-templates.md section 9.4): back link, the keyword as `h1`, where
 * and on what it is tracked and how fresh it is, its target, groups and tags, the state badges, and the
 * actions: Check now, Open ranking page and More. An archived keyword has Copy link and Restore only.
 */
export function KeywordDetailHeader({
  scope,
  detail,
  workspaceSlug,
  projectSlug,
  timeZone,
  backHref,
  checkNow,
}: KeywordDetailHeaderProps): ReactElement {
  const t = useTranslations('keywordDetail');
  const common = useTranslations('common');
  const inspector = useTranslations('rankings.inspector');
  const separator = useTranslations('inspector')('separator');
  const devices = useTranslations('rankings.filters.devices');
  const engines = useTranslations('rankings.inspector.engines');
  const depthLabel = useDepthLabel();
  const locale = useLocale();
  const router = useRouter();
  const canWrite = useCan('keywords:write');
  const setActive = useKeywordArchive(scope);
  const [depthOpen, setDepthOpen] = useState(false);
  // Where focus goes back to when the depth dialog closes: the More button its item was in
  const moreButton = useRef<HTMLButtonElement>(null);

  const state = detailStateOf(detail.state, detail.is_active);
  const archived = state.kind === 'archived';
  const archivedProps = archived
    ? { archived: true as const, archivedLabel: t('header.badges.archived') }
    : { archived: false as const };
  const lastChecked = detail.state.last_observed_at;
  const facts = (
    <>
      {t('header.facts', {
        location: detail.location.name,
        device: devices(detail.device),
        engine: engines(detail.search_engine),
        language: languageName(detail.language_code, locale),
        depth: inspector('depth', { depth: depthLabel(detail.depth_profile) }),
      })}
      {lastChecked === null ? null : (
        <>
          <span aria-hidden="true"> {separator} </span>
          {t('header.updated', { time: formatRelative(lastChecked, timeZone) })}
        </>
      )}
    </>
  );

  const groups = detail.groups.map((group) => group.path);
  const terms = detail.terms.map((term) => term.name);
  const secondary = [
    detail.target_url === null ? t('header.noTarget') : t('header.target', { path: detail.target_url.path }),
    ...(groups.length === 0 ? [] : [t('header.groups', { names: formatList(groups, locale) })]),
    ...(terms.length === 0 ? [] : [t('header.terms', { names: formatList(terms, locale) })]),
  ];

  const badges = statusBadges(state).flatMap((code) =>
    code === 'archived'
      ? []
      : [
          <Badge key={code} tone={BADGE_TONE[code]}>
            {t(`header.badges.${code}`)}
          </Badge>,
        ],
  );

  const rankingUrl = detail.state.current.url === null ? null : webHref(detail.state.current.url.canonical_url);

  const copyLink = (): void => {
    const link = new URL(
      keywordDetailPath(workspaceSlug, projectSlug, detail.tracked_keyword_id),
      window.location.origin,
    ).href;
    void copyText(link).then((copied) => {
      if (copied) announce(t('header.linkCopied'));
      else toast({ type: 'error', title: common('copy.failed') });
    });
  };
  const copyKeyword = (): void => {
    void copyText(detail.keyword.text).then((copied) => {
      if (copied) announce(inspector('more.keywordCopied'));
      else toast({ type: 'error', title: common('copy.failed') });
    });
  };
  // Editing stays in the inspector of the list: the page has no second editor
  const editSettings = (): void => {
    const query = new URLSearchParams({
      inspect: formatInspectTarget({ type: 'keyword', id: detail.tracked_keyword_id }),
    });
    router.push(withQuery(rankingsPath(workspaceSlug, projectSlug), query.toString()));
  };

  const items: MenuItemDef[] = [
    { id: 'copy-link', label: t('header.copyLink'), onSelect: copyLink },
    ...(archived ? [] : [{ id: 'copy-keyword', label: inspector('more.copyKeyword'), onSelect: copyKeyword }]),
    ...(canWrite && !archived
      ? [
          { id: 'edit', label: t('header.editSettings'), onSelect: editSettings },
          { id: 'depth', label: t('header.changeDepth'), onSelect: () => setDepthOpen(true) },
        ]
      : []),
    ...(canWrite
      ? [
          archived
            ? { id: 'restore', label: t('header.restore'), onSelect: () => void setActive(true, detail, false) }
            : { id: 'archive', label: t('header.archive'), onSelect: () => void setActive(false, detail, true) },
        ]
      : []),
  ];

  const actions: ReactNode = (
    <>
      {rankingUrl === null ? null : (
        <LinkButton
          render={<Link href={new URL(rankingUrl)} target="_blank" rel="noopener noreferrer nofollow" />}
          icon={ExternalLink}
          aria-label={t('header.openRankingPageNewTab')}
        >
          {t('header.openRankingPage')}
        </LinkButton>
      )}
      <Menu
        align="end"
        trigger={
          <IconButton ref={moreButton} icon={MoreHorizontal} variant="secondary" size="icon" label={t('header.more')} />
        }
        items={items}
      />
      {checkNow.inspectorAction(detail.tracked_keyword_id, detail.is_active, 'page')}
    </>
  );

  return (
    <>
      <DetailPageHeader
        back={{ label: t('back'), href: backHref }}
        objectName={detail.keyword.text}
        lang={detail.language_code}
        facts={facts}
        secondary={secondary.map((part, index) => (
          <Fragment key={part}>
            {index === 0 ? null : <span aria-hidden="true"> {separator} </span>}
            {part}
          </Fragment>
        ))}
        badges={badges}
        {...archivedProps}
        actions={actions}
      />
      <DepthDialog
        key={`${detail.tracked_keyword_id}:${String(detail.config_version)}`}
        scope={scope}
        detail={detail}
        open={depthOpen}
        onOpenChange={setDepthOpen}
        finalFocus={moreButton}
      />
    </>
  );
}
