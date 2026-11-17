'use client';

import { Folders, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import type { CompetitorRead } from './data/use-competitor-read';
import { DrawerCard, type DrawerCardState } from './drawer-card';
import { LEAD_KINDS, promptList, type GroupCount, type PromptRow, type PromptView } from './model/prompt-lists';
import { promptHref } from './prompt-href';
import { colorSlots } from '../cards/competitors/model/tracked-set';
import type { Lead } from '../cards/competitors/model/lead-rule';
import type { TrackedEntity } from '../cards/competitors/model/types';
import { useOverview } from '../overview-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Tooltip } from '@/components/ui/tooltip';
import { formatInteger, formatPercent } from '@/lib/format';
import { MIN_OBSERVATIONS } from '@/lib/stats';
import { cn } from '@/lib/utils';

const TITLE_KEY = {
  they: { groups: 'groupsTitleThey', list: 'listTitleThey' },
  you: { groups: 'groupsTitleYou', list: 'listTitleYou' },
  close: { groups: 'groupsTitleEqual', list: 'listTitleEqual' },
} as const satisfies Record<Lead, { groups: string; list: string }>;

const KIND_LABEL = { they: 'they', you: 'you', close: 'equal' } as const satisfies Record<Lead, string>;

const fill = (slot: number | null): string => (slot === null ? 'var(--chart-other)' : `var(--chart-${String(slot)})`);

/** Two thin bars of the same scale, yours above theirs (OV-DRW-23). */
function RateBars({ row, name, rivalSlot }: { row: PromptRow; name: string; rivalSlot: number | null }): ReactElement {
  const t = useTranslations('aiOverview.competitorDrawer.prompts');
  const rate = (count: number): number => (row.answers === 0 ? 0 : count / row.answers);
  return (
    <span
      role="img"
      aria-label={t('rowBars', {
        own: formatPercent(rate(row.own), { decimals: 0 }),
        name,
        rival: formatPercent(rate(row.rival), { decimals: 0 }),
      })}
      className="flex w-24 shrink-0 flex-col gap-1 pt-1.5"
    >
      {(
        [
          [row.own, 1],
          [row.rival, rivalSlot],
        ] as const
      ).map(([count, slot], index) => (
        <span key={index} className="block h-1.5 overflow-hidden rounded-full bg-neutral-subtle">
          <span
            className="block h-full rounded-full"
            style={{ width: `${String(Math.max(2, rate(count) * 100))}%`, background: fill(slot) }}
          />
        </span>
      ))}
    </span>
  );
}

function PromptLink({
  row,
  name,
  rivalSlot,
}: {
  row: PromptRow;
  name: string;
  rivalSlot: number | null;
}): ReactElement {
  const t = useTranslations('aiOverview.competitorDrawer.prompts');
  const { scope, workspaceSlug, project } = useOverview();
  const href = promptHref(scope, { workspace: workspaceSlug, project: project.slug }, row.promptId);
  return (
    <li className="border-t border-border-subtle first:border-t-0">
      <Link
        href={href}
        className="flex w-full items-start gap-3 px-4 py-3 text-left outline-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:focus-ring-inset"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="line-clamp-2 type-body text-foreground">{row.text}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 num type-meta">
            {row.groupName === null ? null : <Badge>{row.groupName}</Badge>}
            {t('rowCounts', { own: row.own, answers: row.answers, name, rival: row.rival })}
          </span>
        </span>
        <RateBars row={row} name={name} rivalSlot={rivalSlot} />
      </Link>
    </li>
  );
}

function GroupStrip({
  groups,
  selected,
  onSelect,
  fillColor,
}: {
  groups: readonly GroupCount[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  fillColor: string;
}): ReactElement {
  const top = groups[0]?.count ?? 1;
  return (
    <ul className="flex flex-col">
      {groups.map((group) => {
        const on = selected === group.key;
        return (
          <li key={group.key}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(on ? null : group.key)}
              className={cn(
                'flex h-9 w-full items-center gap-3 px-4 text-left outline-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:focus-ring-inset',
                on && 'bg-primary-subtle',
              )}
            >
              <span
                className={cn(
                  'w-32 shrink-0 truncate type-body',
                  on ? 'type-body-strong text-primary-text' : 'text-foreground',
                )}
              >
                {group.name}
              </span>
              <span aria-hidden="true" className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-subtle">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${String((group.count / top) * 100)}%`, background: fillColor }}
                />
              </span>
              <span className="w-8 shrink-0 text-right num type-table">{formatInteger(group.count)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export interface PromptsTabProps {
  read: CompetitorRead;
  competitor: TrackedEntity;
  view: PromptView;
  onViewChange: (view: PromptView) => void;
}

/** The Prompts tab (OV-DRW-20 to OV-DRW-24): where they lead, where you lead, and where it is equal. */
export function PromptsTab({ read, competitor, view: requested, onViewChange }: PromptsTabProps): ReactElement {
  const t = useTranslations('aiOverview.competitorDrawer');
  const lead =
    read.leads !== null && read.leads.status === 'read'
      ? read.leads.competitors.find((entry) => entry.entity.entityId === competitor.entityId)
      : undefined;
  const list = useMemo(
    () => (lead === undefined ? null : promptList(lead, requested, read.groupsByPrompt, read.allGroups)),
    [lead, requested, read.groupsByPrompt, read.allGroups],
  );
  const slots = read.set === null ? null : colorSlots(read.set);
  const rivalSlot = slots?.get(competitor.entityId) ?? null;
  const loading = read.status === 'loading';
  const failed = read.status === 'error';
  const none = !loading && !failed && (lead === undefined || lead.compared === 0);
  const state = (empty?: { title: string; reason: string }): DrawerCardState =>
    loading
      ? { status: 'loading' }
      : failed
        ? { status: 'error', errorId: read.errorId, retry: read.retry }
        : none
          ? {
              status: 'empty',
              title: t('prompts.noPromptsTitle'),
              reason: t('prompts.noPromptsReason'),
            }
          : empty === undefined
            ? { status: 'ready' }
            : { status: 'empty', ...empty };

  const view = list?.view ?? requested;
  // The view only changes by a person's choice; one narrowing the data no longer supports is dropped on screen and
  // here, so the controls and the list agree
  const change = (next: Partial<PromptView>): void => onViewChange({ ...view, ...next });
  const chooseLead = (value: Lead): void => onViewChange({ lead: value, absent: false, group: null });

  const emptyList =
    list !== null && list.rows.length === 0
      ? {
          title: t('prompts.emptyTitle'),
          reason: view.absent || view.group !== null ? t('prompts.emptyNarrow') : t('prompts.emptyGroup'),
        }
      : undefined;
  const absentTip = t('prompts.absentTip', { name: competitor.name });
  return (
    <>
      <div className="flex flex-col gap-2">
        <SegmentedControl<Lead>
          semantics="view"
          size="sm"
          label={t('prompts.whoLeads')}
          value={view.lead}
          onValueChange={chooseLead}
          items={LEAD_KINDS.map((kind) => ({
            value: kind,
            label: t(`prompts.${KIND_LABEL[kind]}`),
            ...(list === null ? {} : { count: formatInteger(list.counts[kind]) }),
          }))}
        />
        {list !== null && list.absentCount > 0 ? (
          <Tooltip content={absentTip}>
            <Button
              variant="secondary"
              size="sm"
              aria-pressed={view.absent}
              className="self-start"
              onClick={() => change({ absent: !view.absent })}
            >
              {`${t('prompts.absent')} ${formatInteger(list.absentCount)}`}
            </Button>
          </Tooltip>
        ) : null}
      </div>
      {list !== null && list.groups.length > 0 ? (
        <DrawerCard
          title={t(`prompts.${TITLE_KEY[view.lead].groups}`, { name: competitor.name })}
          icon={Folders}
          meta={t('prompts.groupsMeta')}
          info={{ what: t('prompts.info.groups.what'), how: t('prompts.info.groups.how') }}
          state={state()}
          errorTitle={t('errorTitle')}
          flush
        >
          <GroupStrip
            groups={list.groups}
            selected={view.group}
            onSelect={(key) => change({ group: key })}
            fillColor={view.lead === 'you' ? fill(1) : fill(rivalSlot)}
          />
        </DrawerCard>
      ) : null}
      <DrawerCard
        title={t(`prompts.${TITLE_KEY[view.lead].list}`, { name: competitor.name })}
        icon={MessageSquare}
        meta={list === null ? null : t('prompts.listMeta', { count: list.total })}
        info={{ what: t('prompts.info.list.what'), how: t('prompts.info.list.how') }}
        state={state(emptyList)}
        errorTitle={t('errorTitle')}
        flush
      >
        {list === null ? null : (
          <>
            <ul>
              {list.rows.map((row) => (
                <PromptLink key={row.promptId} row={row} name={competitor.name} rivalSlot={rivalSlot} />
              ))}
            </ul>
            <p className="border-t border-border-subtle px-4 py-3 num type-meta">
              {t('prompts.showing', { shown: list.rows.length, total: list.total })}
            </p>
            {read.leads?.status === 'read' && read.leads.tooFew > 0 ? (
              <p className="border-t border-border-subtle px-4 py-3 type-meta">
                {t('prompts.tooFew', { count: read.leads.tooFew, min: MIN_OBSERVATIONS })}
              </p>
            ) : null}
          </>
        )}
      </DrawerCard>
    </>
  );
}
