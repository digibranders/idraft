'use client';

import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

import type { CompetitorsReads } from './data/use-competitors-reads';
import type { ScopePatch } from './scope/use-competitors-scope';
import type { CompetitorsScope } from './scope/scope-model';
import type { EngineCode } from '@/lib/api/types';
import type { SourceScope } from '@/lib/citations/types';

export interface CompetitorsProject {
  id: string;
  slug: string;
  name: string;
  /** The project's time zone: the window's days are its days. */
  timeZone: string;
}

/** An engine that is on, with the name the page writes for it. */
export interface CompetitorsEngine {
  code: EngineCode;
  label: string;
}

/**
 * What the sections of the page take: the project, the scope and the one set of reads. The shell builds it once, so a
 * section asks for no read of its own and two sections that need the tracked set share one request.
 */
export interface CompetitorsContextValue {
  workspaceId: string;
  workspaceSlug: string;
  project: CompetitorsProject;
  source: SourceScope;
  scope: CompetitorsScope;
  /** Writes keys of the address; a value that is the default removes its key. */
  setScope: (patch: ScopePatch) => void;
  range: { from: string; to: string };
  /** The day it is now in the project's zone. */
  today: string;
  /** The engines that are on, in the project's order. */
  engines: readonly CompetitorsEngine[];
  labelOf: (code: EngineCode) => string;
  reads: CompetitorsReads;
  /** Opens the Add competitor dialog; `null` for a member who cannot add entities. */
  addCompetitor: (() => void) | null;
}

const CompetitorsContext = createContext<CompetitorsContextValue | null>(null);

export function CompetitorsProvider({
  value,
  children,
}: {
  value: CompetitorsContextValue;
  children: ReactNode;
}): ReactElement {
  return <CompetitorsContext.Provider value={value}>{children}</CompetitorsContext.Provider>;
}

/** The page's project, scope and reads; throws outside the screen. */
export function useCompetitors(): CompetitorsContextValue {
  const value = useContext(CompetitorsContext);
  if (value === null) throw new Error('useCompetitors was used outside the Competitors screen');
  return value;
}
