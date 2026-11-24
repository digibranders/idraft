/**
 * Fixtures and rules of the Alerts mock (docs/superpowers/plans/2026-11-24-alerts.md). No DOM: loadable in Node.
 * Version 1 sends alerts in the app only, after each run. An alert says what changed between two runs.
 */

export const RULE_TYPES = [
  { id: 'ai_mention_gained', label: 'Brand mentioned in an answer', area: 'AI', needs: 'prompts', text: 'A prompt starts to mention your brand.' },
  { id: 'ai_mention_lost', label: 'Brand no longer mentioned in an answer', area: 'AI', needs: 'prompts', text: 'A prompt stops mentioning your brand.' },
  { id: 'ai_competitor_appeared', label: 'Competitor starts to appear in an answer', area: 'AI', needs: 'prompts', text: 'A competitor is mentioned for a prompt where it was not in the previous run.' },
  { id: 'rank_drop', label: 'Keyword rank drops', area: 'SEO', needs: 'keywords', text: 'A keyword falls by the number of positions you set in one check.' },
];

export const GROUPS = ['All groups', 'Event security', 'Corporate security', 'Retail security'];
export const PLATFORMS = ['All platforms', 'ChatGPT', 'Gemini', 'Google AI Mode'];

export const typeOf = (id) => RULE_TYPES.find((type) => type.id === id);

export const rules = [
  { id: 'r1', name: 'Brand lost in an answer', type: 'ai_mention_lost', group: 'All groups', platform: 'All platforms', positions: 5, active: true, fired: 4 },
  { id: 'r2', name: 'New competitor in event security', type: 'ai_competitor_appeared', group: 'Event security', platform: 'All platforms', positions: 5, active: true, fired: 2 },
  { id: 'r3', name: 'Big keyword drops', type: 'rank_drop', group: 'All groups', platform: 'All platforms', positions: 5, active: true, fired: 6 },
  { id: 'r4', name: 'Brand gained in retail answers', type: 'ai_mention_gained', group: 'Retail security', platform: 'ChatGPT', positions: 5, active: false, fired: 0 },
];

/** `when` is a label, `run` the run the change was found in. A change names both runs it compares. */
export const events = [
  { id: 'e1', rule: 'r1', kind: 'ai_mention_lost', severity: 'warning', when: 'Today, 06:12', run: 'Run of 24 Nov', subject: 'best event security companies in Chicago', detail: 'Eventus Security was mentioned in 3 of 5 ChatGPT answers on 23 Nov and in 0 of 5 on 24 Nov.', unread: true, acknowledged: false },
  { id: 'e2', rule: 'r2', kind: 'ai_competitor_appeared', severity: 'info', when: 'Today, 06:12', run: 'Run of 24 Nov', subject: 'who provides festival security staff', detail: 'Halden Security was mentioned in 2 of 5 Gemini answers. It was not mentioned on 23 Nov.', unread: true, acknowledged: false },
  { id: 'e3', rule: 'r3', kind: 'rank_drop', severity: 'critical', when: 'Today, 04:40', run: 'Check of 24 Nov', subject: 'event security guards', detail: 'Rank fell from 4 to 11 (7 positions).', unread: true, acknowledged: false },
  { id: 'e4', rule: 'r3', kind: 'rank_drop', severity: 'warning', when: 'Yesterday, 04:38', run: 'Check of 23 Nov', subject: 'crowd control services near me', detail: 'Rank fell from 9 to 15 (6 positions).', unread: false, acknowledged: true },
  { id: 'e5', rule: 'r1', kind: 'ai_mention_lost', severity: 'warning', when: 'Yesterday, 06:10', run: 'Run of 23 Nov', subject: 'corporate event security checklist', detail: 'Eventus Security was mentioned in 2 of 4 Google AI Mode answers on 22 Nov and in 0 of 4 on 23 Nov.', unread: false, acknowledged: false },
];

export const SEVERITY = { info: ['Info', 'info'], warning: ['Warning', 'warning'], critical: ['Critical', 'negative'] };

/**
 * How many times a rule would have fired in the last 30 days, for the editor's preview line. Fixture arithmetic:
 * a lower rank threshold fires more often.
 */
export function backtest(draft) {
  if (draft.type === 'rank_drop') return Math.max(0, Math.round(42 / Math.max(1, draft.positions)) - 2);
  if (draft.type === 'ai_competitor_appeared') return draft.group === 'All groups' ? 9 : 3;
  return draft.group === 'All groups' ? 6 : 2;
}

export const POSITIONS_MIN = 1;
export const POSITIONS_MAX = 50;

/** Returns an error text, or '' when the draft can be saved. */
export function validate(draft) {
  if (!draft.name.trim()) return 'Name the rule so you can find it in the list.';
  if (draft.type === 'rank_drop' && !(Number.isInteger(draft.positions) && draft.positions >= POSITIONS_MIN && draft.positions <= POSITIONS_MAX)) {
    return `Positions must be a whole number from ${POSITIONS_MIN} to ${POSITIONS_MAX}.`;
  }
  return '';
}
