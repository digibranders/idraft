/**
 * Raising an older stored document to the current schema, on read (spec section 6.4). The stored document is
 * rewritten only when the person saves.
 */

/** One step per version: UPGRADE_STEPS[n - 1] turns a schema n document into schema n + 1. Empty while schema is 1. */
export type UpgradeStep = (document: Readonly<Record<string, unknown>>) => Record<string, unknown>;

export const UPGRADE_STEPS: ReadonlyArray<UpgradeStep> = [];

export const CURRENT_SCHEMA = UPGRADE_STEPS.length + 1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * An older document raised to the schema of `steps` (CURRENT_SCHEMA for the shipped steps), one step at a time.
 * Anything else (not an object, no integer schema, a newer schema, a missing step, a step that does not raise
 * the schema by one) is returned as it came, so isLayoutDocument counts it absent.
 */
export function upgradeDocument(raw: unknown, steps: ReadonlyArray<UpgradeStep> = UPGRADE_STEPS): unknown {
  if (!isRecord(raw)) return raw;
  const target = steps.length + 1;
  let document = raw;
  let schema = document.schema;
  while (typeof schema === 'number' && Number.isInteger(schema) && schema >= 1 && schema < target) {
    const step = steps[schema - 1];
    if (!step) return raw;
    document = step(document);
    if (document.schema !== schema + 1) return raw;
    schema += 1;
  }
  return document;
}
