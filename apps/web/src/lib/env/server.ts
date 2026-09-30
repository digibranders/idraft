import 'server-only';

import { publicEnv } from './public';
import { parseServerEnv, type ServerEnv } from './schema';

let cached: ServerEnv | null = null;

/** Server values, validated on first use. Importing this module from client code fails the build. */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env, publicEnv.NEXT_PUBLIC_APP_ENV);
  return cached;
}
