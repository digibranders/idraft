import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { DETECTABLE, WITHIN, cell, engineOf, promptsOf, topicCell } from './change-test-data';
import { useChangeWords, type ChangeTipOptions } from './change-words';
import type { RateChange } from '@/lib/compare/change-model';
import { averageChangeOf, engineChangeOf, stripChangeOf } from '@/lib/compare/change-model';
import { renderWithProviders } from '@/test/render';

const RANGE = 'Sep 18 to Oct 15';

function Words({ change, options }: { change: RateChange | null; options: ChangeTipOptions }): ReactElement {
  const words = useChangeWords();
  return (
    <div>
      <p data-testid="tip">{words.tip(change, options)}</p>
      <p data-testid="label">{words.label(change)}</p>
    </div>
  );
}

function tipOf(change: RateChange | null, options: ChangeTipOptions): { tip: string; label: string } {
  const { unmount } = renderWithProviders(<Words change={change} options={options} />);
  const words = {
    tip: screen.getByTestId('tip').textContent ?? '',
    label: screen.getByTestId('label').textContent ?? '',
  };
  unmount();
  return words;
}

const engine = (pair: readonly [ReturnType<typeof cell>, ReturnType<typeof cell>]): RateChange | null =>
  engineChangeOf([engineOf('chatgpt_web', pair[0], pair[1])], 'chatgpt_web', 'mentioned');

describe('useChangeWords', () => {
  it('names the previous value with its counts, the window and the test', () => {
    const { tip, label } = tipOf(engine(DETECTABLE), { kind: 'engine', range: RANGE });
    expect(label).toBe('Previous 20%, 12 of 60 answers');
    expect(tip).toContain('Previous 20%, 12 of 60 answers');
    expect(tip).toContain(`Previous period: ${RANGE}`);
    expect(tip).toContain('Detectable change');
    expect(tip).toContain('Interim test');
  });

  it('says a change within normal variation is, and not that it is detectable', () => {
    const { tip } = tipOf(engine(WITHIN), { kind: 'engine', range: RANGE });
    expect(tip).toContain('Within normal variation');
    expect(tip).not.toContain('Detectable change');
    expect(tip).toContain('Interim test');
  });

  it('says how many engines an average is over and that the test is on pooled answers', () => {
    const cells = [
      engineOf('chatgpt_web', cell(30, 60), cell(12, 60)),
      engineOf('gemini_web', cell(20, 40), cell(8, 40)),
    ];
    const change = averageChangeOf(cells, ['chatgpt_web', 'gemini_web'], 'mentioned');
    const { tip } = tipOf(change, { kind: 'average', range: RANGE });
    expect(tip).toContain('Average of 2 engines that have a rate in both periods, tested on pooled answers');
    expect(tip).toContain('Previous 20%, 20 of 100 answers');
  });

  it('does not call one engine an average', () => {
    const cells = [engineOf('chatgpt_web', cell(30, 60), cell(12, 60))];
    const { tip } = tipOf(averageChangeOf(cells, ['chatgpt_web'], 'mentioned'), { kind: 'average', range: RANGE });
    expect(tip).not.toContain('Average of');
    expect(tip).not.toContain('pooled answers');
  });

  it('says over how many prompts a topic rate and a chip figure of the period before are', () => {
    const topic = [engineOf('chatgpt_web', topicCell(30, 60, 5), topicCell(12, 60, 4))];
    expect(tipOf(engineChangeOf(topic, 'chatgpt_web', 'mentioned'), { kind: 'engine', range: RANGE }).label).toBe(
      'Previous 20%, 12 of 60 answers, over 4 prompts',
    );
    const prompts = promptsOf([cell(15, 30), cell(6, 30)], [cell(15, 30), cell(6, 30)]);
    const strip = tipOf(stripChangeOf(prompts, 'chatgpt_web', 'mentioned'), { kind: 'strip', range: RANGE });
    expect(strip.tip).toContain('Previous 20%, 12 of 60 answers, over 2 prompts');
    expect(strip.tip).toContain(`Previous period, ${RANGE}`);
  });

  it('leaves the window out when the response names none', () => {
    const { tip } = tipOf(engine(DETECTABLE), { kind: 'engine', range: null });
    expect(tip).not.toContain('Previous period');
    expect(tip).toContain('Detectable change');
  });

  it('says no test exists for share of voice, and nothing about variation', () => {
    const cells = [engineOf('chatgpt_web', cell(30, 60), cell(12, 60), [cell(30, 60), cell(12, 60)])];
    const change = engineChangeOf(cells, 'chatgpt_web', 'share_of_voice');
    const { tip } = tipOf(change, { kind: 'engine', range: RANGE, metric: 'share_of_voice' });
    expect(tip).toContain('No test exists for share of voice');
    expect(tip).not.toContain('Detectable change');
    expect(tip).not.toContain('Within normal variation');
    expect(tip).not.toContain('Interim test');
  });

  it('gives no tip and no label for no change', () => {
    expect(tipOf(null, { kind: 'engine', range: RANGE })).toEqual({ tip: '', label: '' });
  });
});
