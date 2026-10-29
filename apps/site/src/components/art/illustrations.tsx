'use client';

import Image from 'next/image';
import { motion } from 'motion/react';
import { ArrowUp, Check, Sparkle } from '@phosphor-icons/react';

/*
 * Artwork for the feature cards and the engine panels, drawn in HTML and SVG so it stays sharp at any size and
 * can move. Each piece fills its parent. The brand names inside are invented, and none of it is customer data.
 */

const EASE = [0.32, 0.72, 0, 1] as const;

/** Rank ladder: five bars climbing, a crown chip on the tallest, and keywords that moved. */
export function RankArt() {
  const bars = [
    { h: 34, c: 'bg-violet' },
    { h: 48, c: 'bg-coral' },
    { h: 62, c: 'bg-amber' },
    { h: 78, c: 'bg-mint' },
    { h: 100, c: 'bg-cobalt' },
  ];
  return (
    <div className="relative h-full w-full overflow-hidden rounded-[inherit] bg-gradient-to-br from-violet-wash via-surface to-amber-wash">
      <div className="absolute inset-x-8 bottom-0 flex h-[78%] items-end gap-3 sm:inset-x-12">
        {bars.map((bar, index) => (
          <motion.div
            key={bar.c}
            initial={{ scaleY: 0 }}
            whileInView={{ scaleY: 1 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.9, delay: index * 0.09, ease: EASE }}
            style={{ height: `${bar.h}%`, transformOrigin: 'bottom' }}
            className={`relative flex-1 rounded-t-2xl ${bar.c} shadow-[0_18px_30px_-18px_rgb(20_23_28/0.4)]`}
          >
            <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1/3 rounded-t-2xl bg-gradient-to-b from-white/35 to-transparent" />
          </motion.div>
        ))}
      </div>
      <div className="float-a absolute top-[14%] right-[12%] flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-[13px] font-semibold shadow-lift ring-1 ring-ink/10">
        <span className="grid size-5 place-items-center rounded-full bg-mint text-white">
          <ArrowUp size={11} weight="bold" aria-hidden="true" />
        </span>
        ai overview tracker
        <span className="font-mono text-mint">+2</span>
      </div>
      <div className="float-b absolute top-[34%] left-[8%] flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-[13px] font-semibold shadow-lift ring-1 ring-ink/10">
        rank checker
        <span className="rounded-full bg-coral-wash px-2 py-0.5 font-mono text-[12px] text-coral">#3</span>
      </div>
      <div className="absolute top-[8%] left-[10%] grid size-14 place-items-center rounded-full bg-cobalt font-mono text-lg font-semibold text-white shadow-[0_18px_40px_-14px_rgb(30_101_227/0.8)] ring-4 ring-white/70">#1</div>
    </div>
  );
}

/** A question and the answer it got, with your brand picked out and rivals in their own colors. */
export function AnswerArt() {
  return (
    <div className="relative flex h-full w-full flex-col justify-center gap-3 overflow-hidden rounded-[inherit] bg-gradient-to-br from-mint-wash via-surface to-surface p-5 sm:p-7">
      <div className="ml-auto max-w-[78%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[13px] leading-snug text-white">Best rank trackers for agencies?</div>
      <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-surface px-4 py-3 text-[13px] leading-relaxed text-ink-2 shadow-lift ring-1 ring-ink/[0.07]">
        Most teams shortlist <span className="rounded-md bg-coral-wash px-1.5 font-semibold text-coral">Brightlane</span>,{' '}
        <span className="rounded-md bg-cobalt px-1.5 font-semibold text-white">idraft</span> and <span className="rounded-md bg-amber-wash px-1.5 font-semibold text-ink">Gridwise</span>, because they pair daily rank checks with shareable reports.
      </div>
      <div className="dot-bounce flex w-fit items-center gap-1 rounded-full bg-surface px-3 py-2 shadow-lift ring-1 ring-ink/[0.07]" aria-hidden="true">
        <span className="size-1.5 rounded-full bg-ink-3" />
        <span className="size-1.5 rounded-full bg-ink-3" />
        <span className="size-1.5 rounded-full bg-ink-3" />
      </div>
    </div>
  );
}

const ORBIT = [
  { label: 'search daily', x: 18, y: 22, size: 'size-[4.5rem]', c: 'bg-violet text-white' },
  { label: 'agency review', x: 78, y: 18, size: 'size-16', c: 'bg-coral text-white' },
  { label: 'r/bigseo', x: 84, y: 66, size: 'size-14', c: 'bg-amber text-ink' },
  { label: 'seo weekly', x: 20, y: 74, size: 'size-16', c: 'bg-mint text-white' },
] as const;

/** Who an answer cites: your site in the middle, the domains around it, joined by fine lines. */
export function SourcesArt() {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-[inherit] bg-gradient-to-br from-amber-wash via-surface to-coral-wash">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 size-full">
        {ORBIT.map((node) => (
          <line key={node.label} x1="50" y1="46" x2={node.x} y2={node.y} stroke="#14171C" strokeOpacity="0.14" strokeWidth="0.5" strokeDasharray="1.5 1.5" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {ORBIT.map((node, index) => (
        <div key={node.label} style={{ left: `${node.x}%`, top: `${node.y}%` }} className={`absolute -translate-x-1/2 -translate-y-1/2 ${index % 2 ? 'float-a' : 'float-b'}`}>
          <div className={`grid ${node.size} place-items-center rounded-full p-2 text-center text-[10px] leading-tight font-semibold shadow-lift ring-4 ring-white/80 ${node.c}`}>{node.label}</div>
        </div>
      ))}
      <div className="absolute top-[46%] left-1/2 grid size-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-cobalt text-lg font-semibold text-white shadow-[0_24px_50px_-16px_rgb(30_101_227/0.8)] ring-8 ring-white/70">idraft</div>
    </div>
  );
}

/** A trend that holds a gap: the line stops where a check was missed and starts again. */
export function HistoryArt() {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-[inherit] bg-gradient-to-br from-wash via-surface to-violet-wash">
      <svg viewBox="0 0 360 140" role="img" aria-label="A trend line with a labeled gap where a check was missed." className="absolute inset-x-0 top-6 h-auto w-full px-4">
        <defs>
          <linearGradient id="hist-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#7C5CFF" stopOpacity="0.28" />
            <stop offset="1" stopColor="#7C5CFF" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M6 112 L44 100 L82 106 L120 78 L158 84 L184 56 L184 140 L6 140 Z" fill="url(#hist-fill)" />
        <path d="M6 112 L44 100 L82 106 L120 78 L158 84 L184 56" fill="none" stroke="#1E65E3" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M184 56 L232 52" fill="none" stroke="#FF6B4A" strokeWidth="2.5" strokeDasharray="2 7" strokeLinecap="round" />
        <path d="M232 52 L270 40 L308 46 L346 22" fill="none" stroke="#1E65E3" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="346" cy="22" r="6" fill="#1E65E3" />
        <circle cx="346" cy="22" r="12" fill="#1E65E3" opacity="0.15" />
        <rect x="190" y="68" width="76" height="22" rx="11" fill="#FFECE6" />
        <text x="228" y="83" textAnchor="middle" className="fill-coral font-mono text-[11px]">
          no check
        </text>
      </svg>
    </div>
  );
}

function Skeleton({ w }: { w: string }) {
  return <span className="block h-2 rounded-full bg-ink/10" style={{ width: w }} />;
}

/** Google's AI Overview: a summary card with a spark, text lines and the sources it links to. */
export function OverviewArt() {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[inherit] bg-gradient-to-br from-amber-wash via-surface to-amber-wash p-5">
      <div className="float-a w-full max-w-[17rem] rounded-2xl bg-surface p-4 shadow-lift ring-1 ring-ink/[0.07]">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-full bg-amber text-ink">
            <Sparkle size={13} weight="fill" aria-hidden="true" />
          </span>
          <span className="text-[12px] font-semibold">AI Overview</span>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <Skeleton w="96%" />
          <Skeleton w="88%" />
          <Skeleton w="62%" />
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {['idraft.ai', 'searchdaily', 'seoweekly'].map((name, index) => (
            <span key={name} className="flex items-center gap-1 rounded-full bg-paper px-2 py-1 text-[10px] font-medium ring-1 ring-ink/10">
              <span className={`size-2.5 rounded-full ${['bg-cobalt', 'bg-violet', 'bg-mint'][index]}`} />
              {name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Google's AI Mode: a short thread with a follow-up and its own cited source. */
export function ModeArt() {
  return (
    <div className="relative flex h-full w-full flex-col justify-center gap-2.5 overflow-hidden rounded-[inherit] bg-gradient-to-br from-violet-wash via-surface to-violet-wash p-5">
      <div className="ml-auto rounded-2xl rounded-br-md bg-violet px-3.5 py-2 text-[12px] font-medium text-white">What about for agencies?</div>
      <div className="float-b rounded-2xl rounded-bl-md bg-surface px-3.5 py-3 text-[12px] leading-snug shadow-lift ring-1 ring-ink/[0.07]">
        <div className="flex flex-col gap-1.5">
          <Skeleton w="94%" />
          <Skeleton w="70%" />
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-[10px] font-medium text-ink-2">
          <span className="grid size-4 place-items-center rounded-full bg-cobalt text-[8px] text-white">1</span>
          idraft.ai
          <span className="grid size-4 place-items-center rounded-full bg-violet text-[8px] text-white">2</span>
          reviews
        </div>
      </div>
    </div>
  );
}

/** ChatGPT: a short ranked list of brands, with the one you track marked. */
export function ChatGptArt() {
  const rows = [
    { name: 'Brightlane', tone: 'bg-surface text-ink', n: 1 },
    { name: 'idraft', tone: 'bg-cobalt text-white', n: 2 },
    { name: 'Gridwise', tone: 'bg-surface text-ink', n: 3 },
  ];
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-[inherit] bg-gradient-to-br from-mint-wash via-surface to-mint-wash p-5">
      <div className="mb-1 flex items-center gap-2 self-start text-[11px] font-semibold text-ink-2">
        <Image src="/logos/openai.svg" alt="" width={86} height={24} unoptimized className="h-4 w-auto opacity-80" />
        recommends
      </div>
      {rows.map((row, index) => (
        <motion.div
          key={row.name}
          initial={{ opacity: 0, x: 24 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.6, delay: index * 0.12, ease: EASE }}
          className={`flex w-full max-w-[16rem] items-center gap-3 rounded-xl px-3 py-2.5 shadow-lift ring-1 ring-ink/[0.07] ${row.tone}`}
        >
          <span className={`grid size-6 place-items-center rounded-full font-mono text-[11px] font-semibold ${row.tone.includes('cobalt') ? 'bg-white/20' : 'bg-mint-wash text-mint'}`}>{row.n}</span>
          <span className="text-[13px] font-semibold">{row.name}</span>
          {row.tone.includes('cobalt') ? <Check size={14} weight="bold" aria-hidden="true" className="ml-auto" /> : null}
        </motion.div>
      ))}
    </div>
  );
}

/** Gemini: a big spark with numbered citations hanging off it. */
export function GeminiArt() {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[inherit] bg-gradient-to-br from-wash via-surface to-coral-wash p-5">
      <svg viewBox="0 0 100 100" aria-hidden="true" className="float-a size-36">
        <defs>
          <linearGradient id="gem" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#1E65E3" />
            <stop offset="0.55" stopColor="#7C5CFF" />
            <stop offset="1" stopColor="#FF6B4A" />
          </linearGradient>
        </defs>
        <path d="M50 4 C54 32 68 46 96 50 C68 54 54 68 50 96 C46 68 32 54 4 50 C32 46 46 32 50 4 Z" fill="url(#gem)" />
      </svg>
      {[
        { n: 1, c: 'bg-cobalt', pos: 'top-[18%] right-[16%]' },
        { n: 2, c: 'bg-violet', pos: 'bottom-[20%] right-[22%]' },
        { n: 3, c: 'bg-coral', pos: 'bottom-[24%] left-[18%]' },
      ].map((chip) => (
        <span key={chip.n} className={`absolute grid size-7 place-items-center rounded-full font-mono text-[11px] font-semibold text-white shadow-lift ring-4 ring-white/80 ${chip.c} ${chip.pos}`}>
          {chip.n}
        </span>
      ))}
    </div>
  );
}
