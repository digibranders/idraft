'use client';

import { Play, Plus } from 'lucide-react';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { useTopicDrawer } from './drawer-context';
import { categoryOf, scopeParts } from './header-model';
import { useTopicOrder } from './topic-order-store';
import type { InspectorNavigation } from '@/components/app/inspector/inspector-header';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { NO_TOPIC } from '@/features/prompts/prompt-model';
import { DRAWER_ENTRY_KEYS } from '@/features/prompts/topics-by-engine/drill';
import type { PromptSummaryRow, TopicSummaryRow } from '@/lib/api/types';
import { formatList, formatRelative } from '@/lib/format';
import { useInspectorStepping } from '@/lib/inspector/use-inspector-stepping';

/** The order of a table that has drawn none: no topic is in it. */
const NO_ORDER: readonly string[] = [];

export interface TopicHeader {
  /** The category, the prompt count and the scope of the counts: at most 3, under the title. */
  badges: ReactNode;
  /** Add prompt and Run now, in one wrapping row; `null` when the person can do neither. */
  frequentAction: ReactNode;
  /** Previous and Next in the order the Topics tab drew; `null` when the topic is not in it. */
  navigation: InspectorNavigation | null;
  /** "3 of 13"; `null` when the topic is not in the order. */
  positionText: string | null;
  /** "Updated 2h ago", from the newest answer of the topic. */
  freshness: ReactNode;
  /** J and K, the same as Previous and Next; `undefined` when the topic is not in the order. */
  onStep: ((direction: 'next' | 'previous') => void) | undefined;
}

/**
 * The topic drawer's header (WB-TI-02 to 05 and 23), as the parts `Inspector` takes. The category badge is the path above
 * the topic and takes the keyboard (its tooltip has the whole path, as the prompt drawer's does). Add prompt opens the
 * screen's add dialog with this topic chosen; Run now hands the topic's prompt ids to the screen's run, which asks first
 * above one prompt. Each is left out for a role that cannot do it, and disabled with its reason while it cannot be done.
 * Previous, Next, J and K step through the topics in the order the Topics tab drew them. Draw it inside a
 * `TopicDrawerProvider`.
 */
export function useTopicHeader({
  topicKey,
  row,
  prompts,
}: {
  topicKey: string;
  row: TopicSummaryRow | undefined;
  /** The prompts of the topic and of the topics below it; `null` while they cannot be told. */
  prompts: readonly PromptSummaryRow[] | null;
}): TopicHeader {
  const { engines, extras, counts } = useTopicDrawer();
  const t = useTranslations('prompts.topicDrawer');
  const words = useTranslations('prompts');
  const locale = useLocale();
  const timeZone = useTimeZone() ?? 'UTC';
  const inspector = useInspector({ entryKeys: DRAWER_ENTRY_KEYS });
  const order = useTopicOrder(extras.scope.projectId);
  // The shared stepping hook: "3 of 13", Previous, Next, J and K, and the announcement at both ends. A topic that is not
  // in the order the Topics tab drew (or no order at all) gets none of them
  const stepping = useInspectorStepping({
    inspector,
    type: 'topic',
    order: order ?? NO_ORDER,
    typeLabel: t('type'),
    typeNoun: t('noun'),
  });

  const category = categoryOf(topicKey, extras.tree);
  const parts = scopeParts({ engines, country: extras.country, includeBranded: extras.includeBranded });
  const scope = formatList(
    [
      typeof parts.engines === 'number' ? t('header.scopeEngines', { count: parts.engines }) : parts.engines,
      ...(parts.country === null ? [] : [extras.countryName(parts.country)]),
      t(parts.branded ? 'header.scopeBranded' : 'header.scopeNonBranded'),
    ],
    locale,
  );
  const badges = (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {category === null ? null : (
        // A topic below another is named by what is above it, cut short in a narrow header; the tooltip has the whole path
        // and the badge takes the keyboard so it reaches it
        <Tooltip content={t('header.categoryTip', { path: category.path })}>
          <Badge tabIndex={0} className="max-w-full truncate">
            {category.text}
          </Badge>
        </Tooltip>
      )}
      {row === undefined ? null : <Badge>{t('promptCount', { count: row.prompt_count })}</Badge>}
      <Badge variant="outline" role="group" aria-label={t('header.scopeLabel', { scope })}>
        {scope}
      </Badge>
    </span>
  );

  // A topic the summary has no row for (the body says it could not be loaded) has nothing to add to or to run
  const missing = counts.status === 'ready' && row === undefined;
  const onAddPrompt = missing ? null : extras.onAddPrompt;
  const run = missing ? null : extras.run;
  const runReason =
    run === null
      ? null
      : (run.blockedReason ??
        (prompts === null ? words('bulk.listLoading') : prompts.length === 0 ? t('header.runNoPrompts') : null));
  const showAdd = onAddPrompt !== null && topicKey !== NO_TOPIC;
  const frequentAction =
    !showAdd && run === null ? null : (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {showAdd ? (
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => onAddPrompt(topicKey)}>
            {t('header.addPrompt')}
          </Button>
        ) : null}
        {run === null ? null : (
          <Tooltip content={runReason ?? ''} disabled={runReason === null}>
            <Button
              variant="secondary"
              size="sm"
              icon={Play}
              disabled={runReason !== null}
              focusableWhenDisabled
              onClick={() => run.onRun((prompts ?? []).map((prompt) => prompt.prompt_id))}
            >
              {t('header.runNow')}
            </Button>
          </Tooltip>
        )}
      </div>
    );

  return {
    badges,
    frequentAction,
    navigation: stepping.navigation,
    positionText: stepping.positionText,
    freshness:
      row?.last_observed_at == null ? null : (
        <span>{words('inspector.updated', { time: formatRelative(row.last_observed_at, timeZone) })}</span>
      ),
    onStep: stepping.onStep,
  };
}
