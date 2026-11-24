import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EChart } from './echart';
import { CHART_CURSOR } from '@/lib/charts/rich-style';

interface FakeInstance {
  setOption: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
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

  it('makes the pointer the ring over empty canvas and over every mark, so a chart has one cursor', () => {
    render(<EChart option={option} height={140} />);
    const proxy = created[0]?.getZr().handler.proxy;
    // Set once when the chart is made
    expect(cursors[0]).toHaveBeenCalledWith(CHART_CURSOR);
    proxy?.setCursor('default');
    expect(cursors[0]).toHaveBeenLastCalledWith(CHART_CURSOR);
    // zrender says pointer over every mark that answers the pointer, clickable or not
    proxy?.setCursor('pointer');
    expect(cursors[0]).toHaveBeenLastCalledWith(CHART_CURSOR);
  });

  it('passes any other cursor through, such as a move cursor while a mark is dragged', () => {
    render(<EChart option={option} height={140} />);
    created[0]?.getZr().handler.proxy.setCursor('move');
    expect(cursors[0]).toHaveBeenLastCalledWith('move');
  });
});
