import { layoutMap, type LayoutInput } from './map-layout';

/** Lays the Link map out off the main thread: one message in, one answer out. */
self.addEventListener('message', (event: MessageEvent<LayoutInput>) => {
  self.postMessage(layoutMap(event.data));
});
