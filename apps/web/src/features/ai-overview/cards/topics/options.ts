import type { TopicMetric } from './model-types';
import type { EngineCode } from '@/lib/api/types';
import { ENGINES } from '@/lib/layouts/catalog';

/**
 * A card's options are sanitized by the layout before the card sees them, so these never throw: a value that is not
 * one the catalog offers reads as the catalog default.
 */

/** The value of `allowed` that `value` is, or `fallback`. */
export const enumOf = <T extends string>(value: string, allowed: readonly T[], fallback: T): T =>
  allowed.find((entry) => entry === value) ?? fallback;

const METRICS: readonly TopicMetric[] = ['mention', 'citation', 'share_of_voice'];
export const metricOf = (value: string): TopicMetric => enumOf(value, METRICS, 'mention');

const ENGINE_CODES: readonly EngineCode[] = ENGINES.map((engine) => engine.code);
export const engineOf = (value: string): EngineCode => enumOf(value, ENGINE_CODES, 'chatgpt_web');

/** A whole number above 0 (a row or topic count), else `fallback`. */
export function countOf(value: string, fallback: number): number {
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? count : fallback;
}
