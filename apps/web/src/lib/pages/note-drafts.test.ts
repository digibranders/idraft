import { describe, expect, it, vi } from 'vitest';

import { clearNoteDraft, noteDraft, setNoteDraft } from './note-drafts';
import type { LinksScope } from '@/lib/internal-links/types';

const SCOPE: LinksScope = { workspaceId: 'w1', projectId: 'p1' };
const OTHER_PROJECT: LinksScope = { workspaceId: 'w1', projectId: 'p2' };

describe('the note drafts', () => {
  it('are empty at first, and kept per project and page', () => {
    expect(noteDraft(SCOPE, '108')).toBe('');
    setNoteDraft(SCOPE, '108', 'x');
    expect(noteDraft(SCOPE, '108')).toBe('x');
    expect(noteDraft(SCOPE, '109')).toBe('');
    expect(noteDraft(OTHER_PROJECT, '108')).toBe('');
    clearNoteDraft(SCOPE, '108');
  });

  it('are removed by clearing and by setting an empty text', () => {
    setNoteDraft(SCOPE, '108', 'x');
    clearNoteDraft(SCOPE, '108');
    expect(noteDraft(SCOPE, '108')).toBe('');
    setNoteDraft(SCOPE, '108', 'y');
    setNoteDraft(SCOPE, '108', '');
    expect(noteDraft(SCOPE, '108')).toBe('');
  });

  it('are kept in memory only', () => {
    const storage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 0,
    };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    try {
      setNoteDraft(SCOPE, '108', 'private words');
      expect(noteDraft(SCOPE, '108')).toBe('private words');
      clearNoteDraft(SCOPE, '108');
      expect(storage.getItem).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
