import { describe, expect, it } from 'vitest';

import { MOCK_PASSWORD, mockUser } from './fixtures';
import { api } from '@/lib/api/client';

/*
 * In jsdom, MSW writes a mocked Set-Cookie to document.cookie and to its own cookie jar. vitest.msw.ts signs
 * out through the mocks after each test, so these two tests pass only in this order if it does.
 */
describe('the mock session between tests', () => {
  it('is signed in within the test that signs in', async () => {
    await api.POST('/api/v1/auth/sign-in', { body: { email: mockUser('editor').email, password: MOCK_PASSWORD } });
    expect((await api.GET('/api/v1/me')).response.status).toBe(200);
  });

  it('is signed out again in the next test', async () => {
    expect((await api.GET('/api/v1/me')).response.status).toBe(401);
  });
});
