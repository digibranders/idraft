'use client';

import { useMemo } from 'react';

import { useCompetitors } from '../competitors-context';
import { entityRows, type EntityRow } from '../model/competitor-model';
import type { EngineCode } from '@/lib/api/types';

export interface TabModel {
  rows: readonly EntityRow[];
  /** The own entities first, then the competitors, as the API orders them. */
  engines: readonly EngineCode[];
  /** Several engines are in scope, so a figure is the platform average. */
  averaged: boolean;
}

/** The tracked set shaped for a tab, and the engines its figures are over. */
export function useTabModel(): TabModel {
  const { reads, scope } = useCompetitors();
  const data = reads.competitors.data;
  const rows = useMemo(() => (data === undefined ? [] : entityRows(data.data)), [data]);
  return { rows, engines: scope.engineScope, averaged: scope.engineScope.length > 1 };
}
