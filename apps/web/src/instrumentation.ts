/**
 * Runs once when the server starts. The work is in instrumentation.node.ts: this file is also compiled for
 * the Edge runtime, which has no `process.exit`, so it only decides which runtime it is in.
 *
 * With API mocking on, MSW answers the requests Server Components send to the API. Its import sits inside
 * a check of the inlined variable, so a build with mocking off drops it.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { checkServerEnvironment } = await import('./instrumentation.node');
  checkServerEnvironment();
  if (process.env.NEXT_PUBLIC_API_MOCKING === 'pending' || process.env.NEXT_PUBLIC_API_MOCKING === 'all') {
    const { startMockServer } = await import('./mocks/node');
    startMockServer(process.env.NEXT_PUBLIC_API_MOCKING);
  }
}
