'use client';

import { useState } from 'react';

import { KEYWORDS, type KeywordRow } from './data';
import { Spark } from './spark';

function changeOf(row: KeywordRow): { text: string; tone: string } {
  if (row.rank === null) return { text: 'Lost', tone: 'text-[#B42318]' };
  if (row.previous === null) return { text: 'New', tone: 'text-[#0F7B4F]' };
  const delta = row.previous - row.rank;
  if (delta > 0) return { text: `↑${delta}`, tone: 'text-[#0F7B4F]' };
  if (delta < 0) return { text: `↓${Math.abs(delta)}`, tone: 'text-[#B42318]' };
  return { text: '0', tone: 'text-ink-3' };
}

/** A rank history that draws upward as the position improves, with the top 3 and top 10 bands marked. */
function History({ series }: { series: readonly number[] }) {
  const W = 260;
  const H = 120;
  const max = Math.max(30, ...series);
  const x = (i: number) => 8 + (i / (series.length - 1)) * (W - 16);
  const y = (r: number) => 8 + ((r - 1) / (max - 1)) * (H - 16);
  const d = series.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(r).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Rank history over 14 days" className="h-auto w-full">
      {[3, 10].map((band) => (
        <line key={band} x1="8" x2={W - 8} y1={y(band)} y2={y(band)} stroke="#E1E5EB" strokeDasharray="3 4" />
      ))}
      <path d={d} fill="none" stroke="#1E65E3" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(series.length - 1)} cy={y(series[series.length - 1] ?? 1)} r="3.6" fill="#1E65E3" />
    </svg>
  );
}

const CELL = 'px-3 text-ink-2';

/** The Keywords view: a metric strip, the table with sparklines, and an inspector for the selected row. */
export function RankingsView({ compact = false }: { compact?: boolean }) {
  const [selected, setSelected] = useState(0);
  const row = KEYWORDS[selected] ?? KEYWORDS[0];
  if (!row) return null;
  const change = changeOf(row);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-3 sm:p-4">
        {/* Metric strip: one panel, as in the app, never a row of cards. */}
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-line ring-1 ring-ink/[0.06] sm:grid-cols-4">
          {[
            ['Tracked', '1,000', 'keywords'],
            ['In top 3', '86', '+7 this month'],
            ['In top 10', '312', '+21 this month'],
            ['Not in top 20', '241', 'checked daily'],
          ].map(([label, value, note]) => (
            <div key={label} className="bg-surface px-3 py-2.5">
              <dt className="text-[11px] text-ink-3">{label}</dt>
              <dd className="mt-0.5 flex items-baseline gap-2">
                <span className="font-mono text-[18px] font-medium tracking-[-0.03em]">{value}</span>
                <span className="truncate text-[11px] text-ink-3">{note}</span>
              </dd>
            </div>
          ))}
        </dl>

        <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-surface ring-1 ring-ink/[0.06]">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="h-8 bg-paper text-[11px] font-medium text-ink-3">
                <th className="px-3 font-medium">Keyword</th>
                <th className="px-3 text-right font-medium">Rank</th>
                <th className="px-3 text-right font-medium">Change</th>
                <th className="hidden px-3 font-medium sm:table-cell">Trend</th>
                <th className="hidden px-3 font-medium lg:table-cell">Ranking URL</th>
                <th className="hidden px-3 text-right font-medium md:table-cell">Volume</th>
                <th className="hidden px-3 text-right font-medium md:table-cell">KD</th>
              </tr>
            </thead>
            <tbody>
              {KEYWORDS.map((item, index) => {
                const c = changeOf(item);
                const active = index === selected;
                return (
                  <tr
                    key={item.keyword}
                    onClick={() => setSelected(index)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') setSelected(index);
                    }}
                    tabIndex={0}
                    aria-selected={active}
                    className={`h-10 cursor-pointer border-t border-line outline-none transition-colors duration-150 focus-visible:bg-wash ${active ? 'bg-wash' : 'hover:bg-paper'}`}
                  >
                    <td className="max-w-[12rem] truncate px-3 font-medium text-ink">{item.keyword}</td>
                    <td className="px-3 text-right font-mono text-ink">{item.rank ?? <span className="text-ink-3">&gt;20</span>}</td>
                    <td className={`px-3 text-right font-mono ${c.tone}`}>{c.text}</td>
                    <td className="hidden px-3 sm:table-cell">
                      <Spark series={item.series} />
                    </td>
                    <td className={`hidden max-w-[11rem] truncate font-mono text-[12px] lg:table-cell ${CELL}`}>{item.path || <span className="text-ink-3">Not ranking</span>}</td>
                    <td className={`hidden text-right font-mono md:table-cell ${CELL}`}>{item.volume}</td>
                    <td className={`hidden text-right font-mono md:table-cell ${CELL}`}>{item.difficulty}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {compact ? null : (
        <aside className="hidden w-[272px] shrink-0 flex-col gap-4 overflow-hidden border-l border-line bg-surface p-4 xl:flex" aria-label="Keyword inspector">
          <div>
            <p className="text-[11px] text-ink-3">Keyword</p>
            <p className="mt-0.5 text-[15px] font-semibold tracking-[-0.02em]">{row.keyword}</p>
          </div>
          <div className="flex items-end gap-4">
            <div>
              <p className="text-[11px] text-ink-3">Position</p>
              <p className="font-mono text-[28px] leading-none font-medium tracking-[-0.04em]">{row.rank ?? '>20'}</p>
            </div>
            <p className={`pb-0.5 font-mono text-[14px] ${change.tone}`}>{change.text}</p>
          </div>
          <History series={row.series} />
          <dl className="grid gap-2.5 text-[12px]">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">Ranking URL</dt>
              <dd className="truncate font-mono text-ink-2">{row.path || 'None'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">Best rank</dt>
              <dd className="font-mono text-ink-2">{Math.min(...row.series)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">Intent</dt>
              <dd className="text-ink-2">{row.intent}</dd>
            </div>
          </dl>
          {row.features.length ? (
            <div>
              <p className="mb-1.5 text-[11px] text-ink-3">SERP features</p>
              <ul className="flex flex-wrap gap-1.5">
                {row.features.map((feature) => (
                  <li key={feature} className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-cobalt-deep">
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="mt-auto font-mono text-[10px] text-ink-3">Illustrative data</p>
        </aside>
      )}
    </div>
  );
}
