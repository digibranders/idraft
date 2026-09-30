import { readFileSync, writeFileSync } from 'node:fs';
import { parse, formatHex, clampChroma } from 'culori';
const p = '../../docs/design-system/02-color-system.md';
let s = readFileSync(p, 'utf8');
const hex = (l, c, h) => formatHex(clampChroma(parse(`oklch(${l} ${c} ${h})`), 'oklch'));
let n = 0;
// pattern A: `L C H` | `#xxxxxx`   (table rows)
s = s.replace(/`(\d\.\d+) (\d\.\d+) (\d+)` \| `#[0-9a-f]{6}`/g, (_m, l, c, h) => { n++; return `\`${l} ${c} ${h}\` | \`${hex(l, c, h)}\``; });
// pattern B: `L C H` `#xxxxxx`   (semantic cells)
s = s.replace(/`(\d\.\d+) (\d\.\d+) (\d+)` `#[0-9a-f]{6}`/g, (_m, l, c, h) => { n++; return `\`${l} ${c} ${h}\` \`${hex(l, c, h)}\``; });
// pattern C: `oklch(L C H)` `#xxxxxx`   (chart rows)
s = s.replace(/`oklch\((\d\.\d+) (\d\.\d+) (\d+)\)` `#[0-9a-f]{6}`/g, (_m, l, c, h) => { n++; return `\`oklch(${l} ${c} ${h})\` \`${hex(l, c, h)}\``; });
writeFileSync(p, s);
console.log('hex values recomputed:', n);
