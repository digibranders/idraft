'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const TOKEN = 56;

/**
 * "The climb": one ribbon is drawn behind the whole page as you scroll, and a glass rank token rides its tip,
 * counting down from #14 to #1. The path is built from the elements marked data-stop, which alternate sides,
 * so it wanders around the content the way the page does. Storytelling: the reader is the keyword being climbed.
 * Everything is written straight to the DOM on scroll (no React renders). Desktop only, and off under reduced motion.
 */
export function ClimbStage({ children }: { children: React.ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const ribbon = useRef<SVGPathElement>(null);
  const core = useRef<SVGPathElement>(null);
  const token = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = wrap.current;
    const svgEl = svg.current;
    const ribbonEl = ribbon.current;
    const coreEl = core.current;
    const tokenEl = token.current;
    const labelEl = label.current;
    if (!root || !svgEl || !ribbonEl || !coreEl || !tokenEl || !labelEl) return;

    const mm = gsap.matchMedia();
    mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
      let trigger: ScrollTrigger | undefined;

      const build = () => {
        const rect = root.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
        svgEl.setAttribute('height', String(h));

        const stops = Array.from(root.querySelectorAll<HTMLElement>('[data-stop]')).map((el, index) => {
          const r = el.getBoundingClientRect();
          const side = el.dataset.stop === 'left' ? 0.1 : el.dataset.stop === 'right' ? 0.9 : 0.5;
          return { x: w * side, y: r.top - rect.top + r.height / 2, index };
        });
        const points = [{ x: w * 0.5, y: 120 }, ...stops, { x: w * 0.5, y: h - 240 }];

        // Smooth S-curves between stops: leave and arrive vertically, so the ribbon reads as one flowing line.
        let d = `M ${points[0]?.x ?? 0} ${points[0]?.y ?? 0}`;
        for (let i = 1; i < points.length; i += 1) {
          const a = points[i - 1];
          const b = points[i];
          if (!a || !b) continue;
          const mid = (a.y + b.y) / 2;
          d += ` C ${a.x} ${mid}, ${b.x} ${mid}, ${b.x} ${b.y}`;
        }
        ribbonEl.setAttribute('d', d);
        coreEl.setAttribute('d', d);
        const length = ribbonEl.getTotalLength();
        [ribbonEl, coreEl].forEach((p) => {
          p.style.strokeDasharray = `${length}`;
        });

        trigger?.kill();
        trigger = ScrollTrigger.create({
          trigger: root,
          start: 'top 55%',
          end: 'bottom 55%',
          scrub: 0.5,
          onUpdate: (self) => {
            const drawn = self.progress * length;
            [ribbonEl, coreEl].forEach((p) => {
              p.style.strokeDashoffset = `${length - drawn}`;
            });
            const tip = ribbonEl.getPointAtLength(drawn);
            tokenEl.style.transform = `translate3d(${tip.x - TOKEN / 2}px, ${tip.y - TOKEN / 2}px, 0)`;
            labelEl.textContent = `#${Math.max(1, Math.round(14 - 13 * self.progress))}`;
          },
        });
        trigger.update();
      };

      build();
      const observer = new ResizeObserver(() => {
        build();
        ScrollTrigger.refresh();
      });
      observer.observe(root);
      return () => {
        observer.disconnect();
        trigger?.kill();
      };
    }, root);

    return () => mm.revert();
  }, []);

  return (
    <div ref={wrap} className="relative">
      <svg ref={svg} aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-0 hidden w-full lg:block" preserveAspectRatio="none">
        <path ref={ribbon} fill="none" stroke="#1E65E3" strokeOpacity="0.07" strokeWidth="46" strokeLinecap="round" />
        <path ref={core} fill="none" stroke="#1E65E3" strokeOpacity="0.45" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div
        ref={token}
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 z-20 hidden size-14 place-items-center rounded-full bg-cobalt/90 text-white shadow-[0_16px_40px_-12px_rgb(30_101_227/0.8)] ring-4 ring-white/70 backdrop-blur lg:grid"
        style={{ transform: 'translate3d(-100px, -100px, 0)' }}
      >
        <span ref={label} className="font-mono text-[13px] font-medium tracking-[-0.03em]">
          #14
        </span>
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}
