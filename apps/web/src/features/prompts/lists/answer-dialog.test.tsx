import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnswerDialog, imageSource } from './answer-dialog';
import { renderWithProviders } from '@/test/render';

describe('imageSource', () => {
  it('accepts the API path of a stored screenshot', () => {
    const path =
      '/api/v1/workspaces/3f0c1d3e-0000-4000-8000-000000000001/projects/3f0c1d3e-0000-4000-8000-000000000002/ai/observations/77/screenshot';
    expect(imageSource(path)).toBe(path);
  });

  it('still accepts an https address and an inline image', () => {
    expect(imageSource('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(imageSource('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('refuses a script, another scheme and a path outside the API', () => {
    expect(imageSource('javascript:alert(1)')).toBeNull();
    expect(imageSource('file:///etc/passwd')).toBeNull();
    expect(imageSource('/other/path.png')).toBeNull();
    expect(imageSource('//evil.example.com/a.png')).toBeNull();
    expect(imageSource('/api/v1/../admin/screenshot')).toBeNull();
    expect(imageSource('/api/v1/workspaces/w/projects/p/ai/observations/77/raw')).toBeNull();
  });
});

describe('AnswerDialog', () => {
  const dialog = (screenshotUrl: string) =>
    renderWithProviders(
      <AnswerDialog
        open
        onOpenChange={() => undefined}
        platform={{ code: 'chatgpt_web', name: 'ChatGPT' }}
        promptText="Best SOC providers in India"
        observedAt="2026-11-23T10:00:00Z"
        screenshotUrl={screenshotUrl}
        citations={{ status: 'ready', items: [] }}
        timeZone="UTC"
      />,
    );

  it('keeps a tall image in a scrollable box of its own, named and reachable by keyboard, so the cited pages stay in reach below it', () => {
    dialog('data:image/png;base64,AAAA');
    const box = screen.getByRole('region', { name: 'Screenshot of the latest ChatGPT answer, scrolls' });
    expect(box).toHaveClass('overflow-y-auto');
    expect(box).toHaveAttribute('tabindex', '0');
    expect(within(box).getByRole('img')).toBeInTheDocument();
    expect(within(box).queryByRole('heading', { name: 'Cited pages' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cited pages' })).toBeInTheDocument();
  });

  it('draws no box when there is no image to draw', () => {
    dialog('javascript:alert(1)');
    expect(screen.queryByRole('region', { name: /Screenshot of the latest/ })).not.toBeInTheDocument();
  });
});
