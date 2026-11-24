import { act, screen, within } from '@testing-library/react';
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
    expect(box).toHaveClass('overflow-auto');
    expect(box).toHaveAttribute('tabindex', '0');
    expect(within(box).getByRole('img')).toBeInTheDocument();
    expect(within(box).queryByRole('heading', { name: 'Cited pages' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cited pages' })).toBeInTheDocument();
  });

  it('draws no box when there is no image to draw', () => {
    dialog('javascript:alert(1)');
    expect(screen.queryByRole('region', { name: /Screenshot of the latest/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Zoom' })).not.toBeInTheDocument();
  });

  it('shows the whole width at first and zooms in steps with the buttons, back to the width with the percent', async () => {
    const { user } = dialog('data:image/png;base64,AAAA');
    const image = screen.getByRole('img', { name: /latest ChatGPT answer/ });
    expect(image).toHaveStyle({ width: '100%' });
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(image).toHaveStyle({ width: '125%' });
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByRole('button', { name: '156%, fit the width' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(image).toHaveStyle({ width: '125%' });
    await user.click(screen.getByRole('button', { name: '125%, fit the width' }));
    expect(image).toHaveStyle({ width: '100%' });
  });

  it('stops zooming in at 400 percent', async () => {
    const { user } = dialog('data:image/png;base64,AAAA');
    for (let press = 0; press < 12; press += 1) await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByRole('img', { name: /latest ChatGPT answer/ })).toHaveStyle({ width: '400%' });
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  });

  it('zooms freely with Ctrl or Cmd and the wheel, and leaves a plain wheel to scroll the box', () => {
    dialog('data:image/png;base64,AAAA');
    const image = screen.getByRole('img', { name: /latest ChatGPT answer/ });
    const box = screen.getByRole('region', { name: /Screenshot of the latest/ });

    const plain = new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true });
    act(() => void box.dispatchEvent(plain));
    expect(plain.defaultPrevented).toBe(false);
    expect(image).toHaveStyle({ width: '100%' });

    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      const zoom = new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true, ...modifier });
      act(() => void box.dispatchEvent(zoom));
      expect(zoom.defaultPrevented).toBe(true);
    }
    // Two wheels of -400 at 0.0015 a pixel: e^0.6 each way, so 100% became about 332%, not one of four steps
    const width = Number.parseFloat(image.style.width);
    expect(width).toBeGreaterThan(300);
    expect(width).toBeLessThan(400);
    expect(width).not.toBe(Math.round(width));

    const out = new WheelEvent('wheel', { deltaY: 100000, ctrlKey: true, bubbles: true, cancelable: true });
    act(() => void box.dispatchEvent(out));
    expect(image).toHaveStyle({ width: '100%' });
  });
});
