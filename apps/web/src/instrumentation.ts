/**
 * Runs once when the server starts. The work is in instrumentation.node.ts: this file is also compiled for
 * the Edge runtime, which has no `process.exit`, so it only decides which runtime it is in.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { checkServerEnvironment } = await import('./instrumentation.node');
  checkServerEnvironment();
}
