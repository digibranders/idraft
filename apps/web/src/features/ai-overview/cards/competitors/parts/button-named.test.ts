// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { buttonNamed } from './button-named';

function listOf(...names: string[]): HTMLElement {
  const root = document.createElement('div');
  for (const name of names) {
    const button = document.createElement('button');
    button.setAttribute('aria-label', name);
    root.append(button);
  }
  return root;
}

describe('buttonNamed', () => {
  it('finds the button with the accessible name', () => {
    const root = listOf('Open HubSpot', 'Open Zoho');
    expect(buttonNamed(root, 'Open Zoho')).toBe(root.children[1]);
  });

  it('returns null for a name no button has, and for no root', () => {
    expect(buttonNamed(listOf('Open HubSpot'), 'Open Nobody')).toBeNull();
    expect(buttonNamed(null, 'Open HubSpot')).toBeNull();
  });
});
