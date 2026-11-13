'use client';

import { parseAsString, useQueryState } from 'nuqs';

import { DRAWER_ENTRY_KEYS, ENGINE_PARAM } from './drill';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { TOPIC_TAB } from '@/features/prompts/prompt-model';

/**
 * The drill-down from a topic's engine cell (WB-TPE-07): opens the topic's drawer on its Prompts tab and names the engine
 * in `eng`, one address update (nuqs writes the two together), every other key kept.
 */
export function useDrill(): (topicKey: string, engineCode: string) => void {
  const inspector = useInspector({ entryKeys: DRAWER_ENTRY_KEYS });
  const [, setEngine] = useQueryState(ENGINE_PARAM, parseAsString);
  return (topicKey, engineCode) => {
    inspector.open({ type: 'topic', id: topicKey }, { tab: TOPIC_TAB.prompts });
    void setEngine(engineCode);
  };
}
