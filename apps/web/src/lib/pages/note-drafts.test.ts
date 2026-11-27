import { describe, expect, it, vi } from 'vitest';

import {
  clearAllNoteDrafts,
  clearNoteDraft,
  NOTE_DRAFTS_MAX,
  noteDraft,
  noteDraftFiles,
  noteDraftMentions,
  noteDraftPending,
  setNoteDraft,
  setNoteDraftFiles,
  setNoteDraftMentions,
  setNoteDraftPending,
} from './note-drafts';
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

  it('are all removed when the session ends', () => {
    setNoteDraft(SCOPE, '108', 'x');
    setNoteDraft(OTHER_PROJECT, '109', 'y');
    clearAllNoteDrafts();
    expect(noteDraft(SCOPE, '108')).toBe('');
    expect(noteDraft(OTHER_PROJECT, '109')).toBe('');
  });

  it('hold at most NOTE_DRAFTS_MAX pages: the one typed in longest ago is dropped', () => {
    clearAllNoteDrafts();
    for (let page = 0; page < NOTE_DRAFTS_MAX; page += 1) setNoteDraft(SCOPE, String(page), `text ${String(page)}`);
    // Typing again in the first page makes it the newest, so the second is the oldest
    setNoteDraft(SCOPE, '0', 'text 0 again');
    setNoteDraft(SCOPE, 'extra', 'one more');
    expect(noteDraft(SCOPE, '1')).toBe('');
    expect(noteDraft(SCOPE, '0')).toBe('text 0 again');
    expect(noteDraft(SCOPE, 'extra')).toBe('one more');
    expect(noteDraft(SCOPE, '2')).toBe('text 2');
    clearAllNoteDrafts();
  });

  describe('mentions and files', () => {
    const mention = { type: 'page', label: '@/pricing', target: '108', path: '/pricing' } as const;
    const file = {
      id: '0192e4a0-b000-7000-8000-000000000001',
      name: 'plan.pdf',
      size: 10,
      content_type: 'application/pdf',
      is_image: false,
      url: '/api/v1/x',
    };

    it('are empty at first, and kept per project and page beside the text', () => {
      clearAllNoteDrafts();
      expect(noteDraftMentions(SCOPE, '108')).toEqual([]);
      expect(noteDraftFiles(SCOPE, '108')).toEqual([]);
      setNoteDraftMentions(SCOPE, '108', [mention]);
      setNoteDraftFiles(SCOPE, '108', [file]);
      expect(noteDraftMentions(SCOPE, '108')).toEqual([mention]);
      expect(noteDraftFiles(SCOPE, '108')).toEqual([file]);
      expect(noteDraftMentions(SCOPE, '109')).toEqual([]);
      expect(noteDraftMentions(OTHER_PROJECT, '108')).toEqual([]);
      expect(noteDraftFiles(OTHER_PROJECT, '108')).toEqual([]);
      expect(noteDraft(SCOPE, '108')).toBe('');
      clearAllNoteDrafts();
    });

    it('are removed by an empty list', () => {
      setNoteDraftMentions(SCOPE, '108', [mention]);
      setNoteDraftMentions(SCOPE, '108', []);
      setNoteDraftFiles(SCOPE, '108', [file]);
      setNoteDraftFiles(SCOPE, '108', []);
      expect(noteDraftMentions(SCOPE, '108')).toEqual([]);
      expect(noteDraftFiles(SCOPE, '108')).toEqual([]);
    });

    it('go with the text on clearing a page, and with every page when the session ends', () => {
      setNoteDraft(SCOPE, '108', 'x');
      setNoteDraftMentions(SCOPE, '108', [mention]);
      setNoteDraftFiles(SCOPE, '108', [file]);
      setNoteDraftMentions(SCOPE, '109', [mention]);
      clearNoteDraft(SCOPE, '108');
      expect(noteDraft(SCOPE, '108')).toBe('');
      expect(noteDraftMentions(SCOPE, '108')).toEqual([]);
      expect(noteDraftFiles(SCOPE, '108')).toEqual([]);
      expect(noteDraftMentions(SCOPE, '109')).toEqual([mention]);
      clearAllNoteDrafts();
      expect(noteDraftMentions(SCOPE, '109')).toEqual([]);
    });

    it('hold at most NOTE_DRAFTS_MAX pages each', () => {
      clearAllNoteDrafts();
      for (let page = 0; page <= NOTE_DRAFTS_MAX; page += 1) setNoteDraftMentions(SCOPE, String(page), [mention]);
      expect(noteDraftMentions(SCOPE, '0')).toEqual([]);
      expect(noteDraftMentions(SCOPE, '1')).toEqual([mention]);
      clearAllNoteDrafts();
    });
  });

  it('keep the files chosen and not uploaded, per page, until a clear', () => {
    const chosen = new File(['x'], 'a.png', { type: 'image/png' });
    expect(noteDraftPending(SCOPE, '108')).toEqual([]);
    setNoteDraftPending(SCOPE, '108', [chosen]);
    expect(noteDraftPending(SCOPE, '108')).toEqual([chosen]);
    expect(noteDraftPending(SCOPE, '109')).toEqual([]);
    clearNoteDraft(SCOPE, '108');
    expect(noteDraftPending(SCOPE, '108')).toEqual([]);
    setNoteDraftPending(SCOPE, '108', [chosen]);
    clearAllNoteDrafts();
    expect(noteDraftPending(SCOPE, '108')).toEqual([]);
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
