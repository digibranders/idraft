'use client';

import { ChevronDown, Maximize, Minimize, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useSearchDraft } from '../pages/search-draft';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { InputGroup } from '@/components/ui/input-group';
import { Menu } from '@/components/ui/menu';
import { MAP_LENSES, type MapLens } from '@/lib/internal-links/map-focus';
import type { MapColourMode } from '@/lib/internal-links/map-graph';

const SEARCH_MAX_LENGTH = 200;

const LENS_KEY = {
  none: 'lensNone',
  noIn: 'lensNoIn',
  deadEnd: 'lensDeadEnd',
  sitewide: 'lensSitewide',
} as const satisfies Record<MapLens, string>;

export interface MapToolbarProps {
  /** The search in the address; the box keeps its own text while it is typed. */
  query: string;
  /** "2 of 15 pages" while a search is lit, else empty. */
  found: string;
  includeAuto: boolean;
  colour: MapColourMode;
  lens: MapLens;
  maximised: boolean;
  onQuery: (value: string) => void;
  /** Enter in the search box. */
  onEnter: () => void;
  onIncludeAuto: (on: boolean) => void;
  onColour: (mode: MapColourMode) => void;
  onLens: (lens: MapLens) => void;
  onToggleFull: () => void;
}

interface ChoiceMenuProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}

/** One chip that opens a list of single choices, as the scope chip of every tab does. */
function ChoiceMenu<T extends string>({ label, value, options, onChange }: ChoiceMenuProps<T>): ReactElement {
  const t = useTranslations('internalLinks.map');
  const current = options.find((option) => option.value === value)?.label ?? '';
  return (
    <Menu
      trigger={
        <Button variant="secondary" size="sm" aria-label={t('menuName', { label, value: current })}>
          <span className="text-foreground-secondary">{t('chipLabel', { label })}</span>
          {current}
          <Icon icon={ChevronDown} size="sm" className="text-foreground-tertiary" />
        </Button>
      }
      items={options.map((option) => ({
        id: option.value,
        kind: 'radio' as const,
        label: option.label,
        checked: option.value === value,
        closeOnClick: true,
        onSelect: () => onChange(option.value),
      }))}
    />
  );
}

/** The search box, three choices and Full screen (W7, W11). */
export function MapToolbar(props: MapToolbarProps): ReactElement {
  const t = useTranslations('internalLinks.map');
  // The box keeps what is typed: the address holds the search trimmed and must not rewrite it under the caret
  const { draft, setDraft } = useSearchDraft(
    props.query === '' ? null : props.query,
    (next) => props.onQuery(next ?? ''),
    0,
  );
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle px-3 py-2">
      <InputGroup leadingIcon={Search} size="sm" className="max-w-80 min-w-0" style={{ flex: '1 1 12rem' }}>
        <Input
          size="sm"
          // The group draws the border and the focus ring, so the field inside draws neither
          variant="bare"
          type="search"
          value={draft}
          onValueChange={setDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') props.onEnter();
          }}
          placeholder={t('search')}
          maxLength={SEARCH_MAX_LENGTH}
          aria-label={t('searchLabel')}
        />
      </InputGroup>
      <span role="status" className="type-meta whitespace-nowrap text-foreground-secondary">
        {props.found}
      </span>
      <ChoiceMenu
        label={t('links')}
        value={props.includeAuto ? 'auto' : 'editorial'}
        options={[
          { value: 'editorial', label: t('linksEditorial') },
          { value: 'auto', label: t('linksAuto') },
        ]}
        onChange={(value) => props.onIncludeAuto(value === 'auto')}
      />
      <ChoiceMenu
        label={t('colour')}
        value={props.colour}
        options={[
          { value: 'tier', label: t('colourTier') },
          { value: 'section', label: t('colourSection') },
        ]}
        onChange={props.onColour}
      />
      <ChoiceMenu
        label={t('highlight')}
        value={props.lens}
        options={MAP_LENSES.map((lens) => ({ value: lens, label: t(LENS_KEY[lens]) }))}
        onChange={props.onLens}
      />
      <Button variant="secondary" size="sm" className="ml-auto" onClick={props.onToggleFull}>
        <Icon icon={props.maximised ? Minimize : Maximize} size="sm" className="text-foreground-tertiary" />
        {t(props.maximised ? 'leaveFullScreen' : 'fullScreen')}
      </Button>
    </div>
  );
}
