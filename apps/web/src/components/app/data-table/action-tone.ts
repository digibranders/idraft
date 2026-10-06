import type { RecordAction } from './types';

/** How an action is drawn: the destructive group draws destructive unless the action says `default`. */
export const toneOf = <TRow>(action: RecordAction<TRow>): 'default' | 'destructive' =>
  action.tone ?? (action.group === 'destructive' ? 'destructive' : 'default');
