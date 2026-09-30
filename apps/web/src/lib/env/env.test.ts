import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parsePublicEnv, parseServerEnv } from './schema';

describe('parsePublicEnv', () => {
  it('defaults to development without mocking', () => {
    expect(parsePublicEnv({})).toEqual({
      NEXT_PUBLIC_APP_ENV: 'development',
      NEXT_PUBLIC_API_MOCKING: 'off',
      NEXT_PUBLIC_RELEASE: 'dev',
    });
  });

  it('treats an empty or blank variable as unset', () => {
    expect(parsePublicEnv({ NEXT_PUBLIC_RELEASE: '', NEXT_PUBLIC_API_MOCKING: '' }).NEXT_PUBLIC_RELEASE).toBe('dev');
    expect(parsePublicEnv({ NEXT_PUBLIC_RELEASE: '   ' }).NEXT_PUBLIC_RELEASE).toBe('dev');
  });

  it('names the variable that holds an unknown value', () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_APP_ENV: 'staging' })).toThrow(/NEXT_PUBLIC_APP_ENV/);
    expect(() => parsePublicEnv({ NEXT_PUBLIC_API_MOCKING: 'some' })).toThrow(/NEXT_PUBLIC_API_MOCKING/);
  });

  it('refuses mocking in production', () => {
    for (const mode of ['pending', 'all']) {
      expect(() => parsePublicEnv({ NEXT_PUBLIC_APP_ENV: 'production', NEXT_PUBLIC_API_MOCKING: mode })).toThrow(
        /NEXT_PUBLIC_API_MOCKING: must be off in production/,
      );
    }
    expect(parsePublicEnv({ NEXT_PUBLIC_APP_ENV: 'production' }).NEXT_PUBLIC_API_MOCKING).toBe('off');
  });
});

describe('parseServerEnv', () => {
  it('points at the local API in development and in tests', () => {
    expect(parseServerEnv({}, 'development').API_INTERNAL_ORIGIN).toBe('http://127.0.0.1:8000');
    expect(parseServerEnv({}, 'test').API_INTERNAL_ORIGIN).toBe('http://127.0.0.1:8000');
  });

  it('requires the API origin in production and names it', () => {
    expect(() => parseServerEnv({}, 'production')).toThrow(/API_INTERNAL_ORIGIN: is required/);
    expect(parseServerEnv({ API_INTERNAL_ORIGIN: 'http://api:8000' }, 'production').API_INTERNAL_ORIGIN).toBe(
      'http://api:8000',
    );
  });

  it('goes by the environment the bundle was built for, not by a variable the server may lack', () => {
    // A production image started without NEXT_PUBLIC_APP_ENV must not fall back to the development default
    expect(() => parseServerEnv({ NEXT_PUBLIC_APP_ENV: 'development' }, 'production')).toThrow(/API_INTERNAL_ORIGIN/);
  });

  it('accepts an origin only, written the way a browser writes it', () => {
    const refused = [
      'http://api:8000/',
      'http://api:8000/api/v1',
      'http://api:80',
      'http://API:8000',
      'api:8000',
      'ftp://api:8000',
      'not a url',
    ];
    for (const value of refused) {
      expect(() => parseServerEnv({ API_INTERNAL_ORIGIN: value }, 'development'), value).toThrow(
        /API_INTERNAL_ORIGIN: must be an http or https origin/,
      );
    }
    expect(parseServerEnv({ API_INTERNAL_ORIGIN: 'https://api.example.com' }, 'production').API_INTERNAL_ORIGIN).toBe(
      'https://api.example.com',
    );
  });

  it('takes a proxy target in development only', () => {
    expect(parseServerEnv({}, 'development').API_PROXY_TARGET).toBeUndefined();
    expect(parseServerEnv({ API_PROXY_TARGET: '' }, 'development').API_PROXY_TARGET).toBeUndefined();
    expect(parseServerEnv({ API_PROXY_TARGET: 'http://127.0.0.1:8000' }, 'development').API_PROXY_TARGET).toBe(
      'http://127.0.0.1:8000',
    );
    expect(() => parseServerEnv({ API_PROXY_TARGET: 'http://127.0.0.1:8000/api' }, 'development')).toThrow(
      /API_PROXY_TARGET/,
    );
    expect(() =>
      parseServerEnv(
        { API_INTERNAL_ORIGIN: 'http://api:8000', API_PROXY_TARGET: 'http://127.0.0.1:8000' },
        'production',
      ),
    ).toThrow(/API_PROXY_TARGET: is for development only/);
  });
});

describe('publicEnv', () => {
  // The module reads the environment when it is first loaded, so each test loads a fresh copy
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads the inlined values', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_API_MOCKING', 'off');
    vi.stubEnv('NEXT_PUBLIC_RELEASE', 'abc123');
    const { publicEnv } = await import('./public');
    expect(publicEnv).toEqual({
      NEXT_PUBLIC_APP_ENV: 'production',
      NEXT_PUBLIC_API_MOCKING: 'off',
      NEXT_PUBLIC_RELEASE: 'abc123',
    });
  });

  it('falls back to the defaults where nothing was inlined, as in a unit test', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', '');
    vi.stubEnv('NEXT_PUBLIC_API_MOCKING', 'sometimes');
    vi.stubEnv('NEXT_PUBLIC_RELEASE', '');
    const { publicEnv } = await import('./public');
    expect(publicEnv).toEqual({
      NEXT_PUBLIC_APP_ENV: 'development',
      NEXT_PUBLIC_API_MOCKING: 'off',
      NEXT_PUBLIC_RELEASE: 'dev',
    });
  });
});
