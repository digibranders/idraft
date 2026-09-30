import type { ReactNode } from 'react';

import { RouteNotFound } from '@/features/shell/route-status';

/** A path of the project that is not a page, inside the shell (its title comes from the route that asked). */
export default function ProjectNotFound(): ReactNode {
  return <RouteNotFound />;
}
