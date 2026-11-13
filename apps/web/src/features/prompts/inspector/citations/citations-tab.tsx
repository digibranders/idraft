'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { CitationsControls } from './citations-controls';
import { ALL_ENGINES, DEFAULT_MIN_SUPPORT, engineColumns, staleSince } from './citations-model';
import { useCitationReads } from './citations-reads';
import { TopDomains, TopPages } from './top-lists';
import type { PromptInspectorTab, PromptTabContext } from '../../seams/inspector-tabs';
import { formatTableDateTime } from '@/lib/format';

export interface CitationsTabProps {
  context: PromptTabContext;
}

/**
 * The Citations tab of the prompt inspector (WB-PIC-01 to 04, 10): which domains and pages the answers to this
 * prompt cite, over the window of the inspector. The engine is All engines (one count column each, never a pool)
 * or one engine; every share says the units it is a share of. The banner above and the answers below join in
 * the next task. It reads only while it is mounted, and each of its reads loads and fails alone.
 */
export function CitationsTab({ context }: CitationsTabProps): ReactElement {
  const t = useTranslations('prompts.citationsTab');
  const [chosen, setChosen] = useState<string>(ALL_ENGINES);
  const [minSupport, setMinSupport] = useState<number>(DEFAULT_MIN_SUPPORT);
  // An engine that was turned off since it was chosen falls back to All engines
  const engine =
    chosen === ALL_ENGINES || context.engines.some((entry) => entry.engine.engine_code === chosen)
      ? chosen
      : ALL_ENGINES;
  const reads = useCitationReads(context, { engine, minSupport });
  const meta = reads.domains.data?.meta;
  const staleAt = staleSince(context.counts.row?.last_valid_at, new Date());
  // What the figures below are of, one sentence each; every share in the lists is of the units the first one names
  const notes = [
    meta === undefined || meta.citation_units === 0
      ? null
      : t('scope', { units: meta.citation_units, answers: meta.answers }),
    engine === ALL_ENGINES ? null : t('scopeEngine', { engine: context.labelOf(engine) }),
    meta !== undefined && (meta.previous_answers ?? 0) === 0 ? t('noPrevious') : null,
    staleAt === null ? null : t('stale', { date: formatTableDateTime(staleAt, context.timeZone) }),
  ].filter((note): note is string => note !== null);
  return (
    <>
      <CitationsControls
        engines={context.engines}
        labelOf={context.labelOf}
        engine={engine}
        onEngineChange={setChosen}
        minSupport={minSupport}
        onMinSupportChange={setMinSupport}
      />
      {notes.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          {notes.map((note) => (
            <p key={note} className="num type-meta">
              {note}
            </p>
          ))}
        </div>
      )}
      <TopDomains
        read={reads.domains}
        lost={reads.lost}
        columns={engineColumns(context.engines, engine)}
        counts={context.counts}
        minSupport={minSupport}
      />
      <TopPages read={reads.pages} ownPages={reads.ownPages} minSupport={minSupport} />
    </>
  );
}

/** The entry the seam lists (wired in the next task): placed after History. */
export const citationsTab: PromptInspectorTab = {
  id: 'citations',
  after: 'history',
  label: (t) => t('prompts.citationsTab.tab'),
  render: (context) => <CitationsTab context={context} />,
};
