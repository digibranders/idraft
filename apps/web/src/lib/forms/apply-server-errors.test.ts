import type { UseFormSetError } from 'react-hook-form';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { applyServerErrors, type ValidationItem } from './apply-server-errors';

interface ProfileForm {
  email: string;
  profile: { name: string };
  items: { keyword: string }[];
}
const FIELDS = ['email', 'profile.name', 'items'] as const;

const item = (path: string, overrides: Partial<ValidationItem> = {}): ValidationItem => ({
  location: 'body',
  path,
  code: 'value_error',
  message: `Problem with ${path}`,
  ...overrides,
});
const form = (): { setError: Mock<UseFormSetError<ProfileForm>> } => ({
  setError: vi.fn<UseFormSetError<ProfileForm>>(),
});

describe('applyServerErrors', () => {
  it('puts an error of a body path on the field of that name', () => {
    const target = form();
    const rest = applyServerErrors<ProfileForm>(target, [item('email')], { fields: FIELDS });
    expect(target.setError).toHaveBeenCalledWith(
      'email',
      { type: 'server', message: 'Problem with email' },
      { shouldFocus: true },
    );
    expect(rest).toEqual([]);
  });

  it('addresses a nested path the way react-hook-form does', () => {
    const target = form();
    applyServerErrors<ProfileForm>(target, [item('profile.name')], { fields: FIELDS });
    expect(target.setError).toHaveBeenCalledWith('profile.name', expect.objectContaining({ type: 'server' }), {
      shouldFocus: true,
    });
  });

  it('shows an error for a path under a field on that field, which is what the form renders', () => {
    const target = form();
    const rest = applyServerErrors<ProfileForm>(target, [item('items.3.keyword')], { fields: FIELDS });
    expect(target.setError).toHaveBeenCalledWith('items', expect.objectContaining({ type: 'server' }), {
      shouldFocus: true,
    });
    expect(rest).toEqual([]);
  });

  it('prefers the field with the exact path when the form renders array rows as fields of their own', () => {
    const target = form();
    applyServerErrors<ProfileForm>(target, [item('items.3.keyword')], { fields: ['items', 'items.3.keyword'] });
    expect(target.setError).toHaveBeenCalledWith('items.3.keyword', expect.anything(), expect.anything());
  });

  it('gives a field the first error it gets and sets it once', () => {
    const target = form();
    const rest = applyServerErrors<ProfileForm>(
      target,
      [item('items.0.keyword'), item('items.4.keyword'), item('email')],
      { fields: FIELDS },
    );
    expect(target.setError.mock.calls.map(([name, error, options]) => [name, error.message, options])).toEqual([
      ['items', 'Problem with items.0.keyword', { shouldFocus: true }],
      ['email', 'Problem with email', { shouldFocus: false }],
    ]);
    expect(rest).toEqual([]);
  });

  it('returns an item for a path the form does not render, and sets nothing for it', () => {
    const target = form();
    const unknown = item('timezone');
    expect(applyServerErrors<ProfileForm>(target, [unknown], { fields: FIELDS })).toEqual([unknown]);
    expect(target.setError).not.toHaveBeenCalled();
  });

  it('does not take a path that only starts with the name of a field', () => {
    const target = form();
    const lookalike = item('email_verified');
    expect(applyServerErrors<ProfileForm>(target, [lookalike], { fields: FIELDS })).toEqual([lookalike]);
    expect(target.setError).not.toHaveBeenCalled();
  });

  it.each(['query', 'path', 'header'] as const)(
    'returns an item whose location is %s, even when a field has that name',
    (location) => {
      const target = form();
      const elsewhere = item('email', { location });
      expect(applyServerErrors<ProfileForm>(target, [elsewhere], { fields: FIELDS })).toEqual([elsewhere]);
      expect(target.setError).not.toHaveBeenCalled();
    },
  );

  it('moves focus to the first field that got an error, and only to that one', () => {
    const target = form();
    applyServerErrors<ProfileForm>(target, [item('timezone'), item('profile.name'), item('email')], { fields: FIELDS });
    expect(target.setError.mock.calls.map(([name, , options]) => [name, options])).toEqual([
      ['profile.name', { shouldFocus: true }],
      ['email', { shouldFocus: false }],
    ]);
  });

  it('shows the client copy for a code when there is one, and the message of the server otherwise', () => {
    const target = form();
    applyServerErrors<ProfileForm>(
      target,
      [item('email', { code: 'duplicate' }), item('profile.name', { code: 'string_too_long' })],
      { fields: FIELDS, messages: { duplicate: 'This email already has an account' } },
    );
    expect(target.setError.mock.calls.map(([, error]) => error.message)).toEqual([
      'This email already has an account',
      'Problem with profile.name',
    ]);
  });

  it('keeps the order of the items it returns', () => {
    const items = [item('a'), item('email'), item('sort', { location: 'query' }), item('b')];
    expect(applyServerErrors<ProfileForm>(form(), items, { fields: FIELDS }).map((entry) => entry.path)).toEqual([
      'a',
      'sort',
      'b',
    ]);
  });
});
