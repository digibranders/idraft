'use client';

import type { ReactNode } from 'react';

import { SpecimenGroup } from './specimen';
import { TableScroll } from './table-scroll';
import { CONTRAST_PAIRS, TOKEN_GROUPS } from './token-groups';
import { useTokenValues } from './use-token-values';
import { Badge } from '@/components/ui/badge';
import { contrastRatio, formatRatio, meetsContrast, parseColor, toHex } from '@/lib/design/contrast';
import { TEXT_SURFACES, TEXT_TOKENS } from '@/lib/design/contrast-requirements';

const TEXT_MINIMUM = 4.5;

/** The ratio of two tokens in the theme that is on, or `null` while their values cannot be read. */
function ratioOf(read: (name: string) => string, foreground: string, background: string): number | null {
  const first = parseColor(read(foreground));
  const second = parseColor(read(background));
  return first && second ? contrastRatio(first, second) : null;
}

/**
 * What a swatch says below its name: the sRGB hex value, as 02-color-system.md lists it, with the opacity
 * when the token has one. A value that is no plain color (a `color-mix()`) is shown as the browser gives it.
 */
function describeValue(value: string): string {
  if (value === '') return 'Not read yet';
  const color = parseColor(value);
  if (!color) return value;
  return color.alpha < 1 ? `${toHex(color)} at ${String(Math.round(color.alpha * 100))}%` : toHex(color);
}

function Swatch({ name, value }: { name: string; value: string }): ReactNode {
  return (
    <li className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className="size-10 shrink-0 rounded-md border border-border-subtle"
        style={{ backgroundColor: `var(--${name})` }}
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate type-mono text-foreground">{name}</span>
        <span className="truncate num type-meta">{describeValue(value)}</span>
      </span>
    </li>
  );
}

function Ratio({ ratio, required }: { ratio: number | null; required: number }): ReactNode {
  if (ratio === null) return <span className="text-foreground-tertiary">n/a</span>;
  const passes = meetsContrast(ratio, required);
  return (
    <span className={passes ? 'text-foreground' : 'text-negative-text'}>
      {formatRatio(ratio)}
      {passes ? null : <span className="sr-only"> (below the required {required}:1)</span>}
    </span>
  );
}

export function TokensSection(): ReactNode {
  const read = useTokenValues();
  return (
    <>
      {TOKEN_GROUPS.map((group) => (
        <SpecimenGroup key={group.title} title={group.title} note={group.note}>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.tokens.map((name) => (
              <Swatch key={name} name={name} value={read(name)} />
            ))}
          </ul>
        </SpecimenGroup>
      ))}

      <SpecimenGroup
        title="Text on surfaces"
        note="02 section 9. Contrast in the theme that is on; every cell has to reach 4.5:1."
      >
        <TableScroll label="Text on surfaces">
          <table className="w-full border-collapse num type-table">
            <caption className="sr-only">Contrast ratio of each text token on each surface</caption>
            <thead>
              <tr>
                <th scope="col" className="h-row-header px-2 text-left type-label">
                  Text token
                </th>
                {TEXT_SURFACES.map((surface) => (
                  <th key={surface} scope="col" className="h-row-header px-2 text-right type-label">
                    {surface}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TEXT_TOKENS.map((token) => (
                <tr key={token} className="border-t border-border-subtle">
                  <th scope="row" className="h-row-compact px-2 text-left type-mono text-foreground">
                    {token}
                  </th>
                  {TEXT_SURFACES.map((surface) => (
                    <td key={surface} className="h-row-compact px-2 text-right">
                      <Ratio ratio={ratioOf(read, token, surface)} required={TEXT_MINIMUM} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </SpecimenGroup>

      <SpecimenGroup
        title="Fills, tints and boundaries"
        note="Labels on fills need 4.5:1; the boundary of a control needs 3:1."
      >
        <TableScroll label="Fills, tints and boundaries">
          <table className="w-full border-collapse type-table">
            <caption className="sr-only">Contrast ratio of paired tokens against what they need</caption>
            <thead>
              <tr>
                {['Foreground', 'Background', 'Used for', 'Ratio', 'Needs', 'Result'].map((heading) => (
                  <th key={heading} scope="col" className="h-row-header px-2 text-left type-label">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CONTRAST_PAIRS.map((pair) => {
                const ratio = ratioOf(read, pair.foreground, pair.background);
                const passes = ratio !== null && meetsContrast(ratio, pair.required);
                return (
                  <tr key={`${pair.foreground}/${pair.background}`} className="border-t border-border-subtle">
                    <td className="h-row-compact px-2 type-mono text-foreground">{pair.foreground}</td>
                    <td className="h-row-compact px-2 type-mono text-foreground">{pair.background}</td>
                    <td className="h-row-compact px-2 text-foreground-secondary">{pair.use}</td>
                    <td className="h-row-compact px-2 num">
                      <Ratio ratio={ratio} required={pair.required} />
                    </td>
                    <td className="h-row-compact px-2 num text-foreground-secondary">{pair.required}:1</td>
                    <td className="h-row-compact px-2">
                      {ratio === null ? (
                        <Badge variant="text">Not read</Badge>
                      ) : passes ? (
                        <Badge tone="positive">Pass</Badge>
                      ) : (
                        <Badge tone="negative">Fail</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      </SpecimenGroup>
    </>
  );
}
