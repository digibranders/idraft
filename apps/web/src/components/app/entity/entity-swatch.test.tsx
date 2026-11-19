import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EntitySwatch } from './entity-swatch';

describe('EntitySwatch', () => {
  it('draws a round dot, the third-party dot in the other color (WP-77, C 128 to 133)', () => {
    const { container } = render(
      <>
        <EntitySwatch colorIndex={3} own={false} shape="dot" />
        <EntitySwatch colorIndex={null} own={false} shape="dot" />
      </>,
    );
    const [competitor, other] = [...container.querySelectorAll('span')];
    expect(competitor?.className).toContain('rounded-full');
    expect(competitor?.className).toContain('bg-chart-3');
    expect(other?.className).toContain('bg-chart-other');
  });

  it('keeps the square mark, dashed past the sixth color', () => {
    const { container } = render(<EntitySwatch colorIndex={null} own={false} />);
    const swatch = container.querySelector('span');
    expect(swatch?.className).toContain('rounded-xs');
    expect(swatch?.className).toContain('border-dashed');
  });
});
