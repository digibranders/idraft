'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { BrandRowView } from './brand-row';
import { atTrackedLimit, sameBrand } from './competitor-model';
import { ListPopover } from './list-popover';
import { MarkedList, PresenceMark } from './presence-mark';
import { useAddedBrands } from './use-added-brands';
import {
  brandsOf,
  type BrandRow,
  type BrandsReading,
  type FactsRow,
  type PinnedOwnBrand,
  type TrackedEntity,
} from '../facts';
import type { PromptScope } from '../prompt-queries';
import { canWriteEntities, useMembership } from '@/lib/permissions';

/** How many names the cell shows before "+N". */
const NAMES_SHOWN = 3;

export interface BrandsCellProps {
  /** `brandsOf(rows, scope, entities)`: the cell draws a reading that has a list, the column words one that has not. */
  reading: BrandsReading;
  /** The rows the list is over: a prompt's own row, or the rows of a group. */
  rows: readonly FactsRow[];
  /** The tracked entities of the summary (own brand and competitors). */
  entities: readonly TrackedEntity[];
  /** What the list is about: "This prompt" or the group's name. */
  label: string;
  project: PromptScope;
  platformName: (code: string) => string;
}

/**
 * The Brands cell: a green check or a grey dash for the own brand, the first three names, and the list of the top ten
 * (the own brand pinned under it when it ranks lower). Generic over what the rows are, so the Groups tab uses it for a
 * group's prompts. A brand not in the competitor list has an Add button (`useAddedBrands`).
 */
export function BrandsCell({
  reading,
  rows,
  entities,
  label,
  project,
  platformName,
}: BrandsCellProps): ReactElement | null {
  const t = useTranslations('prompts.lists');
  const state = useAddedBrands(project);
  const canWrite = canWriteEntities(useMembership());
  const { shown, codes } = reading;
  if (reading.state !== 'ok' || shown.length === 0) return null;

  const platforms = codes.map(platformName).join(', ');
  const ownNamed = [...shown, ...(reading.own === null ? [] : [reading.own])].some(
    (row) => row.own && row.rate !== null && row.rate > 0,
  );
  // One prompt on one platform shows the counts beside the rate; one prompt on several lists each platform's in a tooltip
  const single = codes.length === 1 && reading.prompts === 1;
  const perPlatform =
    state.open && reading.prompts === 1 && codes.length > 1
      ? new Map(codes.map((code) => [code, brandsOf(rows, [code], entities)] as const))
      : null;
  const tipOf = (row: BrandRow | PinnedOwnBrand): string | undefined => {
    if (reading.prompts > 1) {
      return t('brands.meanTip', { count: reading.prompts }) + (codes.length > 1 ? t('brands.averagedTip') : '');
    }
    if (perPlatform === null) return undefined;
    const counts = codes.flatMap((code) => {
      const found = perPlatform.get(code)?.shown.find((other) => sameBrand(other.name, row.name))?.counts;
      return found === undefined || found === null
        ? []
        : [t('brands.platformCountTip', { platform: platformName(code), k: found.k, n: found.n })];
    });
    return counts.length === 0 ? undefined : counts.join(', ');
  };
  // A brand added here counts once, also after the summary has been read again and lists it among the entities
  const trackedCount =
    entities.length +
    [...state.added.keys()].filter((name) => !entities.some((entity) => sameBrand(entity.name, name))).length;
  const rowView = (row: BrandRow | PinnedOwnBrand): ReactElement => (
    <BrandRowView
      key={row.name}
      row={row}
      added={state.find(row.name)}
      colorIndex={state.entries.find((entry) => entry.entity.entity_id === row.entityId)?.color_index ?? null}
      single={single}
      tip={tipOf(row)}
      limitReached={atTrackedLimit(trackedCount)}
      trackedCount={trackedCount}
      canWrite={canWrite}
      onAdd={state.add}
    />
  );

  return (
    <MarkedList mark={<PresenceMark present={ownNamed} yes={t('brands.ownPresent')} no={t('brands.ownAbsent')} />}>
      <ListPopover
        open={state.open}
        onOpenChange={state.setOpen}
        label={t('brands.openLabel', { label, count: reading.total })}
        title={t('brands.title')}
        subtitle={t('brands.subtitle', {
          label,
          platforms:
            codes.length === 1
              ? t('brands.onlyPlatform', { platform: platforms })
              : t('brands.averagePlatforms', { platforms }),
          answers: t('answers', { count: reading.answers }),
        })}
        note={t('brands.note')}
        pinned={reading.own === null ? undefined : rowView(reading.own)}
        trigger={
          <>
            <span className="truncate">
              {shown
                .slice(0, NAMES_SHOWN)
                .map((row) => row.name)
                .join(', ')}
            </span>
            {shown.length > NAMES_SHOWN ? (
              <span className="shrink-0 type-label text-foreground-tertiary">+{shown.length - NAMES_SHOWN}</span>
            ) : null}
          </>
        }
      >
        {shown.map(rowView)}
      </ListPopover>
    </MarkedList>
  );
}
