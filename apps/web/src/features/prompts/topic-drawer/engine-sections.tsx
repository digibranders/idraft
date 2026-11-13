'use client';

import type { ReactElement } from 'react';

import { EnginePanel } from './engine-panel';
import { EngineTrend } from './engine-trend';
import { InSearch } from './in-search';
import { RivalsTrend } from './rivals-trend';

/**
 * The engine sections of the topic drawer's Overview, in order: By engine (the panel and the comparison sentence), Trend
 * by engine, the Visibility trend against competitors and In search. Each is its own component with its own states, so one
 * failing read never blanks the other and a later layout package can register them one by one. It reads the drawer's
 * context: mount it inside a `TopicDrawerProvider`.
 */
export function TopicEngineSections(): ReactElement {
  return (
    <>
      <EnginePanel />
      <EngineTrend />
      <RivalsTrend />
      <InSearch />
    </>
  );
}
