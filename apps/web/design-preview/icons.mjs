/**
 * Fills Lucide icons into the static design-system preview.
 *
 * Markup convention in index.html: `<svg data-icon="chevron-down" class="size-icon ..."></svg>`.
 * Each slot is rebuilt from lucide-static (the same icon set and version as lucide-react), with the
 * stroke rules of docs/design-system/07-icons.md section 2: 1.75 px, non-scaling, round caps and joins.
 * The script is idempotent: slots that are already filled are rebuilt from the source SVG.
 *
 * Usage: node design-preview/icons.mjs (run by `pnpm run preview`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pagePath = join(here, 'index.html');
const require = createRequire(import.meta.url);
const iconDir = join(dirname(require.resolve('lucide-static/package.json')), 'icons');

const SLOT = /<svg data-icon="([a-z0-9-]+)"([^>]*)>[\s\S]*?<\/svg>/g;
const STROKE_WIDTH = '1.75';

/** Returns the inner elements of a lucide-static SVG, each marked non-scaling so the stroke stays 1.75 px at every size. */
function iconBody(name) {
  let source;
  try {
    source = readFileSync(join(iconDir, `${name}.svg`), 'utf8');
  } catch (error) {
    throw new Error(`Unknown Lucide icon "${name}" (no ${name}.svg in lucide-static)`, { cause: error });
  }
  const inner = /<svg[^>]*>([\s\S]*?)<\/svg>/.exec(source)?.[1];
  if (inner === undefined) throw new Error(`Could not read the SVG body of "${name}"`);
  return inner
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((element) => element.replace(/\s*\/>$/, ' vector-effect="non-scaling-stroke" />'))
    .join('');
}

/** Keeps the slot's own attributes (class, and any others) and sets the fixed SVG attributes. */
function slotAttributes(rawAttributes) {
  const kept = rawAttributes
    .replace(/\s(viewBox|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|aria-hidden|focusable|xmlns)="[^"]*"/g, '')
    .trim();
  return [
    kept,
    'xmlns="http://www.w3.org/2000/svg"',
    'viewBox="0 0 24 24"',
    'fill="none"',
    'stroke="currentColor"',
    `stroke-width="${STROKE_WIDTH}"`,
    'stroke-linecap="round"',
    'stroke-linejoin="round"',
    // Decorative by default; an icon that carries meaning keeps its role and accessible name.
    /\saria-label="/.test(kept) ? '' : 'aria-hidden="true"',
    'focusable="false"',
  ]
    .filter(Boolean)
    .join(' ');
}

const page = readFileSync(pagePath, 'utf8');
const used = new Set();
const next = page.replace(SLOT, (_match, name, rawAttributes) => {
  used.add(name);
  return `<svg data-icon="${name}" ${slotAttributes(rawAttributes)}>${iconBody(name)}</svg>`;
});

writeFileSync(pagePath, next);
stdout.write(`Filled ${used.size} distinct Lucide icons: ${[...used].sort().join(', ')}\n`);
