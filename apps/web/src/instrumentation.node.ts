import { serverEnv } from '@/lib/env/server';

/**
 * A missing or malformed server variable ends the process with its name. Next.js would otherwise keep the
 * port open and answer every request with a 500, which a health check on the port reads as healthy
 * (20 section 9.2).
 */
export function checkServerEnvironment(): void {
  try {
    serverEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
