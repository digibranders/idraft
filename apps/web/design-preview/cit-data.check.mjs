/* global console */
/**
 * Self-check of the Citations data (cit-data.js): run `node design-preview/cit-data.check.mjs` from apps/web.
 * It checks that the totals of the strip, the cited pages table and the gap analysis agree with each other.
 */
import assert from 'node:assert/strict';
import { DEFAULT_COMPETITORS, answersIn, gapRows, headline, pageDetail, pageRows, promptDetail } from './cit-data.js';

const scope = { platform: 'all', group: 'all', runs: 4, competitors: DEFAULT_COMPETITORS };

for (const runs of [1, 2, 4]) {
  for (const platform of ['all', 'chatgpt_web', 'google_ai_overview']) {
    const s = { ...scope, runs, platform };
    const strip = headline(s);
    const rows = pageRows(s);
    const own = rows.filter((row) => row.owner === 'own');
    // Total citations is the sum of the own rows, and unique URLs is how many own rows there are
    assert.equal(own.reduce((sum, row) => sum + row.citations, 0), strip.citations.value);
    assert.equal(own.length, strip.urls.value);
    assert.equal(new Set(rows.map((row) => row.domain)).size, strip.domains.value);
    for (const row of rows) {
      assert.equal(Object.values(row.engines).reduce((a, b) => a + b, 0), row.citations, `engines add up for ${row.url}`);
      assert.equal([...row.prompts.values()].reduce((a, b) => a + b, 0), row.citations, `prompts add up for ${row.url}`);
    }
    for (const field of ['frequency', 'coverage']) {
      const { value } = strip[field];
      assert.ok(value === null || (value >= 0 && value <= 1), `${field} is a ratio`);
    }
    // Fewer runs means fewer answers
    assert.ok(answersIn(s).length <= answersIn({ ...s, runs: 4 }).length);
  }
}

const strip = headline(scope);
const gaps = gapRows(scope);
// A prompt is lost on a platform where a selected competitor is cited and you are not
for (const row of gaps) {
  for (const code of Object.keys(row.you.perCode)) {
    const lost = row.you.perCode[code].n > 0 && row.you.perCode[code].k === 0 && Object.values(row.rivals).some((cell) => cell.perCode[code].k > 0);
    assert.equal(row.lostOn.includes(code), lost, `lost on ${code} for ${row.id}`);
  }
  assert.ok(row.you.m <= row.you.n && row.you.k <= row.you.n);
  assert.ok(row.you.citedOn <= row.you.platforms);
}
// Under All platforms, a prompt lost on one platform is a gap, so there are at least as many as on any single platform
const perPlatformGaps = ['chatgpt_web', 'gemini_web', 'google_ai_mode', 'google_ai_overview'].map((platform) => gapRows({ ...scope, platform }).filter((row) => row.gap > 0).length);
assert.ok(gaps.filter((row) => row.gap > 0).length >= Math.max(...perPlatformGaps));
// Prompt coverage counts the prompts cited at least once, per platform
const covered = strip.perCode.reduce((sum, entry) => sum + entry.covered, 0);
assert.ok(covered > 0 && covered <= strip.perCode.reduce((sum, entry) => sum + entry.prompts, 0));

const top = pageRows(scope).filter((row) => row.owner === 'own').sort((a, b) => b.citations - a.citations)[0];
const detail = pageDetail(top.url, scope);
assert.equal(detail.citations, top.citations);
assert.equal(detail.prompts.length, top.promptCount);

const firstGap = gaps.find((row) => row.gap > 0);
const prompt = promptDetail(firstGap.id, scope);
assert.ok(prompt.rivalPages.length > 0, 'a gap prompt has competitor pages');

console.log(
  `ok: ${strip.citations.value} citations (${strip.citations.previous} before), ${strip.urls.value} own URLs, ${strip.domains.value} domains, ` +
    `frequency ${(strip.frequency.value * 100).toFixed(1)}%, coverage ${(strip.coverage.value * 100).toFixed(1)}%, ` +
    `${gaps.filter((row) => row.gap > 0).length} gaps of ${gaps.length} prompts (per platform: ${perPlatformGaps.join(', ')})`,
);
