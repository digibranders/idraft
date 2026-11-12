import { onMockReset } from './state';
import { publicEnv } from '@/lib/env/public';

/**
 * Whether the mocks carry the full Eventus Security AI prompt data set (`fixtures/ai-prompts/`): its prompts and
 * engines, 92 days of answers, its entities and topics, its AI schedules, and a project order that opens it first.
 *
 * The development server (the app in `development` with every API mocked) starts with it on. A test and an end to
 * end run start with it off, so the 4,000 tests that rest on Fynix's 24 prompts, the 150 prompt workspace quota
 * they count against and the order of the projects see what they always saw; a test of Eventus Security turns it on
 * with `setAiSeeded(true)`, and the reset after each test turns it off again.
 */
const startsSeeded = (): boolean =>
  publicEnv.NEXT_PUBLIC_APP_ENV === 'development' && publicEnv.NEXT_PUBLIC_API_MOCKING === 'all';

let seeded = startsSeeded();

export const isAiSeeded = (): boolean => seeded;

export function setAiSeeded(value: boolean): void {
  seeded = value;
}

onMockReset(() => {
  seeded = startsSeeded();
});
