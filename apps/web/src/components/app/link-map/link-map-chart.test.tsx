import { act, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LinkMapChart, type LinkMapChartHandle, type LinkMapChartProps, type MapFrame } from './link-map-chart';

type Handler = (event: unknown) => void;

/** A stand-in for an ECharts instance that records what it is given and lets a test fire its events. */
class FakeInstance {
  setOption = vi.fn();
  resize = vi.fn();
  dispose = vi.fn();
  zrHandlers = new Map<string, Handler>();
  handlers = new Map<string, Handler>();
  /** What `getOption().series[0]` answers after a roam. */
  series = { zoom: 1, center: undefined as [number, number] | undefined };
  /** The laid out position of each page, by name. */
  layout = new Map<string, [number, number]>([['7', [1, 2]]]);
  getWidth = (): number => 900;
  getHeight = (): number => 600;
  getZr = () => ({ on: (type: string, handler: Handler) => void this.zrHandlers.set(type, handler) });
  on = (type: string, handler: Handler): void => void this.handlers.set(type, handler);
  getOption = () => ({ series: [this.series] });
  getModel = () => ({
    getSeriesByIndex: () => ({
      getData: () => ({
        indexOfName: (name: string) => [...this.layout.keys()].indexOf(name),
        getItemLayout: (index: number) => [...this.layout.values()][index] ?? [0, 0],
      }),
    }),
  });
  fire(type: string, event: unknown): void {
    this.handlers.get(type)?.(event);
  }
  fireZr(type: string, event: unknown): void {
    this.zrHandlers.get(type)?.(event);
  }
}

const echarts = vi.hoisted(() => ({ init: vi.fn(), use: vi.fn() }));
vi.mock('echarts/core', () => echarts);
vi.mock('echarts/charts', () => ({ GraphChart: {} }));
vi.mock('echarts/components', () => ({ ThumbnailComponent: {}, TooltipComponent: {} }));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));

let instance: FakeInstance;

beforeEach(() => {
  instance = new FakeInstance();
  echarts.init.mockReset();
  echarts.init.mockImplementation(() => instance);
});

const frames = (build: { mock: { calls: [MapFrame][] } }): MapFrame[] => build.mock.calls.map(([frame]) => frame);

function setup() {
  const build = vi.fn<LinkMapChartProps['build']>((frame) => ({ frame }));
  const onSelect = vi.fn<LinkMapChartProps['onSelect']>();
  const onMoved = vi.fn<LinkMapChartProps['onMoved']>();
  const onView = vi.fn<LinkMapChartProps['onView']>();
  const props = { label: 'Map of internal links.', repaintAt: [1.05, 2], onSelect, onMoved, onView };
  const handle = createRef<LinkMapChartHandle>();
  const view = render(<LinkMapChart {...props} build={build} ref={handle} />);
  return { props, build, onSelect, onMoved, onView, handle, view };
}

/** A press and a release at one spot: what the browser does for a click. */
const press = (x: number, y: number): void => {
  instance.fireZr('mousedown', { offsetX: x, offsetY: y });
};

describe('LinkMapChart', () => {
  it('paints the option the builder gives for its size and view', () => {
    const { build } = setup();

    expect(screen.getByRole('img', { name: 'Map of internal links.' })).toBeInTheDocument();
    expect(frames(build)[0]).toMatchObject({ width: 900, height: 600, view: { zoom: 1, center: null } });
    expect(instance.setOption).toHaveBeenCalledTimes(1);
    // The series is replaced, not the whole option, so a tooltip about to show survives the repaint
    expect(instance.setOption).toHaveBeenCalledWith(expect.anything(), { replaceMerge: ['series'] });
  });

  it('repaints when the builder changes', () => {
    const { view, build, props } = setup();
    const next = vi.fn(() => ({}));

    view.rerender(<LinkMapChart {...props} build={next} />);

    expect(build).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(instance.setOption).toHaveBeenCalledTimes(2);
  });

  it('reports a click on a page, and nothing for a header node', () => {
    const { onSelect } = setup();
    press(10, 10);

    instance.fire('click', { dataType: 'node', name: '7', event: { offsetX: 10, offsetY: 10 } });
    instance.fire('click', { dataType: 'node', name: 'h:title', event: { offsetX: 10, offsetY: 10 } });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('7');
  });

  it('does not select when the pointer moved between press and release', () => {
    const { onSelect } = setup();
    press(10, 10);

    instance.fire('click', { dataType: 'node', name: '7', event: { offsetX: 30, offsetY: 30 } });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('reports a click on the background as letting go', () => {
    const { onSelect } = setup();
    press(40, 40);

    // A click on a mark has a target; only the bare background has none
    instance.fireZr('click', { offsetX: 40, offsetY: 40, target: {} });
    expect(onSelect).not.toHaveBeenCalled();
    instance.fireZr('click', { offsetX: 41, offsetY: 40 });
    expect(onSelect).toHaveBeenCalledWith(null);

    onSelect.mockClear();
    press(40, 40);
    instance.fireZr('click', { offsetX: 90, offsetY: 90 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('saves a dragged page on release, wherever the pointer is, and not a page that did not move', () => {
    const { onMoved } = setup();

    instance.fire('mousedown', { dataType: 'node', name: '7' });
    instance.layout.set('7', [5, 6]);
    instance.fireZr('mouseup', {});
    expect(onMoved).toHaveBeenCalledWith('7', [5, 6]);

    onMoved.mockClear();
    instance.fire('mousedown', { dataType: 'node', name: '7' });
    instance.fireZr('mouseup', {});
    expect(onMoved).not.toHaveBeenCalled();

    // A header node and the background are not dragged pages
    instance.fire('mousedown', { dataType: 'node', name: 'h:title' });
    instance.layout.set('7', [8, 9]);
    instance.fireZr('mouseup', {});
    expect(onMoved).not.toHaveBeenCalled();
  });

  it('keeps the view after a roam and repaints when the zoom crosses a mark', () => {
    const { onView, build } = setup();

    instance.series = { zoom: 1.02, center: [3, 4] };
    act(() => instance.fire('graphroam', {}));
    expect(onView).toHaveBeenLastCalledWith({ zoom: 1.02, center: [3, 4] });
    // 1 to 1.02 crosses nothing
    expect(instance.setOption).toHaveBeenCalledTimes(1);

    instance.series = { zoom: 2.1, center: [3, 4] };
    act(() => instance.fire('graphroam', {}));
    expect(onView).toHaveBeenLastCalledWith({ zoom: 2.1, center: [3, 4] });
    expect(instance.setOption).toHaveBeenCalledTimes(2);
    // The repaint draws the view the reader chose
    expect(frames(build).at(-1)?.view).toEqual({ zoom: 2.1, center: [3, 4] });
  });

  it('zooms, fits and shows a view through its handle', () => {
    const { handle, build, onView } = setup();

    act(() => handle.current?.zoomBy(1.4));
    expect(frames(build).at(-1)?.view).toEqual({ zoom: 1.4, center: null });
    expect(onView).toHaveBeenLastCalledWith({ zoom: 1.4, center: null });

    act(() => handle.current?.show({ zoom: 99, center: [1, 1] }));
    // The zoom stays inside the limits of the map
    expect(frames(build).at(-1)?.view).toEqual({ zoom: 12, center: [1, 1] });

    act(() => handle.current?.fit());
    expect(frames(build).at(-1)?.view).toEqual({ zoom: 1, center: null });
  });

  it('disposes the chart and its observers on unmount', () => {
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = observe;
        disconnect = disconnect;
      },
    );
    const { view } = setup();

    expect(observe).toHaveBeenCalledTimes(1);
    view.unmount();

    expect(instance.dispose).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
