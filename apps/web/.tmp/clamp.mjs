import { readFileSync } from 'node:fs';
import { parse, displayable, clampChroma, differenceCiede2000 } from 'culori';
const css = readFileSync('src/styles/tokens.css','utf8');
for (const sel of [/^:root\s*\{([\s\S]*?)^\}/m, /^\.dark\s*\{([\s\S]*?)^\}/m]) {
  const body = sel.exec(css)[1];
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(oklch\(([^)/]*)\))\s*;/g)) {
    const c = parse(m[2]); if (!c) continue;
    const cl = clampChroma(c,'oklch');
    if (!displayable(c) && differenceCiede2000()(c, cl) > 0.5) console.log(sel.source.slice(1,6), m[1], m[2], '->', `oklch(${m[3].trim().split(/\s+/)[0]} ${(Math.floor(cl.c*1000)/1000).toFixed(3)} ${m[3].trim().split(/\s+/)[2]})`);
  }
}
