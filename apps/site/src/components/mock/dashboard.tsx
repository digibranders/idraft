'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { AiView } from './ai-view';
import { AppFrame, type MockView } from './app-frame';
import { MatrixView } from './matrix-view';
import { RankingsView } from './rankings-view';
import { SourcesView } from './sources-view';

type DashboardProps = {
  initial?: MockView;
  /** Lock the mock to one view, without the sidebar. For embeds next to a page's own copy. */
  only?: MockView;
  /** Drive the view from outside (the product tour). Sidebar clicks are reported to `onViewChange`. */
  view?: MockView;
  onViewChange?: (view: MockView) => void;
  /** Tailwind height classes for the app area. */
  heightClass?: string;
  className?: string;
};

function View({ view, compact }: { view: MockView; compact: boolean }) {
  switch (view) {
    case 'keywords':
      return <RankingsView compact={compact} />;
    case 'ai':
      return <AiView compact={compact} />;
    case 'matrix':
      return <MatrixView />;
    case 'sources':
      return <SourcesView />;
  }
}

/**
 * The product, in the page. The four entries in the sidebar that open a view really do: Keywords, Topics and
 * Prompts, Matrix and Sources. Everything is illustrative data, and each view says so.
 */
export function Dashboard({ initial = 'keywords', only, view, onViewChange, heightClass = 'h-[31rem] sm:h-[33rem] lg:h-[36rem]', className = '' }: DashboardProps) {
  const [inner, setInner] = useState<MockView>(initial);
  const current = only ?? view ?? inner;
  const compact = Boolean(only);
  const navigate = onViewChange ?? setInner;
  return (
    <div className={`overflow-hidden rounded-[1.25rem] bg-paper shadow-[0_50px_100px_-40px_rgb(20_23_28/0.35),0_30px_60px_-30px_rgb(30_101_227/0.25)] ring-1 ring-ink/10 ${className}`}>
      <div className="flex items-center gap-1.5 border-b border-line bg-surface px-4 py-2.5" aria-hidden="true">
        <span className="size-2.5 rounded-full bg-ink/15" />
        <span className="size-2.5 rounded-full bg-ink/15" />
        <span className="size-2.5 rounded-full bg-ink/15" />
        <span className="mx-auto rounded-md bg-paper px-12 py-0.5 font-mono text-[11px] text-ink-3">app.idraft.ai</span>
      </div>
      <div className={heightClass}>
        <AppFrame view={current} {...(only ? {} : { onNavigate: navigate })} compact={compact}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={current} className="h-full" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}>
              <View view={current} compact={compact} />
            </motion.div>
          </AnimatePresence>
        </AppFrame>
      </div>
    </div>
  );
}
