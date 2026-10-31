'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/*
 * "Day one": a small character, Idri, lives in the page and climbs the rank ladder as you scroll, the way the
 * hen does in the reference reel. Four scenes, one object that persists, a background that changes color per
 * scene. The character wears the brand's three bars as its hair.
 *
 * The markup is the finished scene (top step, cheering, confetti), so small screens and reduced motion get a
 * clear still picture with all four captions. On desktop the timeline sets the starting scene and scrubs forward.
 */

const STEPS = [
  { cx: 120, top: 480, color: '#7C5CFF' },
  { cx: 260, top: 410, color: '#FF6B4A' },
  { cx: 400, top: 340, color: '#FFB020' },
  { cx: 540, top: 270, color: '#18B57F' },
  { cx: 680, top: 200, color: '#1E65E3' },
] as const;

const CONFETTI = [
  { x: 610, y: 90, c: '#FF6B4A', r: 20 },
  { x: 650, y: 60, c: '#FFB020', r: -35 },
  { x: 700, y: 70, c: '#7C5CFF', r: 40 },
  { x: 750, y: 100, c: '#18B57F', r: -20 },
  { x: 790, y: 150, c: '#FF6B4A', r: 55 },
  { x: 590, y: 140, c: '#18B57F', r: -50 },
  { x: 560, y: 90, c: '#7C5CFF', r: 15 },
  { x: 820, y: 80, c: '#FFB020', r: -30 },
  { x: 680, y: 30, c: '#1E65E3', r: 25 },
  { x: 730, y: 40, c: '#FF6B4A', r: -60 },
  { x: 620, y: 40, c: '#18B57F', r: 45 },
  { x: 780, y: 200, c: '#7C5CFF', r: -15 },
] as const;

const CAPTIONS = [
  { title: 'Day one. You are #14.', body: 'Page two of the results, and nobody has checked what AI says about you.' },
  { title: 'Check every day.', body: 'Rankings are collected daily, so every step up is on the record.' },
  { title: 'Then ask the AI.', body: 'ChatGPT, Gemini and Google AI answer your topics. idraft reads who gets named, and who gets cited.' },
  { title: 'Climb. Get named.', body: 'Rank and answer side by side, so you can see what moved you up.' },
] as const;

// Rank at each moment of the timeline: [time, rank]. The counter matches the step the character stands on.
const RANK_AT: readonly [number, number][] = [
  [0, 14],
  [0.95, 14],
  [1.25, 11],
  [1.4, 11],
  [1.7, 8],
  [3.05, 8],
  [3.35, 5],
  [3.45, 5],
  [3.75, 1],
  [4, 1],
];

function rankAtTime(t: number): number {
  for (let i = 1; i < RANK_AT.length; i += 1) {
    const a = RANK_AT[i - 1];
    const b = RANK_AT[i];
    if (a && b && t <= b[0]) return Math.round(gsap.utils.interpolate(a[1], b[1], (t - a[0]) / (b[0] - a[0] || 1)));
  }
  return 1;
}

function Idri() {
  return (
    <g data-mascot style={{ transform: `translate(${STEPS[4].cx}px, ${STEPS[4].top}px)` }}>
      <ellipse cx="0" cy="2" rx="46" ry="7" fill="#14171C" opacity="0.12" />
      <g data-body>
        <ellipse cx="-24" cy="-2" rx="17" ry="8" fill="#174AB0" />
        <ellipse cx="24" cy="-2" rx="17" ry="8" fill="#174AB0" />
        {/* The brand's three bars, as hair. */}
        <rect x="-18" y="-114" width="9" height="14" rx="4" fill="#174AB0" />
        <rect x="-4" y="-122" width="9" height="22" rx="4" fill="#174AB0" />
        <rect x="10" y="-132" width="9" height="32" rx="4" fill="#174AB0" />
        <rect x="-50" y="-100" width="100" height="100" rx="34" fill="url(#idri-body)" />
        <ellipse cx="-22" cy="-82" rx="22" ry="10" fill="#fff" opacity="0.22" />
        <circle cx="-18" cy="-58" r="14" fill="#fff" />
        <circle cx="18" cy="-58" r="14" fill="#fff" />
        <g data-pupils>
          <circle cx="-18" cy="-58" r="6.5" fill="#14171C" />
          <circle cx="18" cy="-58" r="6.5" fill="#14171C" />
        </g>
        <g data-smile opacity="0">
          <path d="M-14 -30 Q0 -18 14 -30" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" />
        </g>
        <g data-cheer>
          <ellipse cx="0" cy="-27" rx="12" ry="9" fill="#0F2D6B" />
          <ellipse cx="0" cy="-23" rx="7" ry="4" fill="#FF6B4A" />
        </g>
        <circle cx="-34" cy="-38" r="6" fill="#FF6B4A" opacity="0.45" />
        <circle cx="34" cy="-38" r="6" fill="#FF6B4A" opacity="0.45" />
        <g data-lens opacity="0">
          <circle cx="58" cy="-52" r="24" fill="#fff" fillOpacity="0.35" stroke="#14171C" strokeWidth="5" />
          <line x1="76" y1="-34" x2="96" y2="-12" stroke="#14171C" strokeWidth="7" strokeLinecap="round" />
        </g>
      </g>
    </g>
  );
}

export function Journey() {
  const section = useRef<HTMLElement>(null);

  useEffect(() => {
    const scope = section.current;
    if (!scope) return;
    const q = <T extends Element>(selector: string) => scope.querySelector<T>(selector);
    const all = (selector: string) => Array.from(scope.querySelectorAll<SVGElement>(selector));

    const mm = gsap.matchMedia();
    mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
      const bg = q<HTMLElement>('[data-bg]');
      const mascot = q<SVGGElement>('[data-mascot]');
      const body = q<SVGGElement>('[data-body]');
      const pupils = q<SVGGElement>('[data-pupils]');
      const smile = q<SVGGElement>('[data-smile]');
      const cheer = q<SVGGElement>('[data-cheer]');
      const lens = q<SVGGElement>('[data-lens]');
      const counter = q<HTMLElement>('[data-counter]');
      const bubbles = all('[data-bubble]');
      const flag = q<SVGGElement>('[data-flag]');
      const confetti = all('[data-confetti] rect');
      const steps = all('[data-step]');
      const captions = all('[data-caption]');
      if (!bg || !mascot || !body || !pupils || !smile || !cheer || !lens || !counter || !flag || steps.length !== 5 || captions.length !== 4) return;

      // Starting scene.
      gsap.set(mascot, { x: STEPS[0].cx, y: STEPS[0].top });
      gsap.set(bg, { backgroundColor: '#F7F8FA' });
      gsap.set(cheer, { opacity: 0 });
      gsap.set(smile, { opacity: 1 });
      gsap.set(bubbles, { opacity: 0, y: 24, scale: 0.9, transformOrigin: '50% 100%' });
      gsap.set(flag, { opacity: 0, y: 20 });
      gsap.set(confetti, { opacity: 0, y: -40 });
      gsap.set(pupils, { x: 5 });
      counter.textContent = '#14';
      gsap.set(captions.slice(1), { opacity: 0, y: 30 });
      gsap.set(captions[0] ?? [], { opacity: 1, y: 0 });
      // The steps rise as the character reaches them: only the first is up at the start.
      steps.forEach((step, i) => gsap.set(step, { scaleY: i === 0 ? 1 : 0.0001, transformOrigin: '50% 100%' }));

      // The timeline is driven by a proxy so the first scene is short: scrolling starts at 0.55s, just before
      // the first caption change, and the pin is about 2800px instead of 4200px.
      const timeline = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
      const START_AT = 0.55;
      const proxy = { t: START_AT };
      gsap.to(proxy, {
        t: 4,
        ease: 'none',
        scrollTrigger: { trigger: scope, start: 'top top', end: '+=2800', pin: true, scrub: 0.6, anticipatePin: 1 },
        onUpdate: () => {
          timeline.time(proxy.t);
          counter.textContent = `#${rankAtTime(proxy.t)}`;
        },
      });

      // A hop: the step rises just before the jump, x travels, y arcs up and lands.
      const hop = (from: number, to: number, at: number, d: number) => {
        const a = STEPS[from];
        const b = STEPS[to];
        const step = steps[to];
        if (!a || !b || !step) return;
        timeline.to(step, { scaleY: 1, duration: d * 0.8, ease: 'back.out(1.6)' }, at - d * 0.9);
        timeline.to(mascot, { x: b.cx, duration: d, ease: 'power1.inOut' }, at);
        timeline.to(mascot, { y: Math.min(a.top, b.top) - 70, duration: d * 0.5, ease: 'power2.out' }, at);
        timeline.to(mascot, { y: b.top, duration: d * 0.5, ease: 'power2.in' }, at + d * 0.5);
        timeline.to(body, { scaleY: 1.08, scaleX: 0.94, transformOrigin: '50% 100%', duration: d * 0.2, yoyo: true, repeat: 1 }, at + d * 0.9);
      };

      // Scene 1 to 2: first hops.
      timeline.to(captions[0] ?? [], { opacity: 0, y: -30, duration: 0.25 }, 0.7);
      timeline.to(bg, { backgroundColor: '#EAF1FE', duration: 0.5 }, 0.7);
      timeline.to(captions[1] ?? [], { opacity: 1, y: 0, duration: 0.3 }, 0.85);
      timeline.to(pupils, { x: 6, duration: 0.2 }, 0.8);
      hop(0, 1, 0.95, 0.3);
      hop(1, 2, 1.4, 0.3);

      // Scene 3: look at the answers.
      timeline.to(captions[1] ?? [], { opacity: 0, y: -30, duration: 0.25 }, 1.9);
      timeline.to(bg, { backgroundColor: '#EFEAFF', duration: 0.5 }, 1.9);
      timeline.to(captions[2] ?? [], { opacity: 1, y: 0, duration: 0.3 }, 2.05);
      timeline.to(pupils, { x: 6, y: -5, duration: 0.2 }, 2.0);
      timeline.to(lens, { opacity: 1, duration: 0.2 }, 2.1);
      timeline.to(bubbles, { opacity: 1, y: 0, scale: 1, stagger: 0.22, duration: 0.35, ease: 'back.out(1.5)' }, 2.2);

      // Scene 4: climb to the top and cheer.
      timeline.to(captions[2] ?? [], { opacity: 0, y: -30, duration: 0.25 }, 2.95);
      timeline.to(bg, { backgroundColor: '#FFF3D6', duration: 0.5 }, 2.95);
      timeline.to(captions[3] ?? [], { opacity: 1, y: 0, duration: 0.3 }, 3.1);
      timeline.to(lens, { opacity: 0, duration: 0.15 }, 3.0);
      timeline.to(pupils, { x: 0, y: 0, duration: 0.2 }, 3.0);
      hop(2, 3, 3.05, 0.3);
      hop(3, 4, 3.45, 0.3);
      timeline.to(smile, { opacity: 0, duration: 0.05 }, 3.78);
      timeline.to(cheer, { opacity: 1, duration: 0.05 }, 3.78);
      timeline.to(flag, { opacity: 1, y: 0, duration: 0.2, ease: 'back.out(2)' }, 3.78);
      timeline.to(confetti, { opacity: 1, y: 0, stagger: 0.015, duration: 0.25, ease: 'power2.out' }, 3.82);
      timeline.to({}, { duration: 0.2 }, 4);
      timeline.time(START_AT);
    }, scope);

    return () => mm.revert();
  }, []);

  return (
    <section ref={section} aria-label="Climb from rank 14 to rank 1" className="relative overflow-hidden bg-amber-wash">
      <div data-bg className="bg-amber-wash lg:flex lg:min-h-[100dvh] lg:items-center">
        <div className="mx-auto grid w-full max-w-[1320px] items-center gap-10 px-5 py-20 md:px-8 lg:grid-cols-12 lg:gap-6 lg:py-14">
          <div className="relative lg:col-span-5 lg:h-[26rem]">
            {CAPTIONS.map((caption) => (
              <div key={caption.title} data-caption className="mb-8 lg:absolute lg:inset-x-0 lg:top-0 lg:mb-0">
                <h2 className="text-[clamp(2.2rem,4.2vw,3.8rem)] leading-[1.02] font-semibold tracking-[-0.05em] text-balance">{caption.title}</h2>
                <p className="mt-5 max-w-[40ch] text-lg leading-relaxed text-ink-2">{caption.body}</p>
              </div>
            ))}
            <p data-counter aria-hidden="true" className="font-mono text-[clamp(5rem,9vw,8rem)] leading-none font-semibold tracking-[-0.06em] text-cobalt lg:absolute lg:bottom-0 lg:left-0">
              #1
            </p>
          </div>

          <div className="lg:col-span-7">
            <svg viewBox="0 0 900 620" role="img" aria-label="A small blue character with three bars for hair climbs five colored steps, looks at answers from AI, and reaches the top step with a number one flag." className="h-auto w-full overflow-visible">
              <defs>
                <linearGradient id="idri-body" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0" stopColor="#4F8DF5" />
                  <stop offset="1" stopColor="#1E65E3" />
                </linearGradient>
              </defs>
              <line x1="20" y1="560" x2="880" y2="560" stroke="#14171C" strokeOpacity="0.15" strokeWidth="2" strokeLinecap="round" />
              {STEPS.map((step, i) => (
                <g key={step.color} data-step>
                  <rect x={step.cx - 60} y={step.top} width="120" height={560 - step.top} rx="20" fill={step.color} />
                  <rect x={step.cx - 60} y={step.top} width="120" height="26" rx="20" fill="#fff" opacity="0.22" />
                  <text x={step.cx} y={step.top + Math.min(76, 560 - step.top - 14)} textAnchor="middle" className="fill-white font-mono text-[34px] font-semibold" style={{ opacity: 0.9 }}>
                    {i === 4 ? '#1' : `#${14 - i * 3}`}
                  </text>
                </g>
              ))}

              <g data-flag>
                <line x1="748" y1="200" x2="748" y2="110" stroke="#14171C" strokeWidth="4" strokeLinecap="round" />
                <path d="M748 110 L820 124 L748 142 Z" fill="#1E65E3" />
              </g>

              <g data-bubbles>
                <g data-bubble>
                  <rect x="70" y="30" width="300" height="86" rx="22" fill="#fff" stroke="#14171C" strokeOpacity="0.08" />
                  <rect x="94" y="54" width="190" height="10" rx="5" fill="#14171C" opacity="0.12" />
                  <rect x="94" y="76" width="130" height="10" rx="5" fill="#14171C" opacity="0.12" />
                  <rect x="290" y="50" width="64" height="26" rx="13" fill="#1E65E3" />
                  <text x="322" y="68" textAnchor="middle" className="fill-white text-[13px] font-semibold">
                    idraft
                  </text>
                </g>
                <g data-bubble>
                  <rect x="150" y="136" width="310" height="86" rx="22" fill="#fff" stroke="#14171C" strokeOpacity="0.08" />
                  <rect x="174" y="160" width="170" height="10" rx="5" fill="#14171C" opacity="0.12" />
                  <rect x="174" y="182" width="110" height="10" rx="5" fill="#14171C" opacity="0.12" />
                  <rect x="360" y="154" width="76" height="26" rx="13" fill="#FF6B4A" />
                  <text x="398" y="172" textAnchor="middle" className="fill-white text-[13px] font-semibold">
                    Gridwise
                  </text>
                </g>
              </g>

              <g data-confetti>
                {CONFETTI.map((piece) => (
                  <rect key={`${piece.x}-${piece.y}`} x={piece.x} y={piece.y} width="12" height="18" rx="3" fill={piece.c} transform={`rotate(${piece.r} ${piece.x + 6} ${piece.y + 9})`} />
                ))}
              </g>

              <Idri />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
