import type { EngineCode, Schemas } from '@/lib/api/types';

/**
 * The types of the fan-out reads, taken from the generated client so a schema change breaks the code that reads a
 * field. The prompt inspector and the Citations page both import this folder, because a feature never imports
 * another feature.
 */

export type { EngineCode };

export type FanoutQueryPage = Schemas['FanoutQueryPage'];
export type FanoutQueryRow = Schemas['FanoutQueryRow'];
export type FanoutMeta = Schemas['FanoutMeta'];
export type FanoutCitedDomain = Schemas['FanoutCitedDomain'];
export type FanoutTopic = Schemas['FanoutTopic'];

/** The engine a read names: its code and whether it shows the queries it issues, which the project's engines say. */
export type FanoutEngine = Pick<Schemas['Engine'], 'engine_code' | 'exposes_fanout'>;

/** What every fan-out read shares: the window and one engine, never a pool of engines. */
export interface FanoutFilters {
  /** First and last day of the window, `YYYY-MM-DD` in the project's zone. */
  from: string;
  to: string;
  engine: FanoutEngine;
  /** One prompt's answers, whatever its state. */
  promptId?: string;
  /** The prompts given this term or one below it. */
  term?: string;
  /** The prompts set in one market (two capitals). */
  country?: string;
  includeBranded?: boolean;
}
