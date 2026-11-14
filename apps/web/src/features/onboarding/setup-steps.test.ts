import type { Route } from 'next';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import {
  aiSetupSteps,
  continueHref,
  enginesFacts,
  setupProgress,
  type AiSetupInput,
  type Read,
  type SetupStep,
} from './setup-steps';
import messages from '../../../messages/en.json';

/**
 * The model of the AI steps of the setup checklist (WB-SET-17): what is done, the one fact each step shows, and
 * the count. Pure: the reads arrive as values, and the words come from the catalog through a translator.
 * The rule under every case: a read that failed is unknown, and unknown is never done.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'setupChecklist' });
const HREFS = { engines: '/acme/fynix/settings/engines' as Route, prompts: '/acme/fynix/ai/prompts' as Route };

const ok = <T>(value: T): Read<T> => ({ state: 'ok', value });
const FAILED: Read<never> = { state: 'failed' };

type EngineRow = { is_enabled: boolean; active_prompts: number };
const row = (is_enabled: boolean, active_prompts: number): EngineRow => ({ is_enabled, active_prompts });
/** The three engines of a project with the same active prompts on each, `on` of them enabled. */
const three = (on: number, active: number): EngineRow[] => [0, 1, 2].map((index) => row(index < on, active));

function steps(engines: Read<EngineRow[]>, answers: Read<boolean>): SetupStep[] {
  const input: AiSetupInput = {
    engines: engines.state === 'ok' ? ok(enginesFacts(engines.value)) : FAILED,
    answers,
    hrefs: HREFS,
    t,
  };
  return aiSetupSteps(input);
}

function stepOf(list: SetupStep[], id: 'engines' | 'prompts' | 'answers'): SetupStep {
  const found = list.find((step) => step.id === id);
  if (found === undefined) throw new Error(`No step ${id}`);
  return found;
}

describe('enginesFacts', () => {
  it('counts the enabled engines and reads the largest active prompt count, never a sum', () => {
    expect(enginesFacts(three(2, 24))).toEqual({ enabled: 2, total: 3, largestActivePrompts: 24 });
    expect(enginesFacts([row(true, 24), row(true, 18), row(false, 30)])).toEqual({
      enabled: 2,
      total: 3,
      largestActivePrompts: 30,
    });
  });

  it('is empty for an empty list', () => {
    expect(enginesFacts([])).toEqual({ enabled: 0, total: 0, largestActivePrompts: 0 });
  });
});

describe('aiSetupSteps, Select AI engines', () => {
  it('is to do with no engine on: a count of the engines, with the way to the Engines page', () => {
    const step = stepOf(steps(ok(three(0, 24)), ok(false)), 'engines');
    expect(step).toMatchObject({
      name: 'Select AI engines',
      done: false,
      fact: '0 of 3 engines on',
      action: { label: 'Open Engines', href: HREFS.engines },
    });
  });

  it('is done with one engine on, and says how many, never one score for all of them', () => {
    const step = stepOf(steps(ok(three(1, 24)), ok(false)), 'engines');
    expect(step).toMatchObject({ done: true, fact: '1 of 3 engines on' });
    expect(step.action).toBeUndefined();
    expect(stepOf(steps(ok(three(3, 24)), ok(false)), 'engines').fact).toBe('3 of 3 engines on');
  });
});

describe('aiSetupSteps, Add prompts', () => {
  it('is to do while no engine has an active prompt', () => {
    const step = stepOf(steps(ok(three(2, 0)), ok(false)), 'prompts');
    expect(step).toMatchObject({
      name: 'Add prompts',
      done: false,
      fact: '0 active prompts',
      action: { label: 'Add prompts', href: HREFS.prompts },
    });
  });

  it('reads the largest count of the engines: the same prompts asked on three engines are not tripled', () => {
    const step = stepOf(steps(ok(three(3, 24)), ok(false)), 'prompts');
    expect(step).toMatchObject({ done: true, fact: '24 active prompts' });
    expect(step.action).toBeUndefined();
  });

  it('says 1 active prompt in the singular', () => {
    expect(stepOf(steps(ok(three(3, 1)), ok(false)), 'prompts').fact).toBe('1 active prompt');
  });

  it('does not need an engine to be on: prompts are the project, engines are the asking', () => {
    expect(stepOf(steps(ok(three(0, 24)), ok(false)), 'prompts').done).toBe(true);
  });
});

describe('aiSetupSteps, First answers', () => {
  it('is done when the project has an answer', () => {
    const step = stepOf(steps(ok(three(3, 24)), ok(true)), 'answers');
    expect(step).toMatchObject({ name: 'First answers', done: true });
    expect(step.action).toBeUndefined();
  });

  it('waits for the next run when engines and prompts are both done', () => {
    expect(stepOf(steps(ok(three(1, 24)), ok(false)), 'answers')).toMatchObject({
      done: false,
      fact: 'First answers arrive after the next Monday or Thursday run',
    });
  });

  it('needs engines and prompts when either is missing', () => {
    const noEngines = stepOf(steps(ok(three(0, 24)), ok(false)), 'answers');
    const noPrompts = stepOf(steps(ok(three(3, 0)), ok(false)), 'answers');
    expect(noEngines).toMatchObject({ done: false, fact: 'Needs engines and prompts' });
    expect(noPrompts).toMatchObject({ done: false, fact: 'Needs engines and prompts' });
  });

  it('is done with an answer even when the engines could not be read', () => {
    expect(stepOf(steps(FAILED, ok(true)), 'answers').done).toBe(true);
  });
});

describe('aiSetupSteps, a read that failed is unknown and never done', () => {
  it('shows both engine steps as could not be checked, with their way forward kept', () => {
    const list = steps(FAILED, ok(false));
    for (const id of ['engines', 'prompts'] as const) {
      expect(stepOf(list, id)).toMatchObject({ done: false, fact: 'Could not be checked' });
      expect(stepOf(list, id).action).toBeDefined();
    }
  });

  it('marks every could not be checked step, and no other, so the checklist can always show that fact', () => {
    expect(steps(FAILED, FAILED).map((step) => step.unchecked)).toEqual([true, true, true]);
    expect(steps(ok(three(1, 24)), ok(false)).map((step) => step.unchecked ?? false)).toEqual([false, false, false]);
  });

  it('shows the answers step as could not be checked when the answers read failed', () => {
    const list = steps(ok(three(3, 24)), FAILED);
    expect(stepOf(list, 'answers')).toMatchObject({ done: false, fact: 'Could not be checked' });
    // The other two steps still render what they know
    expect(stepOf(list, 'engines').done).toBe(true);
    expect(stepOf(list, 'prompts').done).toBe(true);
  });

  it('does not claim engines and prompts are missing when it could not read them', () => {
    const answers = stepOf(steps(FAILED, ok(false)), 'answers');
    expect(answers).toMatchObject({ done: false, fact: 'Could not be checked' });
  });

  it('is not done in any step when both reads failed', () => {
    expect(steps(FAILED, FAILED).map((step) => step.done)).toEqual([false, false, false]);
  });
});

describe('setupProgress', () => {
  const done = (id: string): SetupStep => ({ id, name: id, done: true });
  const todo = (id: string): SetupStep => ({ id, name: id, done: false });

  it('counts the steps it is given, extra steps included', () => {
    const ai = steps(ok(three(1, 24)), ok(false));
    expect(setupProgress(ai)).toEqual({ done: 2, total: 3 });
    expect(setupProgress([done('project'), todo('alerts'), ...ai])).toEqual({ done: 3, total: 5 });
  });

  it('writes the count with step in the singular for one and steps otherwise', () => {
    expect(t('progress', { done: 1, total: 1 })).toBe('Setup: 1 of 1 step complete');
    expect(t('progress', { done: 0, total: 3 })).toBe('Setup: 0 of 3 steps complete');
    expect(t('progress', { done: 7, total: 9 })).toBe('Setup: 7 of 9 steps complete');
  });

  it('is empty for no steps', () => {
    expect(setupProgress([])).toEqual({ done: 0, total: 0 });
  });
});

describe('continueHref', () => {
  it('is the action of the first step still to do', () => {
    const list = steps(ok(three(0, 0)), ok(false));
    expect(continueHref(list, '/fallback' as Route)).toBe(HREFS.engines);
    expect(continueHref(steps(ok(three(1, 0)), ok(false)), '/fallback' as Route)).toBe(HREFS.prompts);
  });

  it('skips a done step and a step with no action, and falls back when none is left', () => {
    const list: SetupStep[] = [
      { id: 'a', name: 'a', done: true, action: { label: 'x', href: '/a' as Route } },
      { id: 'b', name: 'b', done: false },
      { id: 'c', name: 'c', done: false, action: { label: 'x', href: '/c' as Route } },
    ];
    expect(continueHref(list, '/fallback' as Route)).toBe('/c');
    expect(continueHref(list.slice(0, 2), '/fallback' as Route)).toBe('/fallback');
  });
});
