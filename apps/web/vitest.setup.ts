// Setup of the `dom` test project: DOM matchers, the axe matcher, and a clean document after every test.
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, expect } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';

expect.extend(axeMatchers);
// `findBy` and `waitFor` give up after 1 s by default. The Rankings grid (13 data columns) and a loaded machine
// can take longer to show its rows; the wait ends the moment the element is there, so a longer limit costs
// nothing when the screen is quick, and the test's own timeout (vitest.config.ts) still bounds it.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});
