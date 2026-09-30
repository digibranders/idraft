// vitest-axe ships its matcher types for an older Vitest. This declares the matcher on the interface
// Vitest documents for custom matchers, so `expect(results).toHaveNoViolations()` type-checks.
import 'vitest';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- a merged declaration must repeat the type parameters
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toHaveNoViolations(): R;
  }
}
