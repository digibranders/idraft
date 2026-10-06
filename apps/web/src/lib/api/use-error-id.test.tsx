import { describe, expect, it } from 'vitest';

import { problemFrom } from './problem';
import { useErrorId } from './use-error-id';
import { renderWithProviders } from '@/test/render';

const problem = (requestId: string | null): ReturnType<typeof problemFrom> =>
  problemFrom(new Response(null, { status: 500 }), {
    code: 'internal_error',
    ...(requestId === null ? {} : { request_id: requestId }),
  });

/** What the hook gave on the last render of a component that reads it for `error`. */
function readFor(error: unknown): ReturnType<typeof useErrorId> | undefined {
  let seen: ReturnType<typeof useErrorId> | undefined;
  function Probe(): null {
    seen = useErrorId(error);
    return null;
  }
  renderWithProviders(<Probe />);
  return seen;
}

describe('useErrorId', () => {
  it('gives the request id of a problem with the words around it', () => {
    expect(readFor(problem('req_01HX'))).toEqual({
      id: 'req_01HX',
      label: 'Error ID req_01HX',
      copyLabel: 'Copy error ID',
      copiedLabel: 'Error ID copied',
    });
  });

  it('gives nothing for an error that has no request id, or is not a problem of the API', () => {
    expect(readFor(problem(null))).toBeNull();
    expect(readFor(new Error('network'))).toBeNull();
    expect(readFor(null)).toBeNull();
  });
});
