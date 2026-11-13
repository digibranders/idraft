import type { Route } from 'next';
import type { useTranslations } from 'next-intl';

/**
 * The model of the setup checklist (23-application-patterns.md section 13) and its three AI steps (WB-SET-17):
 * what is done, the one fact each step shows, and the count. Pure: the reads arrive as values and the words
 * through a translator, so every case is a function call.
 *
 * One rule runs under all of it: a read that failed is unknown, and unknown is never done.
 */

export type SetupTranslate = ReturnType<typeof useTranslations<'setupChecklist'>>;

/** One row of the checklist, its words already written. */
export interface SetupStep {
  id: string;
  name: string;
  done: boolean;
  /** One fact in `type-meta`: "24 active prompts". */
  fact?: string | undefined;
  /** The fact says the step could not be read: it is shown at every width, since it is what tells that step from a plain to do. */
  unchecked?: boolean | undefined;
  /** The way to do the step; shown only while it is not done. */
  action?: { label: string; href: Route } | undefined;
}

/** What a read gave: its value, or that it failed. There is no third state: a read in flight is not given to the model. */
export type Read<T> = { state: 'ok'; value: T } | { state: 'failed' };

/** What the setup takes from the engines list: counts, never one score across engines. */
export interface EngineFacts {
  enabled: number;
  total: number;
  /**
   * The largest `active_prompts` of the engines. Each engine asks the prompts that fit its own length limit, so
   * the largest is every active prompt of the project; adding them would count each prompt once per engine.
   */
  largestActivePrompts: number;
}

export function enginesFacts(engines: readonly { is_enabled: boolean; active_prompts: number }[]): EngineFacts {
  return {
    enabled: engines.filter((engine) => engine.is_enabled).length,
    total: engines.length,
    largestActivePrompts: engines.reduce((largest, engine) => Math.max(largest, engine.active_prompts), 0),
  };
}

export interface AiSetupInput {
  engines: Read<EngineFacts>;
  /** Whether the project has an answer in the last 28 days. */
  answers: Read<boolean>;
  hrefs: { engines: Route; prompts: Route };
  t: SetupTranslate;
}

const unchecked = (t: SetupTranslate): { fact: string; unchecked: true } => ({
  fact: t('unchecked'),
  unchecked: true,
});
const action = (label: string, href: Route): { label: string; href: Route } => ({ label, href });

function enginesStep({ engines, hrefs, t }: AiSetupInput): SetupStep {
  const name = t('engines.name');
  if (engines.state === 'failed') {
    return { id: 'engines', name, done: false, ...unchecked(t), action: action(t('engines.action'), hrefs.engines) };
  }
  const done = engines.value.enabled > 0;
  return {
    id: 'engines',
    name,
    done,
    fact: t('engines.fact', { on: engines.value.enabled, total: engines.value.total }),
    action: done ? undefined : action(t('engines.action'), hrefs.engines),
  };
}

function promptsStep({ engines, hrefs, t }: AiSetupInput): SetupStep {
  const name = t('prompts.name');
  if (engines.state === 'failed') {
    return { id: 'prompts', name, done: false, ...unchecked(t), action: action(t('prompts.action'), hrefs.prompts) };
  }
  const done = engines.value.largestActivePrompts > 0;
  return {
    id: 'prompts',
    name,
    done,
    fact: t('prompts.fact', { count: engines.value.largestActivePrompts }),
    action: done ? undefined : action(t('prompts.action'), hrefs.prompts),
  };
}

function answersStep({ engines, answers, t }: AiSetupInput): SetupStep {
  const name = t('answers.name');
  if (answers.state === 'failed') return { id: 'answers', name, done: false, ...unchecked(t) };
  if (answers.value) return { id: 'answers', name, done: true };
  // No answer yet. Whether one is on its way depends on the engines and the prompts, which may be unknown
  if (engines.state === 'failed') return { id: 'answers', name, done: false, ...unchecked(t) };
  const ready = engines.value.enabled > 0 && engines.value.largestActivePrompts > 0;
  return { id: 'answers', name, done: false, fact: ready ? t('answers.waiting') : t('answers.blocked') };
}

/** The three AI steps, in the order of the preview: engines, prompts, first answers. */
export function aiSetupSteps(input: AiSetupInput): SetupStep[] {
  return [enginesStep(input), promptsStep(input), answersStep(input)];
}

/** The steps done and the steps in all, extra steps of the page included. */
export function setupProgress(steps: readonly SetupStep[]): { done: number; total: number } {
  return { done: steps.filter((step) => step.done).length, total: steps.length };
}

/** Where "Continue setup" goes: the action of the first step still to do, or `fallback` when none has one. */
export function continueHref(steps: readonly SetupStep[], fallback: Route): Route {
  return steps.find((step) => !step.done && step.action !== undefined)?.action?.href ?? fallback;
}
