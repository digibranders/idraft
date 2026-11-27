'use client';

import { createContext } from 'react';

/**
 * The tracked keyword ids the Cannibalization page opens its keyword inspector from, in the order of the table on
 * screen, for J and K and "3 of 12". The page provides it; the inspector reads it. Empty: the inspector has no position.
 */
export const CannOrderContext = createContext<readonly string[]>([]);
