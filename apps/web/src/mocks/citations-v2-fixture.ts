import raw from './fixtures/citations-v2.json';
import { CITATIONS_FIXTURE_SHAPE, type CitationsFixture } from './citations-v2-shape';

export type { CitationsFixture, FixtureEngine, FixtureExpected } from './citations-v2-shape';

/** Parsed once, when the mock layer loads: a fixture that no longer fits fails there and in its test. */
export const CITATIONS_FIXTURE: CitationsFixture = CITATIONS_FIXTURE_SHAPE.parse(raw);
