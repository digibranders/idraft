'use client';

import { useTranslations } from 'next-intl';
import { useId, useMemo, type ReactElement } from 'react';

import { ChangeInline, useChangeWords, useComparedWindow, useCompare } from './compare';
import { useRateWords } from './rate-view';
import { visibilityChangeOf } from './visibility-change';
import { CardInfoButton } from '@/components/app/chart/card-info';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { ENGINE_ORDER } from '@/components/app/engine/order';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import type { ProjectEngine } from '@/lib/api/types';
import { EMPTY_VALUE, formatDateRange, formatInteger } from '@/lib/format';
import { engineRates, type RateFigure, type StripPrompt } from '@/lib/rates/strip-model';
import { visibilityOfPrompts } from '@/lib/rates/visibility-model';
import { cn } from '@/lib/utils';

export interface PromptsStripProps {
  /** The prompts in scope: those the Prompts tab lists after the filters. */
  prompts: readonly StripPrompt[];
  /** Every platform that is on, whether the Platform select has it in view or not: the strip reads them all. */
  engines: readonly ProjectEngine[];
  /** The codes of the platforms the Platform select has in view; the others sit on a quiet ground. Every platform that is on when left out. */
  inView?: readonly string[] | undefined;
  /** How many groups the prompts span; `null` while the summary cannot tell. */
  topics: number | null;
  status: 'loading' | 'ready' | 'refetching';
  /** The counts could not be read: every figure is unknown, and the page's banner says why. */
  countsFailed: boolean;
}

/** The platforms the product names, by API code, and the key of their name in the catalog. */
const PLATFORM_NAMES = {
  chatgpt_web: 'chatgptWeb',
  gemini_web: 'geminiWeb',
  google_ai_mode: 'googleAiMode',
  google_ai_overview: 'googleAiOverview',
} as const;
/** The first slot, the prompts in view, and one slot for each platform: the room is fixed, whatever the data holds. */
const GRID = 'minmax(6rem,0.6fr)';
const PLATFORM_COLUMN = 'minmax(12.5rem,1fr)';

interface SlotProps {
  id: string;
  label: ReactElement | string;
  value: string;
  unknown: 'insufficient' | 'none' | null;
  delta?: ReactElement | null;
  tip?: string | undefined;
  quiet?: boolean;
  /** Said to a screen reader after the figure. */
  note?: string | undefined;
  loading: boolean;
}

function Slot({ id, label, value, unknown, delta, tip, quiet = false, note, loading }: SlotProps): ReactElement {
  const ids = useId();
  const termId = `${ids}${id}-term`;
  const valueId = `${ids}${id}-value`;
  const tipped = tip !== undefined && !loading;
  return (
    <div className={cn('flex h-control min-w-0 items-center gap-2 px-3', quiet && 'bg-surface-subtle')}>
      <dt id={termId} className="flex min-w-0 items-center gap-1.5 type-meta text-foreground-secondary">
        {label}
      </dt>
      <Tooltip content={tip ?? ''} disabled={!tipped}>
        <dd
          id={valueId}
          // A figure with counts in its tooltip is a tab stop that opens it (20 section 6.2 rule 6), named by its label and value
          {...(tipped ? { tabIndex: 0, 'aria-labelledby': `${termId} ${valueId}` } : {})}
          className={cn(
            'flex shrink-0 items-baseline gap-1.5',
            tipped && '-mx-1 rounded-sm px-1 outline-none focus-visible:focus-ring-inset',
          )}
        >
          {loading ? (
            <span className="flex w-6 items-center">
              <Skeleton shape="text-14" widthPct={100} />
            </span>
          ) : (
            <span
              className={cn(
                'num type-body-strong',
                unknown === null ? 'text-foreground' : 'text-foreground-tertiary',
                unknown === 'insufficient' && 'bg-insufficient',
              )}
            >
              {value}
            </span>
          )}
          {loading || delta === undefined || delta === null ? null : (
            <span className="num type-body-strong">{delta}</span>
          )}
          {note === undefined ? null : <span className="sr-only">{note}</span>}
        </dd>
      </Tooltip>
    </div>
  );
}

/**
 * The strip under the controls of the Prompts tab (ADR-DS-022 decision 12): the prompts in view, then one slot for
 * every platform, always, in the order of the platforms. The slot shows the platform's AI visibility, how often its
 * answers name or cite the brand, over the prompts in scope (the prompt weighted mean, each prompt counted once). A
 * platform the Platform select leaves out keeps its place on a quiet ground, so choosing a platform, comparing or
 * filtering changes figures and never the shape of the strip; one that is not collected for the project says so.
 * The slot's tooltip, a tab stop, holds the counts behind the figure and the Mentioned, Cited and Share of voice rates.
 * A rate over fewer than `MIN_OBSERVATIONS` valid answers shows the answers instead (parity spec D-1), and one that
 * does not exist reads "n/a" with its reason.
 */
export function PromptsStrip({
  prompts,
  engines,
  inView,
  topics,
  status,
  countsFailed,
}: PromptsStripProps): ReactElement {
  const t = useTranslations('prompts.strip');
  const shell = useTranslations('prompts.shell.strip');
  const names = useTranslations('prompts.shell.platform.names');
  const tc = useTranslations('prompts.compare');
  const words = useRateWords();
  const changeWords = useChangeWords();
  const { compare } = useCompare();
  const compared = useComparedWindow();
  const loading = status === 'loading';

  // The platforms of the product first, in their order; a platform the API names beyond them follows, one slot each
  // (there are as many slots as platforms, and the strip scrolls inside itself when they do not fit)
  const slots = useMemo(() => {
    const known: readonly string[] = ENGINE_ORDER;
    const more = engines.map((engine) => engine.engine.engine_code).filter((code) => !known.includes(code));
    return [...ENGINE_ORDER, ...more];
  }, [engines]);

  /** One rate in the tooltip: the counts behind it, or why there is none. */
  const detailOf = (figure: RateFigure, ofBrandNamed = false): string => {
    const basis = words.basis(figure);
    if (basis === null) return t('tipReason', { reason: figure.reason ?? 'noAnswers' });
    const counted = ofBrandNamed ? t('tipShareBasis', { basis }) : basis;
    return figure.state === 'insufficient' ? t('tipInsufficient', { basis: counted }) : counted;
  };

  // A platform that is not on has no label from the API: the product's own names stand in
  const nameOf = (code: string): string => {
    const key = Object.entries(PLATFORM_NAMES).find(([known]) => known === code)?.[1];
    return key === undefined ? code : names(key);
  };

  const platformSlot = (code: string): ReactElement => {
    const engine = engines.find((entry) => entry.engine.engine_code === code);
    const name = engine?.engine.label ?? nameOf(code);
    const label = <EngineLogo engine={code} name={name} truncate />;
    const quiet = inView !== undefined && !inView.includes(code);
    const quietNote = quiet && engine !== undefined ? shell('quietNote') : undefined;
    if (engine === undefined || countsFailed) {
      return (
        <Slot
          key={code}
          id={code}
          label={label}
          value={EMPTY_VALUE}
          unknown="none"
          quiet
          loading={false}
          tip={engine === undefined ? shell('notCollectedTip', { platform: name }) : shell('countsFailedTip')}
        />
      );
    }
    const visibility = visibilityOfPrompts(prompts, code);
    const { mentioned, cited, shareOfVoice } = engineRates(prompts, code);
    const parts = {
      platform: name,
      visibility: shell('visibilityTip', { detail: detailOf(visibility) }),
      mentioned: t('tipRate', { metric: t('tipMentioned'), detail: detailOf(mentioned) }),
      cited: t('tipRate', { metric: t('tipCited'), detail: detailOf(cited) }),
      shareOfVoice: t('tipRate', { metric: t('tipShareOfVoice'), detail: detailOf(shareOfVoice, true) }),
    };
    // Each side counts its own prompts (a prompt added since has no earlier figure), and the tip says how many
    const change = compare && !loading ? visibilityChangeOf(prompts, code) : null;
    const base =
      visibility.prompts === 0
        ? shell('tipNoPrompts', parts)
        : shell('tip', { ...parts, prompts: t('tipPrompts', { count: visibility.prompts }) });
    const tip = quiet ? `${base} ${shell('quietTip')}` : base;
    return (
      <Slot
        key={code}
        id={code}
        label={label}
        value={words.text(visibility)}
        unknown={visibility.state === 'ok' ? null : visibility.state}
        quiet={quiet}
        note={quietNote}
        delta={change === null ? null : <ChangeInline change={change} />}
        loading={loading}
        tip={
          change === null
            ? tip
            : tc('strip.tip', {
                tip,
                change: changeWords.tip(change, {
                  kind: 'strip',
                  range: compared === null ? null : formatDateRange(compared.from, compared.to),
                }),
              })
        }
      />
    );
  };

  return (
    <div
      role="group"
      aria-label={t('label')}
      aria-busy={status === 'ready' ? undefined : true}
      className="flex overflow-hidden rounded-lg border border-border bg-surface"
    >
      <dl
        style={{ gridTemplateColumns: `${GRID} repeat(${String(slots.length)}, ${PLATFORM_COLUMN})` }}
        className="scrollbar-none grid min-w-0 flex-1 divide-x divide-border-subtle overflow-x-auto"
      >
        <Slot
          id="prompts"
          label={<span className="truncate">{t('prompts')}</span>}
          value={formatInteger(prompts.length)}
          unknown={null}
          loading={loading}
          tip={topics === null ? undefined : t('topicsSpanned', { count: topics })}
        />
        {slots.map(platformSlot)}
      </dl>
      <div className="flex shrink-0 items-center border-l border-border-subtle px-1">
        <CardInfoButton title={shell('infoTitle')} info={{ what: shell('infoWhat'), how: shell('infoHow') }} />
      </div>
    </div>
  );
}
