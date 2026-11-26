import { afterEach, describe, expect, it } from 'vitest';

import { findDrawerTitle } from './drawer-title';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('findDrawerTitle', () => {
  it('finds the title of the drawer when it is an aside', () => {
    document.body.innerHTML = '<aside aria-labelledby="t"><h2 id="t">Keyword</h2></aside>';
    expect(findDrawerTitle()).toBe(document.getElementById('t'));
  });

  it('finds the title of the drawer when it is a sheet', () => {
    document.body.innerHTML = '<div data-slot="sheet" aria-labelledby="t"><h2 id="t">Keyword</h2></div>';
    expect(findDrawerTitle()).toBe(document.getElementById('t'));
  });

  it('is null when no drawer is open, or when its title is not in the page', () => {
    expect(findDrawerTitle()).toBeNull();
    document.body.innerHTML = '<aside aria-labelledby="gone"></aside>';
    expect(findDrawerTitle()).toBeNull();
  });
});
