import { describe, expect, it } from 'vitest';

import { issueCheckHref } from './page-drawer-context';
import { projectPath } from '@/lib/routes/paths';

const ISSUES = projectPath('digibranders', 'fynix', '/seo/issues');

describe('issueCheckHref', () => {
  it('links a check of the Issues catalogue to the open check of the Issues page', () => {
    expect(issueCheckHref(ISSUES)('status-4xx')).toBe(`${ISSUES}?check=status-4xx`);
  });

  it('gives no link for an id the Issues page does not know', () => {
    expect(issueCheckHref(ISSUES)('made-up')).toBeNull();
  });
});
