'use client';

import { motion } from 'motion/react';
import { ArrowUp, ChartLineUp, ChatsCircle, Check, Compass, FileMagnifyingGlass, FileText, Globe, Graph, Plugs, Users } from '@phosphor-icons/react';

/*
 * One hero scene per inner page, drawn in HTML and SVG. They share a frame (a bezel with a tinted wash) and a
 * rule: one idea per page, shown with the product's own words. Every number and brand here is invented.
 */

const EASE = [0.32, 0.72, 0, 1] as const;

function Frame({ tint, children, label }: { tint: string; children: React.ReactNode; label: string }) {
  return (
    <div role="img" aria-label={label} className="rounded-[2rem] shadow-lift ring-1 ring-ink/[0.08]">
      <div className={`relative aspect-[4/3] overflow-hidden rounded-[2rem] ${tint}`}>{children}</div>
    </div>
  );
}

function Pop({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 18, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.7, delay: 0.3 + delay, ease: EASE }} className={className}>
      {children}
    </motion.div>
  );
}

/** Product: one topic, joined to the keywords that rank for it and the prompts that name it. */
export function RecordScene() {
  const keywords = [
    { k: 'ai overview tracker', r: '#3', up: true },
    { k: 'rank checker', r: '#7', up: false },
    { k: 'seo reporting', r: '#2', up: true },
  ];
  const prompts = [
    { p: 'Best rank trackers for agencies?', n: 'Named 3 of 4' },
    { p: 'Track brand in ChatGPT?', n: 'Named 2 of 4' },
    { p: 'Rank tracker with AI Overviews?', n: 'Named 4 of 4' },
  ];
  return (
    <Frame label="One topic card joined to three keywords with their ranks and three prompts with how often each names the brand." tint="bg-gradient-to-br from-wash via-surface to-violet-wash">
      <svg viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 size-full">
        {[62, 150, 238].map((y) => (
          <g key={y}>
            <path d={`M118 ${y} C 160 ${y}, 160 150, 188 150`} fill="none" stroke="#1E65E3" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
            <path d={`M282 ${y} C 240 ${y}, 240 150, 212 150`} fill="none" stroke="#7C5CFF" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </svg>
      <div className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
        <Pop>
          <div className="float-a rounded-2xl bg-ink px-4 py-3 text-center text-white shadow-lift">
            <p className="text-[10px] text-white/60">Topic</p>
            <p className="text-sm font-semibold">AI Overview tracking</p>
          </div>
        </Pop>
      </div>
      <div className="absolute inset-y-0 left-[4%] flex w-[30%] flex-col justify-between py-[8%]">
        {keywords.map((row, i) => (
          <Pop key={row.k} delay={i * 0.1}>
            <div className="rounded-xl bg-surface px-3 py-2 shadow-lift ring-1 ring-ink/[0.07]">
              <p className="truncate text-[11px] font-semibold">{row.k}</p>
              <p className="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-cobalt-deep">
                {row.r}
                {row.up ? <ArrowUp size={10} weight="bold" className="text-mint" aria-hidden="true" /> : null}
              </p>
            </div>
          </Pop>
        ))}
      </div>
      <div className="absolute inset-y-0 right-[4%] flex w-[34%] flex-col justify-between py-[8%]">
        {prompts.map((row, i) => (
          <Pop key={row.p} delay={0.15 + i * 0.1}>
            <div className="rounded-xl bg-surface px-3 py-2 shadow-lift ring-1 ring-ink/[0.07]">
              <p className="truncate text-[11px] font-semibold">{row.p}</p>
              <p className="mt-0.5 text-[11px] text-violet">{row.n}</p>
            </div>
          </Pop>
        ))}
      </div>
    </Frame>
  );
}

/** Rank tracking: a ladder of keywords with their states, the way the product shows them. */
export function LadderScene() {
  const rows = [
    { k: 'ai overview tracker', cell: '#3', chip: '+2', tone: 'text-mint', bar: 'bg-cobalt', w: '92%' },
    { k: 'seo reporting', cell: '#7', chip: '-1', tone: 'text-coral', bar: 'bg-violet', w: '70%' },
    { k: 'rank checker', cell: '>20', chip: 'Beyond depth', tone: 'text-ink-3', bar: 'bg-ink/20', w: '26%' },
    { k: 'free rank tracker', cell: 'Pending', chip: 'First check soon', tone: 'text-amber', bar: 'bg-amber', w: '12%' },
    { k: 'serp features tool', cell: 'n/a', chip: 'Check failed', tone: 'text-coral', bar: 'bg-coral', w: '12%' },
  ];
  return (
    <Frame label="Five keywords with five different honest states: ranked and rising, ranked and slipping, beyond the depth checked, pending and check failed." tint="bg-gradient-to-br from-wash via-surface to-amber-wash">
      <div className="absolute inset-0 flex flex-col justify-center gap-2.5 p-[7%]">
        {rows.map((row, i) => (
          <Pop key={row.k} delay={i * 0.08}>
            <div className="flex items-center gap-3 rounded-xl bg-surface px-3.5 py-2.5 shadow-lift ring-1 ring-ink/[0.07]">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold">{row.k}</p>
                <span className="mt-1.5 block h-1.5 rounded-full bg-ink/[0.06]">
                  <motion.span initial={{ width: 0 }} animate={{ width: row.w }} transition={{ duration: 1, delay: 0.6 + i * 0.08, ease: EASE }} className={`block h-full rounded-full ${row.bar}`} />
                </span>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm font-semibold">{row.cell}</p>
                <p className={`text-[10px] font-medium ${row.tone}`}>{row.chip}</p>
              </div>
            </div>
          </Pop>
        ))}
      </div>
    </Frame>
  );
}

/** AI visibility: four engines around one question, each answering differently. */
export function EnginesScene() {
  const engines = [
    { n: 'ChatGPT', c: 'bg-mint', pos: 'top-[9%] left-[7%]', t: 'Named #2' },
    { n: 'Gemini', c: 'bg-coral', pos: 'top-[9%] right-[7%]', t: 'Cited' },
    { n: 'AI Mode', c: 'bg-violet', pos: 'bottom-[9%] left-[7%]', t: 'Named #1' },
    { n: 'AI Overview', c: 'bg-amber text-ink', pos: 'bottom-[9%] right-[7%]', t: 'Not named' },
  ];
  return (
    <Frame label="One question in the center and four engines around it, each with a different result: named second, cited, named first and not named." tint="bg-gradient-to-br from-violet-wash via-surface to-mint-wash">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 size-full">
        {[[22, 22], [78, 22], [22, 78], [78, 78]].map(([x, y]) => (
          <line key={`${x}${y}`} x1="50" y1="50" x2={x} y2={y} stroke="#14171C" strokeOpacity="0.14" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="absolute top-1/2 left-1/2 z-10 w-[42%] -translate-x-1/2 -translate-y-1/2">
        <Pop>
          <div className="float-a rounded-2xl bg-surface p-3 text-center shadow-lift ring-1 ring-ink/[0.07]">
            <p className="text-[10px] text-ink-3">Prompt</p>
            <p className="text-[12px] leading-snug font-semibold">Best rank trackers for agencies?</p>
          </div>
        </Pop>
      </div>
      {engines.map((engine, i) => (
        <div key={engine.n} className={`absolute ${engine.pos}`}>
          <Pop delay={0.12 * (i + 1)}>
            <div className={i % 2 ? 'float-a' : 'float-b'}>
              <div className={`grid size-[4.75rem] place-items-center rounded-full p-1 text-center shadow-lift ring-4 ring-white/80 sm:size-24 ${engine.c} ${engine.c.includes('text-ink') ? '' : 'text-white'}`}>
                <span className="text-[11px] leading-tight font-semibold">
                  {engine.n}
                  <span className="mt-0.5 block text-[10px] font-medium opacity-85">{engine.t}</span>
                </span>
              </div>
            </div>
          </Pop>
        </div>
      ))}
    </Frame>
  );
}

/** Sources: the domains an answer cites, sized by how often, with your own site in the middle. */
export function CitationsScene() {
  const nodes = [
    { n: 'search daily', size: 'size-24', c: 'bg-violet text-white', pos: 'top-[8%] left-[10%]', v: 142 },
    { n: 'agency review', size: 'size-[5.25rem]', c: 'bg-coral text-white', pos: 'top-[10%] right-[10%]', v: 118 },
    { n: 'r/bigseo', size: 'size-16', c: 'bg-amber text-ink', pos: 'bottom-[12%] right-[12%]', v: 52 },
    { n: 'seo weekly', size: 'size-[4.5rem]', c: 'bg-mint text-white', pos: 'bottom-[10%] left-[14%]', v: 64 },
  ];
  return (
    <Frame label="Your site in the middle with four cited domains around it, sized by how often each is cited." tint="bg-gradient-to-br from-amber-wash via-surface to-coral-wash">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 size-full">
        {[[22, 20], [78, 22], [80, 78], [24, 80]].map(([x, y]) => (
          <line key={`${x}${y}`} x1="50" y1="50" x2={x} y2={y} stroke="#14171C" strokeOpacity="0.16" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
        <Pop>
          <div className="float-a grid size-28 place-items-center rounded-full bg-cobalt text-lg font-semibold text-white shadow-[0_24px_50px_-16px_rgb(30_101_227/0.8)] ring-8 ring-white/70">idraft</div>
        </Pop>
      </div>
      {nodes.map((node, i) => (
        <div key={node.n} className={`absolute ${node.pos}`}>
          <Pop delay={0.12 * (i + 1)}>
            <div className={i % 2 ? 'float-a' : 'float-b'}>
              <div className={`grid ${node.size} place-items-center rounded-full p-2 text-center text-[10px] leading-tight font-semibold shadow-lift ring-4 ring-white/80 ${node.c}`}>
                <span>
                  {node.n}
                  <span className="block font-mono text-[10px] opacity-80">{node.v}</span>
                </span>
              </div>
            </div>
          </Pop>
        </div>
      ))}
    </Frame>
  );
}

/** How it works: four stepping stones along a path, one per move. */
export function PathScene() {
  const stones = [
    { n: 1, t: 'Add site', c: 'bg-violet', x: 12, y: 70 },
    { n: 2, t: 'Add keywords', c: 'bg-coral', x: 36, y: 40 },
    { n: 3, t: 'We collect', c: 'bg-amber text-ink', x: 60, y: 62 },
    { n: 4, t: 'Read matrix', c: 'bg-mint', x: 84, y: 28 },
  ];
  return (
    <Frame label="Four numbered stepping stones along a winding path: add your site, add keywords, we collect, read the matrix." tint="bg-gradient-to-br from-mint-wash via-surface to-wash">
      <svg viewBox="0 0 400 300" aria-hidden="true" className="absolute inset-0 size-full">
        <motion.path d="M48 210 C 88 210, 104 120, 144 120 S 200 186, 240 186 S 304 84, 336 84" fill="none" stroke="#1E65E3" strokeOpacity="0.5" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 9" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, delay: 0.3, ease: EASE }} />
      </svg>
      {stones.map((stone, i) => (
        <div key={stone.n} style={{ left: `${stone.x}%`, top: `${stone.y}%` }} className="absolute -translate-x-1/2 -translate-y-1/2">
          <Pop delay={0.25 * i}>
            <div className={i % 2 ? 'float-a' : 'float-b'}>
              <div className={`grid size-20 place-items-center rounded-full text-center shadow-lift ring-4 ring-white/80 sm:size-24 ${stone.c} ${stone.c.includes('text-ink') ? '' : 'text-white'}`}>
                <span>
                  <span className="block font-mono text-xl font-semibold">{stone.n}</span>
                  <span className="block text-[10px] leading-tight font-semibold">{stone.t}</span>
                </span>
              </div>
            </div>
          </Pop>
        </div>
      ))}
    </Frame>
  );
}

/** Features: a grid of colored feature tiles, one lifted. */
export function TilesScene() {
  const tiles = [
    { i: ChartLineUp, c: 'bg-wash text-cobalt-deep' },
    { i: FileMagnifyingGlass, c: 'bg-wash text-cobalt-deep' },
    { i: FileText, c: 'bg-wash text-cobalt-deep' },
    { i: ChatsCircle, c: 'bg-violet-wash text-violet' },
    { i: Globe, c: 'bg-violet-wash text-violet' },
    { i: Graph, c: 'bg-violet-wash text-violet' },
    { i: Compass, c: 'bg-amber-wash text-ink' },
    { i: Users, c: 'bg-amber-wash text-ink' },
    { i: Plugs, c: 'bg-mint-wash text-mint' },
  ];
  return (
    <Frame label="A grid of nine feature tiles in four color groups, with the website audit tile lifted above the rest." tint="bg-gradient-to-br from-surface via-wash to-violet-wash">
      <div className="absolute inset-0 grid grid-cols-3 gap-3 p-[8%]">
        {tiles.map((tile, i) => {
          const Glyph = tile.i;
          const lifted = i === 1;
          return (
            <Pop key={i} delay={i * 0.05} className="h-full">
              <div className={`grid h-full place-items-center rounded-2xl shadow-lift ring-1 ring-ink/[0.07] ${tile.c} ${lifted ? 'float-a -translate-y-2 scale-105 ring-2 ring-cobalt/40' : ''}`}>
                <Glyph size={34} weight="duotone" aria-hidden="true" />
              </div>
            </Pop>
          );
        })}
      </div>
    </Frame>
  );
}

/** About: a receipt for one number, with the evidence printed under it. */
export function ReceiptScene() {
  const lines: [string, string][] = [
    ['Position', '#3'],
    ['Checked', 'Oct 29, 06:12'],
    ['Checks behind it', 'n = 24'],
    ['Ranking page', '/ai-visibility'],
    ['Source', 'Google, desktop, US'],
  ];
  return (
    <Frame label="A receipt for the number three: position, when it was checked, how many checks are behind it, the ranking page and the source." tint="bg-gradient-to-br from-amber-wash via-surface to-coral-wash">
      <div className="absolute top-1/2 left-1/2 w-[62%] -translate-x-1/2 -translate-y-1/2 -rotate-2">
        <Pop>
          <div className="float-a rounded-xl bg-surface px-5 py-5 font-mono text-[11px] shadow-lift ring-1 ring-ink/[0.07]">
            <p className="text-center text-[10px] tracking-[0.2em] text-ink-3 uppercase">idraft receipt</p>
            <p className="mt-2 text-center text-5xl font-semibold tracking-[-0.06em] text-cobalt">#3</p>
            <div className="my-3 border-t border-dashed border-ink/20" />
            <dl className="flex flex-col gap-1.5">
              {lines.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className="text-right font-medium text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="my-3 border-t border-dashed border-ink/20" />
            <p className="flex items-center justify-center gap-1.5 text-[10px] font-semibold text-mint">
              <Check size={12} weight="bold" aria-hidden="true" />
              Shown with its evidence
            </p>
          </div>
        </Pop>
      </div>
    </Frame>
  );
}
