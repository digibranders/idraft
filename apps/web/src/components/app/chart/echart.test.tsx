import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EChart } from './echart';
import { CHART_CURSOR } from '@/lib/charts/rich-style';

interface FakeInstance {
  setOption: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  getZr: () => { handler: { proxy: { setCursor: (cursor?: string) => void } } };
  group?: string;
}

const echarts = vi.hoisted(() => ({
  init: vi.fn<() => FakeInstance>(),
  use: vi.fn(),
  connect: vi.fn<(group: string) => string>((group) => group),
}));
vi.mock('echarts/core', () => echarts);

const created: FakeInstance[] = [];
/** The cursor setter of each instance as zrender had it, before the chart wrapped it. */
const cursors: ReturnType<typeof vi.fn>[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  created.length = 0;
  cursors.length = 0;
  echarts.init.mockImplementation(() => {
    const setCursor = vi.fn();
    cursors.push(setCursor);
    const proxy = { setCursor };
    const instance: FakeInstance = {
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
      on: vi.fn(),
      getZr: () => ({ handler: { proxy } }),
    };
    created.push(instance);
    return instance;
  });
});

const option = (): Record<string, unknown> => ({});

describe('EChart', () => {
  it('puts the instance in its group and connects the group once, however many charts share it', () => {
    render(
      <>
        <EChart option={option} height={140} group="test-shared" />
        <EChart option={option} height={140} group="test-shared" />
      </>,
    );
    expect(created.map((instance) => instance.group)).toEqual(['test-shared', 'test-shared']);
    expect(echarts.connect).toHaveBeenCalledTimes(1);
    expect(echarts.connect).toHaveBeenCalledWith('test-shared');
  });

  it('connects each group of its own', () => {
    render(
      <>
        <EChart option={option} height={140} group="test-first" />
        <EChart option={option} height={140} group="test-second" />
      </>,
    );
    expect(echarts.connect.mock.calls.map(([group]) => group)).toEqual(['test-first', 'test-second']);
  });

  it('leaves a chart without a group alone: no group on the instance and no connect', () => {
    render(<EChart option={option} height={140} />);
    expect(created).toHaveLength(1);
    expect(created[0]?.group).toBeUndefined();
    expect(echarts.connect).not.toHaveBeenCalled();
  });

  it('hands the index of a clicked datum to onPick, and the latest onPick after a re-render', () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<EChart option={option} height={140} onPick={first} />);
    view.rerender(<EChart option={option} height={140} onPick={second} />);
    const [event, handler] = created[0]?.on.mock.calls[0] as ['click', (event: { dataIndex?: number }) => void];
    expect(event).toBe('click');
    handler({ dataIndex: 3 });
    handler({});
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(3);
  });

  it('makes the pointer the ring over empty canvas and over marks that only show a tooltip', () => {
    render(<EChart option={option} height={140} />);
    const proxy = created[0]?.getZr().handler.proxy;
    // Set once when the chart is made
    expect(cursors[0]).toHaveBeenCalledWith(CHART_CURSOR);
    proxy?.setCursor('default');
    expect(cursors[0]).toHaveBeenLastCalledWith(CHART_CURSOR);
    // zrender says pointer over every mark; with nothing to open, the ring stays
    proxy?.setCursor('pointer');
    expect(cursors[0]).toHaveBeenLastCalledWith(CHART_CURSOR);
  });

  it('keeps the hand over a mark that opens something, and the ring over one that does not', () => {
    render(<EChart option={option} height={140} onPick={vi.fn()} opensAt={(index) => index === 1} />);
    const instance = created[0];
    const proxy = instance?.getZr().handler.proxy;
    const over = (dataIndex: number): void => {
      const handler = instance?.on.mock.calls.find(([name]) => name === 'mouseover')?.[1] as (event: { dataIndex?: number }) => void;
      handler({ dataIndex });
    };
    over(1);
    proxy?.setCursor('pointer');
    expect(cursors[0]).toHaveBeenLastCalledWith('pointer');
    over(0);
    proxy?.setCursor('pointer');
    expect(cursors[0]).toHaveBeenLastCalledWith(CHART_CURSOR);
    // Off the mark, the pointer is a plain pointer again
    const out = instance?.on.mock.calls.find(([name]) => name === 'mouseout')?.[1] as () => void;
    out();
    proxy?.setCursor('pointer');
    expect(cursors[0]).toHaveBeenLastCalledWith('pointer');
  });

  it('keeps the hand over every mark when onPick has no opensAt', () => {
    render(<EChart option={option} height={140} onPick={vi.fn()} />);
    created[0]?.getZr().handler.proxy.setCursor('pointer');
    expect(cursors[0]).toHaveBeenLastCalledWith('pointer');
  });
});
