import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EChart } from './echart';

interface FakeInstance {
  setOption: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  group?: string;
}

const echarts = vi.hoisted(() => ({
  init: vi.fn<() => FakeInstance>(),
  use: vi.fn(),
  connect: vi.fn<(group: string) => string>((group) => group),
}));
vi.mock('echarts/core', () => echarts);

const created: FakeInstance[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  created.length = 0;
  echarts.init.mockImplementation(() => {
    const instance: FakeInstance = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
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
});
