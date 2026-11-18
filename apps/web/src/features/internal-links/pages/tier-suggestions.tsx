'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Button } from '@/components/ui/button';
import { Popover } from '@/components/ui/popover';
import { toast } from '@/components/ui/toast';
import { Truncate } from '@/components/ui/truncate';
import { formatInteger } from '@/lib/format';
import { acceptSuggestionsMutation, dismissSuggestionsMutation } from '@/lib/internal-links/mutations';
import { checkUrlId, internalLinksKeys, tierSuggestionsQuery } from '@/lib/internal-links/queries';
import { gscNote, reasonText } from '@/lib/internal-links/suggestions-format';
import type { LinksScope, SuggestionSelection, TierSuggestionRow } from '@/lib/internal-links/types';
import { useCan } from '@/lib/permissions';

/**
 * The "Suggested tiers" chip and its popover (decision D11, mock `openSuggestions`): pages that earn clicks or rank
 * well and sit in a lower tier, each with the reasons in words, and Accept or Dismiss per row or Accept all. Nothing
 * changes until a person accepts. A member who may not change the project sees the rows without the buttons. The
 * chip is not drawn while there is nothing to suggest; `onEmptied` says where focus goes when the last row leaves.
 */
export function TierSuggestions({
  scope,
  onEmptied,
}: {
  scope: LinksScope;
  onEmptied: () => void;
}): ReactElement | null {
  const t = useTranslations('internalLinks.suggestions');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const canWrite = useCan('projects:write');
  const read = useQuery(tierSuggestionsQuery(scope));
  const accept = useMutation(acceptSuggestionsMutation);
  const dismiss = useMutation(dismissSuggestionsMutation);
  const [open, setOpen] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  const rows: readonly TierSuggestionRow[] = read.data?.data ?? [];
  const count = rows.length;
  const busy = accept.isPending || dismiss.isPending;
  const path = { workspace_id: scope.workspaceId, project_id: scope.projectId };

  // After a row leaves, focus goes to the next action; with none left the chip goes too, so the caller decides
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const next = body.current?.querySelector<HTMLElement>('button');
    if (next !== null && next !== undefined) next.focus();
    else if (count === 0) onEmptied();
  }, [count, onEmptied]);

  const send = async (selection: SuggestionSelection, kind: 'accept' | 'dismiss'): Promise<void> => {
    if (busy) return;
    try {
      const answer = await (kind === 'accept' ? accept : dismiss).mutateAsync({
        params: { path },
        body: selection,
      });
      const changed = answer.data.changed;
      toast({ type: 'success', title: t(kind === 'accept' ? 'moved' : 'dismissed', { count: changed }) });
      refocus.current = true;
      for (const queryKey of internalLinksKeys(scope)) void queryClient.invalidateQueries({ queryKey });
    } catch {
      toast({ type: 'error', title: t('failed'), description: t('failedReason') });
    }
  };
  const one = (row: TierSuggestionRow, kind: 'accept' | 'dismiss'): Promise<void> =>
    send({ url_ids: [checkUrlId(row.url_id)] }, kind);

  if (count === 0) return null;
  const note = read.data === undefined ? 'clicks_used' : gscNote(read.data.meta.gsc_state);
  const reasonWords = {
    clicks: (clicks: string): string => t('clicks', { count: clicks }),
    rank: (rank: string, keyword: string, volume: string): string => t('rank', { rank, keyword, volume }),
  };
  const whyOf = (row: TierSuggestionRow): string => {
    const reasons = row.reasons.map((reason) => reasonText(reason, reasonWords)).filter((text) => text !== null);
    return reasons.length === 0 ? t('reasonFallback') : reasons.join('; ');
  };
  const columns: PlainColumn<TierSuggestionRow>[] = [
    {
      id: 'page',
      header: t('page'),
      cell: (row) => <Truncate text={row.path} className="max-w-48 type-table text-foreground" />,
    },
    { id: 'from', header: t('from'), cell: (row) => <TierBadge tier={row.from_tier} /> },
    { id: 'to', header: t('to'), cell: (row) => <TierBadge tier={row.to_tier} /> },
    { id: 'why', header: t('why'), wrap: true, cell: (row) => <span className="type-table">{whyOf(row)}</span> },
    ...(canWrite
      ? [
          {
            id: 'actions',
            header: t('actions'),
            hideHeader: true,
            actions: true,
            cell: (row: TierSuggestionRow) => (
              <span className="flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  aria-label={t('acceptRow', { path: row.path })}
                  onClick={() => void one(row, 'accept')}
                >
                  {t('accept')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={t('dismissRow', { path: row.path })}
                  onClick={() => void one(row, 'dismiss')}
                >
                  {t('dismiss')}
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      title={t('title')}
      width="max"
      trigger={
        <Button variant="secondary" size="sm" icon={Sparkles}>
          {t('chip')} <span className="num type-body-strong">{formatInteger(count)}</span>
        </Button>
      }
      footer={
        canWrite ? (
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void send({ all: true }, 'accept')}>
            {t('acceptAll')}
          </Button>
        ) : undefined
      }
    >
      <div ref={body} className="flex flex-col gap-3">
        <p className="type-body text-foreground-secondary">{t('intro')}</p>
        {note === 'clicks_used' ? null : (
          <p className="type-meta text-foreground-secondary">
            {t(note === 'ranks_only_pending' ? 'gscPending' : 'gscOff')}
          </p>
        )}
        <PlainTable<TierSuggestionRow>
          caption={t('title')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.url_id}
          status="ready"
          errorState={
            <InlineError
              title={t('failed')}
              reason={t('failedReason')}
              errorId={null}
              onRetry={() => void read.refetch()}
              retrying={read.isFetching}
              retryLabel={common('retry')}
            />
          }
          emptyText={t('none')}
        />
      </div>
    </Popover>
  );
}
