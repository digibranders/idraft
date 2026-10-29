'use client';

import { useCallback, useState, type ReactNode } from 'react';

import { SpecimenGroup } from './specimen';
import { TableScroll } from './table-scroll';
import { Z_LAYERS } from './token-groups';
import { useTokenValues } from './use-token-values';
import { NAMED_CONTAINERS, NAMED_RADII, NAMED_SHADOWS, NAMED_SIZES } from '@/lib/design/class-names';
import { cn } from '@/lib/utils';

const ROOT_FONT_PX = 16;

/** The spacing steps the scale allows (04 section 2), each with the class that draws it. */
const SPACING: readonly (readonly [step: string, className: string])[] = [
  ['0', cn('w-0')],
  ['0.5', cn('w-0.5')],
  ['1', cn('w-1')],
  ['1.5', cn('w-1.5')],
  ['2', cn('w-2')],
  ['3', cn('w-3')],
  ['4', cn('w-4')],
  ['5', cn('w-5')],
  ['6', cn('w-6')],
  ['8', cn('w-8')],
  ['10', cn('w-10')],
  ['12', cn('w-12')],
];
// Tailwind only emits a class it finds written out, so each name has its class spelled here. The Record
// types make the build fail when a name is added to class-names.ts and not to these maps.
const CONTAINER_CLASS: Readonly<Record<(typeof NAMED_CONTAINERS)[number], string>> = {
  reading: cn('max-w-reading'),
  form: cn('max-w-form'),
  'dialog-sm': cn('max-w-dialog-sm'),
  'dialog-md': cn('max-w-dialog-md'),
  'dialog-lg': cn('max-w-dialog-lg'),
};
const RADIUS_CLASS: Readonly<Record<(typeof NAMED_RADII)[number], string>> = {
  '2xs': cn('rounded-2xs'),
  xs: cn('rounded-xs'),
  sm: cn('rounded-sm'),
  md: cn('rounded-md'),
  lg: cn('rounded-lg'),
  xl: cn('rounded-xl'),
  full: cn('rounded-full'),
};
const SHADOW_CLASS: Readonly<Record<(typeof NAMED_SHADOWS)[number], string>> = {
  popover: cn('shadow-popover'),
  'switch-knob': cn('shadow-switch-knob'),
  dialog: cn('shadow-dialog'),
  drag: cn('shadow-drag'),
  inspector: cn('shadow-inspector'),
};

/** `2.25rem` as `2.25rem (36 px)`: the pixel value at the default root size, as tokens.css states it. */
function withPixels(value: string): string {
  if (value === '') return 'Not read yet';
  if (!value.endsWith('rem')) return value;
  const px = Math.round(Number.parseFloat(value) * ROOT_FONT_PX * 100) / 100;
  return `${value} (${String(px)} px)`;
}

const HEAD = cn('h-row-header pr-4 text-left type-table-header');
const CELL = cn('h-row-compact pr-4 align-middle');

/**
 * One style property of an element as the browser computed it, in pixels: `640 px`. Container widths and
 * radii are measured, not read from a custom property, because Tailwind writes a theme value into the
 * rule and leaves the variable out of the page unless something else refers to it.
 */
function useMeasured(
  property: 'maxWidth' | 'borderTopLeftRadius',
): readonly [(node: HTMLElement | null) => void, string] {
  const [value, setValue] = useState('');
  const measure = useCallback(
    (node: HTMLElement | null): void => {
      if (!node) return;
      const pixels = Number.parseFloat(getComputedStyle(node)[property]);
      if (Number.isFinite(pixels)) setValue(`${String(Math.round(pixels * 100) / 100)} px`);
    },
    [property],
  );
  return [measure, value === '' ? 'Not read yet' : value];
}

function ContainerBar({ name }: { name: (typeof NAMED_CONTAINERS)[number] }): ReactNode {
  const [measure, width] = useMeasured('maxWidth');
  return (
    <div
      ref={measure}
      className={cn(
        'flex h-control-sm items-center justify-between gap-3 rounded-md border border-border-strong bg-surface-subtle px-2',
        CONTAINER_CLASS[name],
      )}
    >
      <span className="type-mono text-foreground">{name}</span>
      <span className="num type-meta">{width}</span>
    </div>
  );
}

function RadiusTile({ name }: { name: (typeof NAMED_RADII)[number] }): ReactNode {
  const [measure, radius] = useMeasured('borderTopLeftRadius');
  return (
    <li className="flex flex-col items-start gap-1.5">
      <span
        ref={measure}
        aria-hidden="true"
        className={cn('block size-12 border border-border-strong bg-surface-subtle', RADIUS_CLASS[name])}
      />
      <span className="type-mono text-foreground">{name}</span>
      <span className="num type-meta">{radius}</span>
    </li>
  );
}

export function SizesSection(): ReactNode {
  const read = useTokenValues();
  return (
    <>
      <SpecimenGroup title="Spacing" note="04 section 2. One step is 4 px; these twelve are the only steps in use.">
        <TableScroll label="Spacing">
          <table className="border-collapse type-table">
            <caption className="sr-only">The spacing steps with their size in pixels</caption>
            <thead>
              <tr>
                <th scope="col" className={HEAD}>
                  Step
                </th>
                <th scope="col" className={HEAD}>
                  Size
                </th>
                <th scope="col" className={HEAD}>
                  Drawn
                </th>
              </tr>
            </thead>
            <tbody>
              {SPACING.map(([step, className]) => (
                <tr key={step} className="border-t border-border-subtle">
                  <th scope="row" className={cn(CELL, 'text-left font-mono text-foreground')}>
                    {step}
                  </th>
                  <td className={cn(CELL, 'num text-foreground-tertiary')}>{Number(step) * 4} px</td>
                  <td className={CELL}>
                    <span aria-hidden="true" className={cn('block h-3 rounded-2xs bg-primary', className)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </SpecimenGroup>

      <SpecimenGroup
        title="Named sizes"
        note="04 section 5. Heights and widths of components, used as h-, w-, min-w-, max-w- and size- utilities."
      >
        <TableScroll label="Named sizes">
          <table className="w-full border-collapse type-table">
            <caption className="sr-only">The named sizes with their values</caption>
            <thead>
              <tr>
                <th scope="col" className={HEAD}>
                  Name
                </th>
                <th scope="col" className={HEAD}>
                  Value
                </th>
                <th scope="col" className={cn(HEAD, 'w-full')}>
                  Drawn
                </th>
              </tr>
            </thead>
            <tbody>
              {NAMED_SIZES.map((name) => (
                <tr key={name} className="border-t border-border-subtle">
                  <th scope="row" className={cn(CELL, 'text-left font-mono whitespace-nowrap text-foreground')}>
                    {name}
                  </th>
                  <td className={cn(CELL, 'num whitespace-nowrap text-foreground-tertiary')}>
                    {withPixels(read(`size-${name}`))}
                  </td>
                  <td className={cn(CELL, 'max-w-0')}>
                    <span
                      aria-hidden="true"
                      className="block h-3 max-w-full rounded-2xs bg-primary"
                      style={{ width: `var(--size-${name})` }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </SpecimenGroup>

      <SpecimenGroup title="Container widths" note="The widest a form, a text column and each dialog may get.">
        <div className="flex flex-col gap-2">
          {NAMED_CONTAINERS.map((name) => (
            <ContainerBar key={name} name={name} />
          ))}
        </div>
      </SpecimenGroup>

      <SpecimenGroup title="Radius" note="06 section 4. The radius follows the size of the element.">
        <ul className="flex flex-wrap gap-4">
          {NAMED_RADII.map((name) => (
            <RadiusTile key={name} name={name} />
          ))}
        </ul>
      </SpecimenGroup>

      <SpecimenGroup title="Shadow" note="06 section 6. Overlays only; panels are separated by borders.">
        <ul className="flex flex-wrap gap-6 p-2">
          {NAMED_SHADOWS.map((name) => (
            <li key={name} className="flex flex-col items-start gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  'block h-12 w-24 rounded-lg border border-border bg-surface-elevated',
                  SHADOW_CLASS[name],
                )}
              />
              <span className="type-mono text-foreground">{name}</span>
            </li>
          ))}
        </ul>
      </SpecimenGroup>

      <SpecimenGroup title="Layers" note="The z-index scale, lowest first. No other z-index value is allowed.">
        <TableScroll label="Layers">
          <table className="border-collapse type-table">
            <caption className="sr-only">The z-index tokens with their values</caption>
            <thead>
              <tr>
                <th scope="col" className={HEAD}>
                  Token
                </th>
                <th scope="col" className={HEAD}>
                  Value
                </th>
                <th scope="col" className={HEAD}>
                  Used for
                </th>
              </tr>
            </thead>
            <tbody>
              {Z_LAYERS.map((layer) => (
                <tr key={layer.name} className="border-t border-border-subtle">
                  <th scope="row" className={cn(CELL, 'text-left font-mono text-foreground')}>
                    z-{layer.name}
                  </th>
                  <td className={cn(CELL, 'num text-foreground-tertiary')}>
                    {read(`z-${layer.name}`) || 'Not read yet'}
                  </td>
                  <td className={cn(CELL, 'text-foreground-tertiary')}>{layer.use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </SpecimenGroup>
    </>
  );
}
