'use client';

import type { ReactElement } from 'react';

import { EnginePanel } from './engine-panel';
import { EngineTrend } from './engine-trend';
import { RivalsTrend } from './rivals-trend';

/**
 * The engine sections of the topic drawer's Overview, in order: By engine (the panel and the comparison sentence), Trend
 * by engine and the Visibility trend against competitors. Each is its own component with its own states, so one failing
 * read never blanks the other and a later layout package can register them one by one. Task 6 adds In search here. It
 * reads the drawer's context: mount it inside a `TopicDrawerProvider`.
 */
export function TopicEngineSections(): ReactElement {
  return (
    <>
      <EnginePanel />
      <EngineTrend />
      <RivalsTrend />
    </>
  );
}
