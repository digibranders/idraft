/**
 * Writes the layout catalog the API checks documents against (owner decision D-10):
 * backend/src/idraft/api/layouts/catalog.json. Run `pnpm gen:layout-catalog` after changing
 * src/lib/layouts/catalog.ts; the web and the backend both test that the file is fresh.
 * Node strips the types of catalog.ts, which imports nothing but types.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { CARD_TYPES, LIMITS, NUMBER_TYPES, SCREENS } from '../src/lib/layouts/catalog.ts';

const APP_ROOT = path.join(import.meta.dirname, '..');
const SOURCE = 'src/lib/layouts/catalog.ts';
const OUTPUT = path.join(APP_ROOT, '../../backend/src/idraft/api/layouts/catalog.json');
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const catalog = {
  generated_by: 'apps/web: pnpm gen:layout-catalog',
  source_sha256: createHash('sha256')
    .update(readFileSync(path.join(APP_ROOT, SOURCE)))
    .digest('hex'),
  limits: { cards: LIMITS.cards, numbers: LIMITS.numbers },
  screens: Object.fromEntries(
    Object.values(SCREENS)
      .map((screen) => [screen.key, { ...screen.zones }])
      .sort(([a], [b]) => byText(a, b)),
  ),
  // Widths keep their order: the first is the type's default.
  card_types: CARD_TYPES.map((type) => ({
    key: type.key,
    screens: [...type.screens].sort(byText),
    widths: [...type.widths],
    status: type.status,
  })).sort((a, b) => byText(a.key, b.key)),
  numbers: NUMBER_TYPES.map((number) => ({
    metric: number.metric,
    per_engine: number.perEngine,
    screens: [...number.screens].sort(byText),
  })).sort((a, b) => byText(a.metric, b.metric)),
};

const text = `${JSON.stringify(catalog, null, 2)}\n`;
if (process.argv.includes('--stdout')) process.stdout.write(text);
else writeFileSync(OUTPUT, text);
