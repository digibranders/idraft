// `next build` with output: 'standalone' leaves static assets out of the standalone folder; a CDN or the
// image build is expected to place them. This copies them in, so `pnpm start` serves the same tree the
// web image serves (the Dockerfile performs the same two copies).
import { cp, stat } from 'node:fs/promises';
import path from 'node:path';

const APP_ROOT = path.join(import.meta.dirname, '..');
const STANDALONE_APP = path.join(APP_ROOT, '.next/standalone/apps/web');

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

if (!(await exists(path.join(STANDALONE_APP, 'server.js')))) {
  throw new Error('No standalone build found. Run `pnpm build` first.');
}

await cp(path.join(APP_ROOT, '.next/static'), path.join(STANDALONE_APP, '.next/static'), { recursive: true });

const publicDirectory = path.join(APP_ROOT, 'public');
if (await exists(publicDirectory)) {
  await cp(publicDirectory, path.join(STANDALONE_APP, 'public'), { recursive: true });
}
