'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { CitationScope } from './citation-scope';
import { stripItems, stripStatus, type StripReads } from './strip-model';
import { MetricStrip, type MetricStripGroup } from '@/components/app/metric/metric-strip';
import type { EngineCode } from '@/lib/citations/types';

export interface CitationsStripProps {
  reads: StripReads;
  scope: CitationScope;
  /** The name of an engine by its code, from the project's engines. */
  labelOf: (code: EngineCode) => string;
  size?: 'md' | 'inline' | undefined;
}

/**
 * The summary of the Citations page (DS 9.7): citation units, distinct domains, effective sources, the own
 * citation share, and the new and lost sources, in one compact inline strip or md strip. It is of the whole scope: the role filter and
 * the minimum of the tables never narrow it (the minimum is the one the New and Lost counts are read with).
 * Each figure comes from its own read, so one that fails is n/a with its reason and the rest stays.
 */
export function CitationsStrip({ reads, scope, labelOf, size = 'inline' }: CitationsStripProps): ReactElement {
  const t = useTranslations('citations.strip');
  const groups: readonly MetricStripGroup[] = [{ id: 'citations', items: stripItems(reads, scope, { t, labelOf }) }];
  return (
    <MetricStrip
      size={size}
      label={t('label')}
      groups={groups}
      status={stripStatus(reads)}
      nowrap={size === 'inline'}
    />
  );
}
