'use client';

import type { ReactElement } from 'react';

import { EnginePanel } from './engine-panel';
import { EngineTrend } from './engine-trend';

/**
 * The engine sections of the topic drawer's Overview, in order: By engine (the panel and the comparison sentence) and Trend
 * by engine. Each is its own component with its own states, so one failing read never blanks the other and a later layout
 * package can register them one by one. Tasks 5 and 6 add the competitors trend and In search here. It reads the drawer's
 * context: mount it inside a `TopicDrawerProvider`.
 */
export function TopicEngineSections(): ReactElement {
  return (
    <>
      <EnginePanel />
      <EngineTrend />
    </>
  );
}
