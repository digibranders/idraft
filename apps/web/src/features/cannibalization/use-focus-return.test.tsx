import { render, screen } from '@testing-library/react';
import { useEffect, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { useFocusReturn } from './use-focus-return';

function Harness({ openId, from }: { openId: string | null; from: HTMLElement | null }): ReactElement {
  const remember = useFocusReturn(openId);
  useEffect(() => remember(from), [remember, from]);
  return (
    <table>
      <tbody>
        {['a', 'b', 'c'].map((id) => (
          <tr key={id} data-id={id}>
            <td>
              <button type="button">{`row ${id}`}</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const rowA = (): HTMLElement => screen.getByRole('button', { name: 'row a' });

describe('useFocusReturn', () => {
  it('returns focus to the button that opened the drawer', () => {
    const { rerender } = render(<Harness openId={null} from={null} />);
    rerender(<Harness openId="a" from={rowA()} />);
    rerender(<Harness openId={null} from={rowA()} />);
    expect(rowA()).toHaveFocus();
  });

  it('returns focus to the row of the keyword the drawer closes on after stepping', () => {
    const { rerender } = render(<Harness openId={null} from={null} />);
    rerender(<Harness openId="a" from={rowA()} />);
    rerender(<Harness openId="b" from={rowA()} />);
    rerender(<Harness openId={null} from={rowA()} />);
    expect(screen.getByRole('button', { name: 'row b' })).toHaveFocus();
  });

  it('finds the row when the drawer was opened from a popover, which has no opener', () => {
    const { rerender } = render(<Harness openId={null} from={null} />);
    rerender(<Harness openId="c" from={null} />);
    rerender(<Harness openId={null} from={null} />);
    expect(screen.getByRole('button', { name: 'row c' })).toHaveFocus();
  });

  it('leaves focus alone when the row is gone', () => {
    const { rerender } = render(<Harness openId={null} from={null} />);
    rerender(<Harness openId="zzz" from={null} />);
    rerender(<Harness openId={null} from={null} />);
    expect(document.body).toHaveFocus();
  });
});
