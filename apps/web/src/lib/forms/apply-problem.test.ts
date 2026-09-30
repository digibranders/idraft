import type { UseFormSetError } from 'react-hook-form';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { applyProblem } from './apply-problem';
import { problemFrom } from '@/lib/api/problem';

interface ProjectForm {
  name: string;
  slug: string;
  timezone: string;
}
const FIELDS = ['name', 'slug', 'timezone'] as const;

const form = (): { setError: Mock<UseFormSetError<ProjectForm>> } => ({
  setError: vi.fn<UseFormSetError<ProjectForm>>(),
});
const problem = (status: number, code: string, extra: Record<string, unknown> = {}): Error =>
  problemFrom(new Response(null, { status }), {
    type: 'about:blank',
    title: code,
    status,
    code,
    instance: '/api/v1/workspaces',
    request_id: 'req_1',
    ...extra,
  });

describe('applyProblem', () => {
  it('puts the items of a validation_failed on their fields and returns the rest', () => {
    const target = form();
    const outcome = applyProblem<ProjectForm>(
      target,
      problem(422, 'validation_failed', {
        errors: [
          { location: 'body', path: 'timezone', code: 'timezone_unknown', message: 'Unknown time zone.' },
          { location: 'query', path: 'limit', code: 'extra_forbidden', message: 'Not allowed.' },
        ],
      }),
      { fields: FIELDS, messages: { timezone_unknown: 'Choose a time zone from the list' } },
    );
    expect(target.setError).toHaveBeenCalledWith(
      'timezone',
      { type: 'server', message: 'Choose a time zone from the list' },
      { shouldFocus: true },
    );
    expect(outcome).toEqual({
      kind: 'fields',
      unmatched: [{ location: 'query', path: 'limit', code: 'extra_forbidden', message: 'Not allowed.' }],
    });
  });

  it('puts a code tied to one field on that field, with the form copy for the code', () => {
    const target = form();
    const outcome = applyProblem<ProjectForm>(target, problem(409, 'duplicate', { detail: 'Slug taken.' }), {
      fields: FIELDS,
      codeToField: { duplicate: 'slug' },
      messages: { duplicate: 'Another project uses this slug' },
    });
    expect(target.setError).toHaveBeenCalledWith(
      'slug',
      { type: 'server', message: 'Another project uses this slug' },
      { shouldFocus: true },
    );
    expect(outcome).toEqual({ kind: 'fields', unmatched: [] });
  });

  it("uses the API's detail for a field code the form has no copy for", () => {
    const target = form();
    applyProblem<ProjectForm>(target, problem(409, 'duplicate', { detail: 'Slug taken.' }), {
      fields: FIELDS,
      codeToField: { duplicate: 'slug' },
    });
    expect(target.setError).toHaveBeenCalledWith(
      'slug',
      { type: 'server', message: 'Slug taken.' },
      { shouldFocus: true },
    );
  });

  it.each(['quota_exceeded', 'competitor_limit', 'budget_exceeded'])('shows %s as a form alert', (code) => {
    const error = problem(422, code, { limit: 5, used: 5, requested: 1 });
    expect(applyProblem<ProjectForm>(form(), error, { fields: FIELDS })).toEqual({ kind: 'alert', problem: error });
  });

  it("shows the form's own alert codes as alerts", () => {
    const error = problem(422, 'weak_password', { reason: 'breached' });
    expect(applyProblem<ProjectForm>(form(), error, { fields: FIELDS, alertCodes: ['weak_password'] })).toEqual({
      kind: 'alert',
      problem: error,
    });
  });

  it.each([
    [409, 'conflict'],
    [412, 'precondition_failed'],
  ])('sends a %i %s to the conflict dialog', (status, code) => {
    const error = problem(status, code);
    expect(applyProblem<ProjectForm>(form(), error, { fields: FIELDS })).toEqual({ kind: 'conflict', problem: error });
  });

  it('asks for a fresh session on fresh_session_required', () => {
    const error = problem(403, 'fresh_session_required', { reauth_url: '/api/v1/me/reauthenticate' });
    expect(applyProblem<ProjectForm>(form(), error, { fields: FIELDS })).toEqual({
      kind: 'fresh-session',
      problem: error,
    });
  });

  it('rethrows what a form does not handle, for the error boundary', () => {
    const target = form();
    const notFound = problem(404, 'not_found');
    expect(() => applyProblem<ProjectForm>(target, notFound, { fields: FIELDS })).toThrow(notFound);
    const offline = new TypeError('Failed to fetch');
    expect(() => applyProblem<ProjectForm>(target, offline, { fields: FIELDS })).toThrow(offline);
    expect(target.setError).not.toHaveBeenCalled();
  });
});
