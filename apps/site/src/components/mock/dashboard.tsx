'use client';

import { useState } from 'react';

import { AiView } from './ai-view';
import { AppFrame, type MockView } from './app-frame';
import { MatrixView } from './matrix-view';
import { RankingsView } from './rankings-view';
import { SourcesView } from './sources-view';

type DashboardProps = {
  initial?: MockView;
  /** Lock the mock to one view, without the sidebar. For embeds next to a page's own copy. */
  only?: MockView;
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
export function Dashboard({ initial = 'keywords', only, className = '' }: DashboardProps) {
  const [view, setView] = useState<MockView>(only ?? initial);
  const current = only ?? view;
  const compact = Boolean(only);
  return (
    <div className={`overflow-hidden rounded-[1.25rem] bg-paper shadow-[0_50px_100px_-40px_rgb(20_23_28/0.35),0_30px_60px_-30px_rgb(30_101_227/0.25)] ring-1 ring-ink/10 ${className}`}>
      <div className="flex items-center gap-1.5 border-b border-line bg-surface px-4 py-2.5" aria-hidden="true">
        <span className="size-2.5 rounded-full bg-ink/15" />
        <span className="size-2.5 rounded-full bg-ink/15" />
        <span className="size-2.5 rounded-full bg-ink/15" />
        <span className="mx-auto rounded-md bg-paper px-12 py-0.5 font-mono text-[11px] text-ink-3">app.idraft.ai</span>
      </div>
      <div className="h-[31rem] sm:h-[33rem] lg:h-[36rem]">
        <AppFrame view={current} {...(only ? {} : { onNavigate: setView })} compact={compact}>
          <View view={current} compact={compact} />
        </AppFrame>
      </div>
    </div>
  );
}
