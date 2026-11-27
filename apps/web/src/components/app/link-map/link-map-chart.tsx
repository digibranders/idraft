'use client';

import { GraphChart } from 'echarts/charts';
import { ThumbnailComponent, TooltipComponent } from 'echarts/components';
import { init, use as registerModules, type ECharts } from 'echarts/core';
import { LabelLayout } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useImperativeHandle, useRef, type ReactElement, type Ref } from 'react';

import { readChartTokens, type ChartTokens } from '@/lib/design/read-tokens';
import { HEADER_PREFIX, MAP_ZOOM, type MapView } from '@/lib/internal-links/map-option';

// Only what the map draws; the category charts register theirs in `chart/echart.tsx`
registerModules([GraphChart, TooltipComponent, ThumbnailComponent, LabelLayout, CanvasRenderer]);

export interface MapFrame {
  tokens: ChartTokens;
  width: number;
  height: number;
  view: MapView;
}

export interface LinkMapChartHandle {
  zoomBy: (factor: number) => void;
  fit: () => void;
  show: (view: MapView) => void;
}

export interface LinkMapChartProps {
  /** The option for the canvas as it is now. A new function repaints. */
  build: (frame: MapFrame) => Record<string, unknown>;
  /** What the map shows, for a reader who cannot see it. */
  label: string;
  /** A page was clicked (its id), or the background (null). */
  onSelect: (id: string | null) => void;
  /** A page was dragged to a new place, in layout units. */
  onMoved: (id: string, position: readonly [number, number]) => void;
  /** The view after a zoom or a pan, and after the handle changed it. */
  onView: (view: MapView) => void;
  /** Zooms at which the picture changes by itself: a roam across one repaints. */
  repaintAt: readonly number[];
  ref?: Ref<LinkMapChartHandle>;
}

/** Farther than this between press and release is a drag, not a click. */
const CLICK_SLOP = 4;
/** A dragged page that ended closer than this to where it started has not moved. */
const MOVE_SLOP = 0.01;

interface PointerEvent2d {
  offsetX: number;
  offsetY: number;
  target?: unknown;
}

interface ElementParams {
  dataType?: string;
  name?: unknown;
  event?: PointerEvent2d;
}

/** The one untyped ECharts call: the laid out position of a node, in layout units. */
interface NodeData {
  indexOfName: (name: string) => number;
  getItemLayout: (index: number) => [number, number];
}
const nodeData = (instance: ECharts): NodeData =>
  (instance as unknown as { getModel: () => { getSeriesByIndex: (index: number) => { getData: () => NodeData } } })
    .getModel()
    .getSeriesByIndex(0)
    .getData();

/**
 * The canvas of the Link map (plan 11, task 7): an ECharts graph that follows its size and the theme, keeps the
 * view the reader chose across repaints, and tells a click from a drag. It knows nothing of pages or tiers: the
 * option comes from `build`.
 */
export function LinkMapChart({
  build,
  label,
  onSelect,
  onMoved,
  onView,
  repaintAt,
  ref,
}: LinkMapChartProps): ReactElement {
  const element = useRef<HTMLDivElement>(null);
  const view = useRef<MapView>({ zoom: 1, center: null });
  const paintRef = useRef<(() => void) | null>(null);
  // The latest props, for handlers bound once
  const latest = useRef({ build, onSelect, onMoved, onView, repaintAt });
  useEffect(() => {
    latest.current = { build, onSelect, onMoved, onView, repaintAt };
  });

  useEffect(() => {
    const node = element.current;
    if (node === null) return undefined;
    const instance = init(node, null, { renderer: 'canvas' });
    // The series is replaced whole, so a view without a centre is the fitted one; the tooltip is kept, because a
    // repaint under the pointer with `notMerge` throws when a delayed tooltip then shows
    const paint = (): void => {
      instance.setOption(
        latest.current.build({
          tokens: readChartTokens(),
          width: instance.getWidth(),
          height: instance.getHeight(),
          view: view.current,
        }),
        { replaceMerge: ['series'] },
      );
    };
    paintRef.current = paint;
    const zr = instance.getZr();
    let pressed: readonly [number, number] | null = null;
    let held: { id: string; from: readonly [number, number] } | null = null;
    const still = (event: PointerEvent2d): boolean =>
      pressed !== null && Math.hypot(event.offsetX - pressed[0], event.offsetY - pressed[1]) <= CLICK_SLOP;

    zr.on('mousedown', (event: PointerEvent2d) => {
      pressed = [event.offsetX, event.offsetY];
    });
    instance.on('mousedown', (params: ElementParams) => {
      const name = String(params.name ?? '');
      if (params.dataType !== 'node' || name.startsWith(HEADER_PREFIX)) {
        held = null;
        return;
      }
      const data = nodeData(instance);
      held = { id: name, from: data.getItemLayout(data.indexOfName(name)) };
    });
    // On the canvas, not the dot: a fast drag is released beside the dot it moves
    zr.on('mouseup', () => {
      if (held === null) return;
      const { id, from } = held;
      held = null;
      const data = nodeData(instance);
      const [x, y] = data.getItemLayout(data.indexOfName(id));
      if (Math.hypot(x - from[0], y - from[1]) > MOVE_SLOP) latest.current.onMoved(id, [x, y]);
    });
    // A drag ends in a click too: only a press and release on the same spot selects
    instance.on('click', (params: ElementParams) => {
      const name = String(params.name ?? '');
      if (params.dataType !== 'node' || name.startsWith(HEADER_PREFIX) || params.event === undefined) return;
      if (still(params.event)) latest.current.onSelect(name);
    });
    // A click on the background lets the selected page go
    zr.on('click', (event: PointerEvent2d) => {
      if (event.target === undefined && still(event)) latest.current.onSelect(null);
    });
    instance.on('graphroam', () => {
      const series = (instance.getOption() as { series?: { zoom: number; center?: [number, number] }[] }).series?.[0];
      if (series === undefined) return;
      const before = view.current.zoom;
      view.current = { zoom: series.zoom, center: series.center ?? null };
      latest.current.onView(view.current);
      // The minimap and the names in the block come and go with the zoom
      if (latest.current.repaintAt.some((mark) => before < mark !== series.zoom < mark)) paint();
    });

    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            instance.resize();
            paint();
          });
    resize?.observe(node);
    // The colours are read from the theme: a theme switch repaints
    const theme = new MutationObserver(paint);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    return () => {
      resize?.disconnect();
      theme.disconnect();
      instance.dispose();
      paintRef.current = null;
    };
  }, []);

  useEffect(() => {
    paintRef.current?.();
  }, [build]);

  useImperativeHandle(ref, () => {
    const show = (next: MapView): void => {
      view.current = { zoom: Math.min(MAP_ZOOM.max, Math.max(MAP_ZOOM.min, next.zoom)), center: next.center };
      latest.current.onView(view.current);
      paintRef.current?.();
    };
    return {
      zoomBy: (factor) => show({ ...view.current, zoom: view.current.zoom * factor }),
      fit: () => show({ zoom: 1, center: null }),
      show,
    };
  }, []);

  return <div ref={element} role="img" aria-label={label} className="absolute inset-0" />;
}
