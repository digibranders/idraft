import { afterEach, describe, expect, it } from 'vitest';

import { findDrawerTitle, isInsideDrawer } from './drawer-title';

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

describe('isInsideDrawer', () => {
  it('is true for an element inside an aside drawer and inside a sheet', () => {
    document.body.innerHTML =
      '<aside aria-labelledby="a"><h2 id="a">A</h2><button id="in-aside">x</button></aside>' +
      '<div data-slot="sheet" aria-labelledby="s"><h2 id="s">S</h2><button id="in-sheet">y</button></div>';
    expect(isInsideDrawer(document.getElementById('in-aside') as HTMLElement)).toBe(true);
    expect(isInsideDrawer(document.getElementById('in-sheet') as HTMLElement)).toBe(true);
  });

  it('is false outside a drawer, and for an aside that is not a labelled drawer', () => {
    document.body.innerHTML = '<main><button id="row">x</button></main><aside><button id="plain">y</button></aside>';
    expect(isInsideDrawer(document.getElementById('row') as HTMLElement)).toBe(false);
    expect(isInsideDrawer(document.getElementById('plain') as HTMLElement)).toBe(false);
  });
});
