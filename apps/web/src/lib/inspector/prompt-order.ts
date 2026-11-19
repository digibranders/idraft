'use client';

import { createContext } from 'react';

/**
 * The prompt ids a page opens the prompt inspector from, in that page's order, for J and K and "3 of 12" (WP-77: the
 * Citations drawers open a prompt in place, I 66 to 69). A page provides it; `PromptDrawerHost` of the prompts feature
 * reads it. Empty: the inspector has no position.
 */
export const PromptOrderContext = createContext<readonly string[]>([]);
