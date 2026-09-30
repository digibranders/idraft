import { act, renderHook } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { describe, expect, it } from 'vitest';

import { applyServerErrors, type ValidationItem } from './apply-server-errors';

interface KeywordsForm {
  name: string;
  items: { keyword: string }[];
}

// The tests with a mocked form check the calls. This one checks what react-hook-form does with them.
describe('applyServerErrors with a real form', () => {
  it('leaves each error where the form can show it: on a field it renders', () => {
    const { result } = renderHook(() =>
      useForm<KeywordsForm>({ defaultValues: { name: '', items: [{ keyword: 'crm' }] } }),
    );
    result.current.register('name');
    result.current.register('items');
    let rest: ValidationItem[] = [];
    act(() => {
      rest = applyServerErrors(
        result.current,
        [
          { location: 'body', path: 'items.0.keyword', code: 'string_too_long', message: 'Shorten this keyword.' },
          { location: 'body', path: 'name', code: 'duplicate', message: 'This name is taken.' },
          { location: 'body', path: 'timezone', code: 'timezone_unknown', message: 'Unknown time zone.' },
        ],
        { fields: ['name', 'items'] },
      );
    });
    expect(result.current.getFieldState('items').error).toMatchObject({
      type: 'server',
      message: 'Shorten this keyword.',
    });
    expect(result.current.getFieldState('name').error).toMatchObject({
      type: 'server',
      message: 'This name is taken.',
    });
    expect(rest.map((entry) => entry.path)).toEqual(['timezone']);
  });
});
