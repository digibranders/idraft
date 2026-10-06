# 09. Buttons and Controls

Status: Accepted (design-system v2)
Last updated: 2026-09-29
Implementation: `apps/web/src/components/ui/` (`button.tsx`, `icon-button.tsx`, `split-button.tsx`, `toggle-button.tsx`, `segmented-control.tsx`, `toolbar.tsx`, `copy-button.tsx`, `checkbox.tsx`, `radio-group.tsx`, `switch.tsx`, `slider.tsx`, `menu.tsx`, `tabs.tsx`, `pagination.tsx`, `kbd.tsx`), built on `@base-ui/react` 1.8 with `class-variance-authority` and `cn`.
Depends on: [02-color-system.md](02-color-system.md), [03-typography.md](03-typography.md), [04-spacing-density.md](04-spacing-density.md), [06-surfaces-borders-radius.md](06-surfaces-borders-radius.md), [07-icons.md](07-icons.md), [08-interaction-states.md](08-interaction-states.md). Form fields are in [10-forms.md](10-forms.md).

## 1. Scope and rules that apply to every control

This document defines every clickable control that is not a text field: buttons, icon buttons, split buttons, toggles, segmented controls, toolbars, checkboxes, radios, switches, sliders, menu buttons, tabs, count tabs, pagination and keyboard hints. Text entry, selects and pickers are in [10-forms.md](10-forms.md); popover and menu surfaces are in [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md).

Rules shared by every control in this file:

1. **Heights come from three tokens only**: `h-control-sm` (32 px: pagination, toolbars, icon buttons in tables and inspectors), `h-control` (36 px, default), `h-control-lg` (40 px, auth and onboarding only). Icon-only squares are 24, 32 or 36 px.
2. **Minimum target is 24 by 24 px** (WCAG 2.5.8). A visual element smaller than 24 px (checkbox box, radio, switch, slider thumb) sits inside a 24 px hit area.
3. **Focus is the global ring**: `focus-visible:focus-ring` (2 px `ring`, 2 px offset). Controls inside table cells and menus, tabs and segmented control items use `focus-visible:focus-ring-inset`. No control removes the outline.
4. **State comes from Base UI data attributes** (`data-disabled`, `data-pressed`, `data-checked`, `data-indeterminate`, `data-selected`, `data-highlighted`, `data-popup-open`), never from class toggling in React. State precedence follows [08-interaction-states.md](08-interaction-states.md) section 1: disabled, loading, error, selected, focus, hover.
5. **Composition uses the `render` prop**, not `asChild`. A Base UI trigger renders our `Button`: `<Menu.Trigger render={<Button variant="secondary" />}>`. A `Button` that renders a non-button element sets `nativeButton={false}`.
6. **Transitions** are color only: `transition-colors duration-(--duration-fast) ease-standard`. No scale, no translate on press, no shadow change. Reduced motion sets the duration token to 0 ms.
7. **Colors are tokens.** No component in this file uses opacity to derive a color.

## 2. Button

### 2.1 Anatomy

```
 ┌──────────────────────────────┐
 │ [icon] 8px  Label            │   height: 32 / 36 / 40
 └──────────────────────────────┘
   ^ px-2 (sm), px-3 (md), px-4 (lg)
```

- Leading icon only. The two trailing exceptions are the chevron on menu and split triggers and the `ExternalLink` icon on external links ([07-icons.md](07-icons.md) section 3).
- Icon to label gap is 8 px (`gap-2`) at every size ([04-spacing-density.md](04-spacing-density.md) section 1.1).
- Label text is `type-body-strong` (14 px, weight 500) at every size, including `sm`. The small size is smaller because of height and padding, not type. 12 px button labels were rejected: they fall below the 13 px table text beside them and make toolbar buttons read as metadata.
- Buttons hug their content. There is no minimum width. `w-full` is allowed only for `lg` buttons in auth and onboarding layouts.
- Labels never wrap and never truncate ([03-typography.md](03-typography.md) section 5).

### 2.2 Sizes

| Size | Height | Horizontal padding | Label | Icon | Where |
|---|---|---|---|---|---|
| `sm` | 32 px `h-control-sm` | 8 px `px-2` | `type-body-strong` 14 px | 14 px `size-icon-sm` | Table toolbars, inline table actions, pagination, inspector header actions, split button halves in toolbars |
| `md` (default) | 36 px `h-control` | 12 px `px-3` | `type-body-strong` 14 px | 16 px `size-icon` | Page header actions, top-bar date range and location, filter bar (scope controls and filter buttons), dialog and inspector footers, forms, empty states, settings save bar |
| `lg` | 40 px `h-control-lg` | 16 px `px-4` | `type-body-strong` 14 px | 16 px `size-icon` | Auth screens and the onboarding primary action only |
| `icon-xs` | 24 by 24 px `size-6` | 0 | none | 14 px | Row hover actions inside table rows, clear buttons inside inputs |
| `icon-sm` | 32 by 32 px `size-control-sm` | 0 | none | 14 px | Table toolbar, inspector header (close, more, previous and next), dialog header close |
| `icon` | 36 by 36 px `size-control` | 0 | none | 16 px (18 px `size-icon-md` in the top bar) | Page header, top bar. Exception: top bar icon buttons use an 18 px icon ([07-icons.md](07-icons.md) section 2) |

`px-2.5` (10 px) was considered for `sm` and rejected because 2.5 is not a step on the spacing scale ([04-spacing-density.md](04-spacing-density.md) section 1).

### 2.3 Variants

All variants share the base: `relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border type-body-strong select-none transition-colors duration-(--duration-fast) ease-standard focus-visible:focus-ring`.

| Variant | Normal | Hover | Pressed (`:active`) | Use |
|---|---|---|---|---|
| `primary` | `bg-primary text-primary-foreground border-transparent` (solid cobalt, white label) | `bg-primary-hover` | `bg-primary-hover` | The single most important action of a region |
| `secondary` (default) | `bg-surface text-foreground border-border` | `bg-surface-hover` | `bg-surface-selected` | Most actions: page header secondary actions, dialog Cancel, Export, Import, filter buttons (with a trailing chevron, [13-filters-search.md](13-filters-search.md) section 2) |
| `subtle` | `bg-surface-subtle text-foreground border-transparent` | `bg-surface-hover` | `bg-surface-selected` | Low-emphasis actions on `surface` where an outline adds noise: "Load more" in lists, "Add condition" (the filter bar's "+ Filter" is `ghost`, [13-filters-search.md](13-filters-search.md) section 2) |
| `ghost` | `bg-transparent text-foreground-secondary border-transparent` | `bg-surface-hover text-foreground` | `bg-surface-selected text-foreground` | Toolbar buttons, icon buttons, tertiary actions ("Discard", inline "Cancel") |
| `destructive` | `bg-surface text-negative-text border-negative-border` | `bg-negative-subtle` | `bg-negative-subtle border-negative-solid` | Inline destructive actions that open a confirmation: "Remove", "Disconnect", "Delete project" |
| `destructive-solid` | `bg-negative-button text-negative-button-foreground border-transparent` | `bg-negative-button-hover` | `bg-negative-button-hover` | The confirm button inside a destructive confirmation dialog, nowhere else |
| `link` | `bg-transparent text-link border-transparent h-auto px-0 underline-offset-2` | `underline` | `underline` | Inline actions inside sentences and helper text ("Reset", "View all 48") |

Every hover and pressed class is written with `not-data-disabled:` (for example `not-data-disabled:hover:bg-primary-hover`) so disabled buttons never react to the pointer.

Contrast of `destructive-solid`: `negative-button-foreground` (near-white in both themes) on `negative-button` and `negative-button-hover` meets 4.5:1 in both themes; both pairs are asserted in `tokens.contrast.test.ts` (verified 2026-09-29).

### 2.4 States

| State | Treatment | Mechanism |
|---|---|---|
| Hover | Per variant table. Cursor stays `default` (only links and clickable rows get `pointer`, [08-interaction-states.md](08-interaction-states.md) section 1) | `:hover` |
| Pressed | Per variant table. No transform | `:active` |
| Focus | 2 px `ring`, 2 px offset, drawn over every other state | `:focus-visible` |
| Disabled | All variants except `ghost` and `link`: `bg-surface-disabled text-foreground-disabled border-transparent`. `ghost` and `link`: transparent background, `text-foreground-disabled`, no underline. Icons inherit the text color. `cursor-not-allowed` | `data-disabled` |
| Disabled with reason | Rendered with `focusableWhenDisabled` so keyboard users reach it; a tooltip on hover and focus says why ("Requires the Editor role", "Select keywords first") | Base UI `focusableWhenDisabled`, Tooltip |
| Loading | Keeps its variant colors and its width. The leading icon is replaced by a 14 px (`sm`) or 16 px (`md`, `lg`) `Spinner`. A button without a leading icon keeps its label in layout at `opacity-0` and centers the spinner over it. `aria-busy="true"`, `aria-disabled="true"`, clicks ignored, `cursor-progress`. Shown only after the mutation has run 400 ms | `aria-busy`, component prop `loading` |

Rules for loading:
- The label text stays in the DOM (with `opacity-0`, never `invisible` or `display: none`) so the accessible name does not change and the width does not jump.
- Loading does not use the disabled style: a greyed primary button reads as "not allowed", while a blue button with a spinner reads as "working".
- The spinner is `LoaderCircle` with `motion-safe:animate-spin`. Under reduced motion it is static and `aria-busy` carries the state.

Tokens used by this section (added 2026-09-29): `--negative-button`, `--negative-button-hover`, `--negative-button-foreground` (a dedicated fill for the solid destructive button, darker than `--negative-solid` so white text passes in both themes), and `--animate-spin` (800 ms linear) registered in `globals.css` because the theme reset removes Tailwind's default animations.

### 2.5 Labels

| Rule | Correct | Wrong |
|---|---|---|
| Verb first | "Add keywords", "Export CSV", "Run check" | "Keywords", "New" |
| Maximum 3 words, counting numbers as words | "Delete 12 keywords" | "Delete the selected keywords now" |
| Sentence case | "Add competitor" | "Add Competitor", "ADD" |
| Name the object when the region does not | "Save changes", "Remove competitor" | "OK", "Yes", "Submit", "Confirm" |
| Destructive labels name what is lost | "Delete project", "Disconnect Cloudflare" | "Delete", "Continue" |
| Counts use `formatInteger` | "Import 1,204 keywords" | "Import 1204 keywords" |
| No ellipsis, no trailing punctuation, no emoji | "Rename" | "Rename…" |
| Same action, same word everywhere | "Remove" for detaching from a project, "Delete" for destroying data | Mixing both for one operation |

Cancel buttons read "Cancel". Buttons that close a dialog without consequence read "Close". A dialog that has only read-only content has one "Close" button and no primary.

### 2.6 Placement

| Region | Order and alignment |
|---|---|
| Page header | Right aligned. Secondary actions first, primary rightmost, `gap-2` |
| Dialog footer | Right aligned, `gap-2`: "Cancel" (`secondary`) then the primary (`primary` or `destructive-solid`) rightmost. A destructive outline action in a non-destructive dialog sits left aligned in the same footer |
| Inspector footer | Same as dialog footer |
| Settings save bar | Right aligned inside the form column: "Discard" (`ghost`), "Save changes" (`primary`) ([10-forms.md](10-forms.md) section 13) |
| Empty state | Centered under the explanation: one `primary` plus at most one `secondary` |
| Table toolbar | Left: bulk actions when rows are selected. Right: view controls (columns, density, export). All `sm` |
| Table row | No visible buttons at rest. Hover and focus reveal up to 2 `icon-xs` actions plus a "More" menu ([12-tables.md](12-tables.md)) |

**Maximum one `primary` per region.** A region is a page header, a dialog, an inspector, an empty state or a save bar. A page therefore has at most one primary in its header; a table toolbar never has one, except the "Apply" button of an open inline form, which is a region of its own ([10-forms.md](10-forms.md) section 16). When two actions compete, the more frequent one is primary and the other is `secondary`.

**Destructive placement.** Destructive actions are never the rightmost button in a region that also has a primary, never adjacent to the primary, and never the default focus. In row menus they are the last item, below a separator, in `text-negative-text`. Reversible bulk actions (archive, pause) use `secondary` and an undo toast instead of confirmation, except that a bulk action on more than 100 rows always opens a confirmation that states the count ([20-accessibility.md](20-accessibility.md) section 2, WCAG 3.3.4). Irreversible actions always open a confirmation dialog whose confirm button is `destructive-solid` and whose initial focus is "Cancel" ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md)).

### 2.7 Keyboard

- Buttons are native `<button>` elements through Base UI `Button`: Enter and Space activate.
- `type="button"` is the default in our component. Only the form's submit button sets `type="submit"`, so Enter in a text field submits exactly one action.
- A shortcut assigned to a button is exposed with `aria-keyshortcuts` and shown in its tooltip as a `Kbd` (section 11). Buttons do not show shortcut hints inline, except the command palette trigger.
- An action that navigates is a link that looks like a button: `<LinkButton render={<Link href="/…" />}>` from `ui/link-button.tsx`, which puts `buttonVariants` on the link. It behaves as a link (Enter only, middle-click opens a tab) and is announced as one. `Button` with `nativeButton={false}` is not used for this: Base UI gives whatever it renders the button role.

### 2.8 Button groups

- Related buttons sit in a flex row with `gap-2` (8 px), or `gap-1.5` (6 px) inside a toolbar.
- Buttons are never visually attached (shared borders) except in the split button (section 4) and the segmented control (section 6).
- A group contains at most 3 visible buttons. Further actions go into a "More" menu (`icon-sm` or `icon` with `Ellipsis`, label "More actions").

### 2.9 CVA definition

```tsx
// apps/web/src/components/ui/button.tsx
import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import type { MouseEvent, ReactElement } from 'react';
import { Icon } from './icon';
import { Spinner } from './spinner';

export const buttonVariants = cva(
  'relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border ' +
    'type-body-strong select-none transition-colors duration-(--duration-fast) ease-standard ' +
    'focus-visible:focus-ring aria-busy:cursor-progress data-disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        primary:
          'border-transparent bg-primary text-primary-foreground not-data-disabled:hover:bg-primary-hover ' +
          'not-data-disabled:active:bg-primary-hover',
        secondary:
          'border-border bg-surface text-foreground not-data-disabled:hover:bg-surface-hover ' +
          'not-data-disabled:active:bg-surface-selected',
        subtle:
          'border-transparent bg-surface-subtle text-foreground not-data-disabled:hover:bg-surface-hover ' +
          'not-data-disabled:active:bg-surface-selected',
        ghost:
          'border-transparent bg-transparent text-foreground-secondary not-data-disabled:hover:bg-surface-hover ' +
          'not-data-disabled:hover:text-foreground not-data-disabled:active:bg-surface-selected',
        destructive:
          'border-negative-border bg-surface text-negative-text not-data-disabled:hover:bg-negative-subtle ' +
          'not-data-disabled:active:border-negative-solid',
        'destructive-solid':
          'border-transparent bg-negative-button text-negative-button-foreground ' +
          'not-data-disabled:hover:bg-negative-button-hover not-data-disabled:active:bg-negative-button-hover',
        link:
          'border-transparent bg-transparent text-link underline-offset-2 not-data-disabled:hover:underline',
      },
      size: {
        sm: 'h-control-sm px-2',
        md: 'h-control px-3',
        lg: 'h-control-lg px-4',
        'icon-xs': 'size-6 px-0',
        'icon-sm': 'size-control-sm px-0',
        icon: 'size-control px-0',
      },
    },
    compoundVariants: [
      { variant: 'link', className: 'h-auto px-0' },
      {
        variant: ['primary', 'secondary', 'subtle', 'destructive', 'destructive-solid'],
        className:
          'data-disabled:border-transparent data-disabled:bg-surface-disabled data-disabled:text-foreground-disabled',
      },
      { variant: ['ghost', 'link'], className: 'data-disabled:text-foreground-disabled' },
    ],
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

export interface ButtonProps extends ButtonPrimitive.Props, ButtonVariantProps {
  /** Leading icon. Replaced by the spinner while loading. */
  icon?: LucideIcon;
  /** Set by the caller after the mutation has been pending for 400 ms. */
  loading?: boolean;
}

const SMALL_ICON_SIZES: ReadonlySet<ButtonVariantProps['size']> = new Set(['sm', 'icon-xs', 'icon-sm']);

export function Button({
  variant,
  size,
  icon,
  loading = false,
  className,
  children,
  onClick,
  type = 'button',
  ...props
}: ButtonProps): ReactElement {
  const small = SMALL_ICON_SIZES.has(size);   // Icon sizes are 'sm' (14 px) and 'default' (16 px); Spinner sizes are 'sm' and 'md'
  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <ButtonPrimitive
      type={type}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={handleClick}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? (
        <Spinner size={small ? 'sm' : 'md'} className={icon ? undefined : 'absolute inset-0 m-auto size-fit'} />
      ) : icon ? (
        <Icon icon={icon} size={small ? 'sm' : 'default'} />
      ) : null}
      <span className={cn(loading && !icon && 'opacity-0')}>{children}</span>
    </ButtonPrimitive>
  );
}
```

The sketch above shows the structure. The source of truth is `apps/web/src/components/ui/button.tsx` for the component and `ui/button-variants.ts` for `buttonVariants` (a module without `'use client'`, so a Server Component and `LinkButton` can call it). The code differs in four details found while building it: every hover and pressed class is written as `not-aria-busy:not-data-disabled:hover:…`, so a loading button keeps its resting fill under the pointer ([08-interaction-states.md](08-interaction-states.md) section 1 puts loading above hover); `aria-busy` and `aria-disabled` are written only while loading (writing them as `undefined` erased the `aria-disabled` Base UI sets on a disabled button that stays focusable); the label is wrapped in the `opacity-0` span only while loading without an icon; and the pressed state of `ghost` and `destructive` repeats the hover fill, as the variant table says.

`className` on a `Button` may set layout only (margin, width, flex, grid placement). Changing color, height, padding or radius through `className` is rejected in review; lint flags color and height utilities passed to `Button` from feature code.

### 2.10 Variant or new component

Add a **variant** only when all of these hold: the element, anatomy and behavior are identical to `Button`; only color tokens or size differ; it is needed on at least three screens; and it is added to this document and the design-system preview first ([00-design-principles.md](00-design-principles.md) section 7).

Create a **new component** when any of these hold: it requires a prop that `Button` does not (an accessible label for icon-only, a pressed state, a menu), it owns state (copy feedback), it renders a different element (an anchor to another origin), or its keyboard model differs. That is why `IconButton`, `ToggleButton`, `SplitButton`, `CopyButton` and `ExternalLinkButton` are separate components that reuse `buttonVariants`.

## 3. Icon button

`IconButton` wraps `Button` with a required `label: string` prop. It sets `aria-label={label}`, wraps the button in a `Tooltip` showing the same text (400 ms delay, shortcut appended as `Kbd`), and accepts only the sizes `icon-xs`, `icon-sm` and `icon`. Default variant is `ghost`: no border, icon in `foreground-secondary`, darker (`foreground`) on hover.

| Size | Box | Icon | Use |
|---|---|---|---|
| `icon-xs` | 24 px | 14 px | Row actions, input adornments (clear, reveal) |
| `icon-sm` | 32 px | 14 px | Toolbars, tables, inspector header, dialog close |
| `icon` | 36 px | 16 px (18 px in the top bar) | Page header, top bar. Top bar icon buttons use an 18 px icon (`size-icon-md`, [07-icons.md](07-icons.md) section 2) |

Icon-only is allowed only for the actions listed in [07-icons.md](07-icons.md) section 4. The tooltip and `aria-label` never include the word "button".

## 4. Split button

A primary action plus a menu of alternatives, for example "Export" (default CSV) with "Export XLSX" and "Schedule export" in the menu.

```
 ┌────────────┬────┐
 │ ⤓  Export  │ ▾  │
 └────────────┴────┘
   action      Menu.Trigger (icon-sm or icon square)
```

- Two sibling buttons in an `inline-flex` wrapper with `role="group"` and `aria-label` naming the action ("Export options").
- Left half: `rounded-r-none`. Right half: `rounded-l-none`, `-ml-px` so borders overlap, square at the button height, `ChevronDown` 14 px, accessible name "More export options". It is a Base UI `Menu.Trigger`.
- Allowed variants: `secondary` (default) and `primary`. For `primary`, the right half has `border-l border-l-primary-hover` as the divider.
- The menu never repeats the default action. Use a split button only when the default is chosen at least 80% of the time; otherwise use a menu button (section 10).

## 5. Toggle button

`ToggleButton` is Base UI `Toggle` rendering `buttonVariants`. It represents a persistent on/off view option inside a toolbar: "Patterns" on charts, "Show annotations", "Pin identity column".

| State | Treatment |
|---|---|
| Off | `ghost` variant styles |
| On (`data-pressed`) | `bg-surface-selected text-foreground`; icon in `text-primary-text` |
| Hover while on | stays `bg-surface-selected` |

- `aria-pressed` is set by Base UI. The label does not change between states (APG button pattern: a label that flips "Show"/"Hide" confuses the pressed semantics).
- Sizes `sm` and `icon-sm`. An icon-only toggle follows the `IconButton` rules (label plus tooltip).
- A toggle never triggers a mutation. Settings with immediate effect use a `Switch` (section 8.3).

## 6. Segmented control

One visual component with three semantic implementations. The visual:

```
 ┌──────────┬──────────┬──────────┐  group: bg-surface, 1 px border, rounded-md,
 │    7d    │   30d    │ ┃ 90d  ┃ │         1 px border dividers between items
 └──────────┴──────────┴──────────┘  selected: bg-primary-subtle, 1 px primary-border outline,
                                               text-primary-text, weight 500
```

| Size | Height | Item padding | Label | Icon | Where |
|---|---|---|---|---|---|
| `sm` | 32 px `h-control-sm` | `px-2` | `type-body` (14 px); selected `type-body-strong` | 14 px | Chart modes inside panels, table toolbar view options |
| `md` | 36 px `h-control` | `px-3` | `type-body` (14 px); selected `type-body-strong` | 16 px | Page header view options (period "7d, 30d, 90d"), forms |

Items fill the full height of the group; there is no inner track padding.

**Construction.** Each item draws its own 1 px border; items overlap by 1 px (`-ml-px` on every item after the first), so neighbouring borders form single dividers. The first item takes `rounded-l-md`, the last `rounded-r-md`, and middle items stay square. The selected item is `relative`, so its `primary-border` outline paints above the neighbouring borders and follows the rounded outer corner exactly. Do not build the group as one bordered, `overflow-hidden` box with an inset ring on the selected item: the ring cannot follow the clipped corner and shows square corners at the rounded end (seen and fixed in the preview on 2026-09-30).

| Item state | Classes |
|---|---|
| Unselected | `bg-surface text-foreground-secondary`, weight 400 |
| Hover (unselected) | `bg-surface-hover text-foreground` |
| Selected | `bg-primary-subtle text-primary-text`, weight 500, with a 1 px `primary-border` outline that replaces the dividers on both sides; outer corners follow the group radius |
| Focus | `focus-visible:focus-ring-inset` on the item, drawn over the selected outline |
| Disabled | `text-foreground-disabled`, no hover |

- **Decision (v2, reverses v1).** The selected segment uses the accent tint: `primary-subtle` fill, `primary-border` outline and a `primary-text` label at weight 500. v1 kept the selected segment neutral (`bg-surface`, `border-strong`) and did not allow the accent here. The accent may therefore mark a selected segment, in the same family as the active navigation item and the active tab.
- Selection is shown by three cues together: the tinted fill with its outline, the label color, and the label weight (400 to 500). The weight change is the cue that does not depend on color (WCAG 1.4.1). `aria-checked` or `aria-selected` carries the state for assistive technology.
- Each item reserves the width of its weight 500 label (a visually hidden, `aria-hidden` copy of the label in weight 500 sets the item width), so selecting an item never shifts the layout.
- The group outline and the dividers between items are `border`. The light outline passes WCAG 1.4.11 because the boundary is not what identifies the control: every segment has a visible label, and the selected one has the `primary-border` outline and the weight 500 label ([20-accessibility.md](20-accessibility.md) section 3.2, rule 6).
- View controls take 2 to 5 items; a segmented control that sets a form value takes 2 to 4 ([10-forms.md](10-forms.md) section 9). Each label is at most 2 words. More options use a `Select`.
- Items share equal width only when all labels are within 4 characters of each other; otherwise they hug content.

Semantics, chosen by what the control does:

| Purpose | Base UI primitive | Pattern | Example |
|---|---|---|---|
| Switches a view option on the current screen | `RadioGroup` styled as segments (single value, empty value rejected in `onValueChange`), named by `aria-label` | Radio group, `role="radiogroup"` with `role="radio"` items and `aria-checked`; arrow keys move and select, Tab leaves | Density toggle, chart or table view, "Absolute or Share" |
| Switches which panel is shown | `Tabs` (section 12, `variant="segmented"`) | Tabs, `role="tablist"` | Chart modes inside a panel |
| Sets a form value | `RadioGroup` styled as segments, named by a `Fieldset.Legend` | Radio group, `role="radiogroup"` | Device: Desktop, Mobile, Both ([10-forms.md](10-forms.md) section 9) |

A single-choice segmented control is always a radio group. `aria-pressed` is used only for independent on/off toggles (`ToggleButton`, section 5, such as "Patterns" or legend items), never for one choice out of several ([20-accessibility.md](20-accessibility.md) section 5).

## 7. Toolbar

Base UI `Toolbar` groups the icon and text buttons of a table or chart header so the group is one Tab stop and arrow keys move within it (APG toolbar pattern).

| Property | Value |
|---|---|
| Container | `Toolbar.Root`, `flex items-center gap-1.5`, `aria-label` naming the target ("Keyword table actions") |
| Controls | `Toolbar.Button render={<Button size="sm" variant="ghost" />}` or `icon-sm` icon buttons. All controls in a toolbar are 32 px |
| Groups | `Toolbar.Group` with `gap-1.5` |
| Separator | `Toolbar.Separator`, `h-6 w-px bg-border-subtle` (6 px each side from the flex gap) |
| Keyboard | Tab enters and leaves; Left and Right move; Home and End jump; focus wraps (`loopFocus`) |
| Search field | Sits outside `Toolbar.Root`, to its left, so arrow keys keep editing text |

## 8. Selection controls

### 8.1 Checkbox

Base UI `Checkbox.Root` and `Checkbox.Indicator`; groups use `CheckboxGroup` ([10-forms.md](10-forms.md) section 7).

| Part | Spec |
|---|---|
| Box | 16 px `size-4`, `rounded-sm` (4 px), `border border-border-strong bg-surface` |
| Hit area | 24 px `size-6` wrapper, box centered; the label extends the hit area |
| Checked | Solid cobalt: `data-checked:bg-primary data-checked:border-primary`; white `Check` icon 12 px (`size-icon-xs`) in `text-primary-foreground` |
| Indeterminate | `data-indeterminate:bg-primary data-indeterminate:border-primary`; `Minus` icon 12 px |
| Hover | Unchecked: `bg-surface-hover`. Checked: `bg-primary-hover` |
| Focus | Ring on the box: `focus-visible:focus-ring` (inset variant inside table cells) |
| Disabled | `border-border bg-surface-disabled`; checked and disabled: `bg-foreground-disabled border-transparent`; label `text-foreground-disabled` |
| Invalid | `border-negative-solid` |
| Label | `type-body text-foreground`, 8 px gap (`gap-2`), clicking the label toggles |

- Indeterminate is used only for a parent that controls children ("Select all" in tables and groups). Clicking an indeterminate box checks all children.
- A standalone checkbox in a form means "I agree" or a boolean that takes effect on save. A boolean with immediate effect is a `Switch`.
- `primary` on `surface` measures 5.2:1 (light) and 3.8:1 (dark), above the 3:1 needed for a checked state.

### 8.2 Radio

Base UI `RadioGroup` and `Radio.Root` with `Radio.Indicator`.

| Part | Spec |
|---|---|
| Circle | 16 px `size-4` (the same size as the checkbox, [reference/visual-spec.md](reference/visual-spec.md) section 6), `rounded-full`, `border border-border-strong bg-surface`, inside a 24 px hit area |
| Checked | `data-checked:bg-primary data-checked:border-primary`; indicator dot 6 px `size-1.5 rounded-full bg-primary-foreground` |
| Hover, focus, disabled, invalid | As checkbox |
| Label | `type-body text-foreground`, `gap-2`; optional description in `type-meta` below the label, aligned to the label's left edge |

Radios are always in a group of at least two with a visible legend. A group never starts with nothing selected unless "no choice" is a valid answer and the schema allows `undefined`.

### 8.3 Switch

Base UI `Switch.Root` and `Switch.Thumb`.

| Part | Spec |
|---|---|
| Track | 36 by 20 px (`w-9 h-5`), `rounded-full`, inside a 24 px tall hit area |
| Off | Track `bg-border-strong`, thumb `bg-surface` |
| On | Cobalt track `bg-primary`, white thumb `bg-primary-foreground` |
| Thumb | 16 px `size-4`, `rounded-full`, 2 px inset; moves 16 px (`data-checked:translate-x-4`) with `transition-transform duration-(--duration-fast)` |
| Hover | Off: `bg-foreground-muted`. On: `bg-primary-hover` |
| Disabled | Track `bg-surface-disabled` with `border border-border`, thumb `bg-foreground-disabled` |
| Label | Left of the switch in a `SettingRow` (label and `type-meta` description on the left, switch right aligned) |

**A switch is only for settings that take effect immediately** and are saved on toggle (notification preferences, "Pause collection", "Show favicons"). A switch never appears in a form with a save bar and never inside a filter. The rationale is expectation: a switch looks like a physical control, so users expect the change to apply the moment it flips. Success shows no toast: the switch position is the confirmation. Behavior on failure (optimistic revert and inline error) is in [10-forms.md](10-forms.md) section 13.3.

### 8.4 Slider

Base UI `Slider` (`Root`, `Control`, `Track`, `Indicator`, `Thumb`). Used rarely: only for thresholds that are easier to judge visually than numerically, such as the rank threshold and AI rate threshold that split the SEO and AI matrix into quadrants.

| Part | Spec |
|---|---|
| Track | 4 px `h-1`, `rounded-full bg-border` |
| Indicator | `bg-primary` |
| Thumb | 14 px `size-3.5 rounded-full bg-surface border border-border-strong`; hit area extended to 26 px with `before:absolute before:-inset-1.5` |
| Focus | Ring on the thumb |
| Value display | A `NumberInput` beside the slider (`w-30`, [10-forms.md](10-forms.md) section 11) bound to the same value; typing and dragging stay in sync |

- `getAriaValueText` returns text from `@/lib/format` ("rank 10", "35.0%").
- Keyboard: Left and Down decrease by one step, Right and Up increase, Page Up and Page Down move 10 steps, Home and End go to limits.
- Every slider has a paired numeric input, because a slider alone cannot set an exact value (WCAG 2.5.7 dragging alternative is provided by keys and the input).

## 9. Copy button and external link button

### 9.1 CopyButton

| Aspect | Spec |
|---|---|
| Forms | Icon-only `IconButton` with `Copy` (default, label "Copy", or "Copy URL", "Copy ID"), or labeled `sm`/`md` `secondary` "Copy" for secrets shown once |
| What is copied | The original value, never the display string: full URL (not the truncated path), raw ID, full key |
| Success | Icon swaps to `Check` in `text-positive-text` for 1.5 s; tooltip reads "Copied"; a visually hidden `aria-live="polite"` region announces "Copied" ([08-interaction-states.md](08-interaction-states.md) section 5) |
| Failure | Clipboard API rejects: toast "Could not copy. Select the text and copy it manually." and the value is selected in its field |
| Keyboard | Standard button; focus stays on the button after copying |

As built for table cells (the first use, Rankings): `app/cells/copy-button.tsx`, because `ui/` may not import the announcer or the clipboard helper (26 section 2, rule 1). It takes `text`, `label` and `announcement` and shows the check for 2 seconds. When the Clipboard API is missing or rejects it selects and copies a temporary read-only field (`lib/dom/clipboard.ts`), and only when that fails too does it show the error toast "Could not copy. Select the text and copy it yourself." It is `icon-xs` (24 px), out of the tab order and marked for the grid ([12-tables.md](12-tables.md) section 9, "Controls in a cell").

### 9.2 ExternalLinkButton

Renders `ExternalLink` ([20-frontend-specification.md](../20-frontend-specification.md) section 7.2) with `buttonVariants`: `target="_blank"`, `rel="noopener noreferrer nofollow"`, scheme check, trailing `ExternalLink` icon (14 px at `sm`, 16 px at `md`) in `text-foreground-muted`, and visually hidden text "(opens in a new tab)" appended to the accessible name. Variants: `secondary` or `link`. Label names the destination: "Open in GSC", "View SERP".

## 10. Menu button

Base UI `Menu` (`Trigger`, `Portal`, `Positioner`, `Popup`, `Item`, `CheckboxItem`, `RadioGroup`, `RadioItem`, `Separator`, `Group`, `GroupLabel`, `SubmenuRoot`, `SubmenuTrigger`).

| Part | Spec |
|---|---|
| Trigger | `Button` (any variant) with trailing `ChevronDown` 14 px in `text-foreground-muted`, or the `Ellipsis` `IconButton` "More actions". `data-popup-open` keeps the pressed background while open (`surface-selected` for `secondary`, `subtle` and `ghost`, written in `buttonVariants`) |
| Positioner | `sideOffset={4}`, `align="start"` (end for triggers at the right edge of a region), `z-(--z-dropdown)` |
| Popup | `min-w-menu-min max-w-menu-max` (180 to 280 px, content-sized, [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 5.2), `max-h-[min(var(--size-popover-max-h),var(--available-height))] rounded-lg border border-border bg-surface-elevated p-1 shadow-popover`, entry and exit on `data-starting-style` and `data-ending-style`: opacity plus a 4 px translate from the open side, 150 ms in, 100 ms fade out ([21-motion.md](21-motion.md) section 4.1). The shared classes live in `ui/popup-styles.ts` |
| Item | 32 px `h-8`, `px-2 gap-2 rounded-md type-body text-foreground`, leading icon 14 px, `data-highlighted:bg-surface-elevated-hover`, `focus-visible:focus-ring-inset` |
| Shortcut | Right aligned `Kbd` (section 11) with `ml-auto pl-4` (16 px minimum gap from the label, [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 5.2), never plain `type-kbd` text |
| Checkbox and radio items | 16 px leading slot holding a 14 px `Check` (or 6 px dot for radio) when checked; the slot is reserved when unchecked so labels align |
| Destructive item | Last, after a `Separator` (`my-1 h-px bg-border-subtle`), `text-negative-text`, leading icon in the same color |
| Group label | 28 px row: `h-7 flex items-center px-2 type-meta`, not focusable ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 5.2) |

APG menu button keyboard: Enter, Space or Down Arrow open and focus the first item; Up Arrow opens and focuses the last; arrows move; typing a letter jumps to the matching item; Enter activates; Escape closes and returns focus to the trigger. Menus contain commands or single choices (radio items, for example `ThemeMenu`), never inspector content or forms. A form value chosen from a list is a `Select` or `Combobox` ([10-forms.md](10-forms.md)).

## 11. Kbd

`Kbd` renders `<kbd>`: `inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-surface-subtle px-1 type-kbd text-foreground-secondary` (a small gray box, radius 4 px, as in the "⌘K" hint of the top bar search).

- Modifier glyphs are platform aware: `⌘`, `⌥`, `⇧` on macOS; `Ctrl`, `Alt`, `Shift` elsewhere. Combinations render as separate `Kbd` elements with `gap-0.5`.
- Places: tooltips, menu items, the search field "/" hint ([10-forms.md](10-forms.md) section 17), the command palette and the keyboard help dialog.
- A `Kbd` inside an interactive element is `aria-hidden`; the shortcut reaches assistive technology through `aria-keyshortcuts` on the element.

## 12. Tabs

Two sizes, one Base UI `Tabs` implementation (`Root`, `List`, `Tab`, `Indicator`, `Panel`).

| Property | Page and inspector tabs (`variant="underline"`) | In-panel tabs (`variant="segmented"`) |
|---|---|---|
| Height | 44 px (`h-tab`) including the 2 px indicator | 32 px (the segmented control `sm`, section 6) |
| List | `flex gap-6 border-b border-border`: labels 24 px apart, and a 1 px bottom border runs across the whole tab row | Segmented group, hugging its items |
| Tab | `h-tab type-body text-foreground-secondary` (14 px, weight 400), hover `text-foreground` | Segmented item |
| Selected | `data-active:text-primary-text` at weight 500 (Base UI 1.8 marks the chosen tab with `data-active`) plus `Tabs.Indicator`: `absolute bottom-0 h-0.5 bg-primary left-(--active-tab-left) w-(--active-tab-width)`, no transition: the indicator moves to the new tab instantly ([21-motion.md](21-motion.md) sections 5 and 12) | Segmented selected |
| Focus | `focus-visible:focus-ring-inset` | `focus-visible:focus-ring-inset` on the item (same as page tabs) |
| Count | Inbox tabs only ([11-navigation.md](11-navigation.md) section 6): `type-micro` counter after the label, 6 px gap, `text-foreground-tertiary`, formatted with `formatCompact` | Not used |
| Where | Section switches within a page (Keyword detail: Overview, SERP history, Competitors) and inspector sections ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.3) | Chart modes inside panels |

Rules:
- At most 6 page tabs ([11-navigation.md](11-navigation.md) section 6). More sections means the page is too broad; split it.
- Every page tab has its own URL, so views can be shared and Back works ([00-design-principles.md](00-design-principles.md) P6, [11-navigation.md](11-navigation.md) section 6). Two implementations, chosen by the URL shape:
  - Tabs that set a query parameter (`?tab=serp`) use `Tabs`: an APG tablist whose panels live on one page; the selection is written to the URL.
  - Tabs that change the route path use `TabNav`: not a tablist, but a `<nav>` of links with `aria-current="page"` and the same underline styling.
- Automatic activation: arrow keys move focus and select the tab (`<Tabs.List activateOnFocus>`), as [20-accessibility.md](20-accessibility.md) section 5 requires. Panels render their skeleton immediately, so an arrow press never waits on a fetch.
- The selected label is weight 500 and the others are weight 400. Each tab reserves the width of its weight 500 label (a visually hidden, `aria-hidden` copy of the label in weight 500 sets the width), so selection never changes width. Selection is shown by color, weight and the indicator together, never color alone.

### 12.1 CountTabs

`CountTabs` is the event-type filter with a count per type, placed directly above the event list it filters: `EventTimeline`, `ChangeFeed` and the Alerts events view ([23-application-patterns.md](23-application-patterns.md) section 9.3, [18-notifications-alerts.md](18-notifications-alerts.md) section 7). It sits alongside tabs but is not a tablist: it filters one list and never switches panels. Page sections still use page tabs, and inbox tabs keep their plain counter (section 12).

```
 ┏━━━━━━━━━━━━━━━━━━┓  ┌──────────────────┐  ┌───────────────────┐
 ┃ All events [23]  ┃  │ Rank moves [12]  │  │ URL changes [4]   │
 ┗━━━━━━━━━━━━━━━━━━┛  └──────────────────┘  └───────────────────┘
   pressed                not pressed: bordered item, neutral count badge
```

| Part | Spec |
|---|---|
| Group | A row of separate items, `flex gap-2` (8 px) |
| Item | `md` 36 px (`h-control`) on full pages, `sm` 32 px (`h-control-sm`) in the inspector; `px-3 gap-2 rounded-md border border-border bg-surface`; label `type-body text-foreground-secondary` (weight 400) |
| Count badge | A neutral subtle `Badge` ([14-badges-status.md](14-badges-status.md) section 1): 22 px, `type-micro num`, formatted with `formatCompact` |
| Hover (not pressed) | `bg-surface-hover text-foreground` |
| Pressed (`data-pressed`) | Solid cobalt: `bg-primary border-primary text-primary-foreground`, label weight 500; the count badge turns a deeper blue: `bg-primary-hover text-primary-foreground` |
| Focus | `focus-visible:focus-ring` on the item |
| Width | Each item reserves the width of its weight 500 label, as tabs do (section 12), so pressing an item never shifts the row |

- The first item is "All events" with the total; it is pressed when no type is selected and pressing it clears the type filters. Several types can be pressed at once. Filter state is local to the list and mirrored to the URL on full pages (`events=`, [13-filters-search.md](13-filters-search.md) section 5).
- Semantics: a `Toolbar` (section 7) of toggle buttons (`aria-pressed`), one Tab stop; Left and Right arrows move between items. Each accessible name includes the count ("Rank moves, 12").
- `primary-foreground` on `primary` and on `primary-hover` meets 4.5:1 in both themes (asserted in `tokens.contrast.test.ts`).

## 13. Pagination

Server-mode tables (above 10,000 rows, [12-tables.md](12-tables.md) section 12) use cursor pagination ([19-api-specification.md](../19-api-specification.md) section 2.4), so the control has no page numbers.

```
 Footer (48 px): Showing 1 to 200 of 12,480 keywords   Rows per page [200 ▾]   [‹] [›]
```

| Part | Spec |
|---|---|
| Container | `<nav aria-label="Pagination">`, `flex items-center gap-3`, placed in the pagination slot of the sticky 48 px `TableFooter` ([12-tables.md](12-tables.md) section 1), vertically centered with 8 px above and below the 32 px controls. It has no bar, height or border of its own |
| Range text | On the left of the footer, `type-meta num`: "Showing 1 to 200 of 12,480 keywords" with `formatInteger`; "Showing 201 to 400" when the total is unknown. Never page numbers ("1 of 5"), never a dash |
| Page size | `Select` at `sm` size (32 px), options 100, 200 (default), 500; persists per table in the saved view |
| Previous and next | `IconButton` `icon-sm` (32 px square) in the `secondary` variant: 1 px `border`, radius 6 px, `ChevronLeft` and `ChevronRight`, labels "Previous page" and "Next page"; disabled at the ends |
| Announcement | After a page change, a polite live region announces the new range ("Rows 201 to 400 of 12,480"). Focus stays on the button pressed |
| Offset lists | Admin lists with offset pagination use the same control; no page number input |

The reference screens show numbered page buttons with the current page in `primary-subtle` and `primary-text`. They are not used, because pagination is cursor-based.

## 14. Accessibility summary

| Control | APG pattern | Role and attributes | Keyboard | Target |
|---|---|---|---|---|
| Button | Button | native `button`; `aria-busy` when loading; `aria-disabled` with `focusableWhenDisabled` | Enter, Space | 32, 36, 40 px tall |
| Icon button | Button | `aria-label` equal to tooltip text | Enter, Space | 24, 32, 36 px square |
| Toggle button | Button (toggle) | `aria-pressed` | Enter, Space | 32 px |
| Split button | Button plus Menu button | `role="group"` with `aria-label`; trigger has `aria-haspopup="menu"`, `aria-expanded` | As button and menu button | 32 or 36 px |
| Segmented (view) | Radio group | `role="radiogroup"` with `aria-label`; items `role="radio"`, `aria-checked` | Arrows move and select, Tab leaves the group | 32 or 36 px items |
| Toolbar | Toolbar | `role="toolbar"`, `aria-label`, `aria-orientation="horizontal"` | Tab in and out, arrows, Home, End | 32 px |
| Checkbox | Checkbox (dual and mixed) | `role="checkbox"`, `aria-checked` true, false or mixed | Space | 24 px area |
| Radio group | Radio group | `role="radiogroup"` with legend; `role="radio"`, `aria-checked` | Arrows move and select, Tab leaves the group | 24 px area |
| Switch | Switch | `role="switch"`, `aria-checked` | Space, Enter | 24 px area |
| Slider | Slider | `role="slider"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, `aria-valuetext` | Arrows, Page Up, Page Down, Home, End | 26 px thumb area |
| Menu button | Menu button | trigger `aria-haspopup="menu"`, `aria-expanded`; `role="menu"`, `menuitem`, `menuitemcheckbox`, `menuitemradio` | Enter, Space, arrows, typeahead, Escape | 32 px items |
| Tabs | Tabs (automatic activation) | `tablist`, `tab` with `aria-selected` and `aria-controls`, `tabpanel` | Arrows move and select, Home, End | 44 px (underline) or 32 px (in-panel) |
| Tab nav | Navigation | `nav` with links, `aria-current="page"` | Tab, Enter | 44 px |
| Count tabs | Toolbar of toggle buttons | `role="toolbar"` with `aria-label`; items are buttons with `aria-pressed`, name includes the count | Tab in and out, Left and Right move, Enter and Space toggle | 36 or 32 px |
| Pagination | Navigation | `nav aria-label="Pagination"`, live region for range | Tab, Enter, Space | 32 px |
| Copy button | Button | `aria-label`, live region "Copied" | Enter, Space | 24 to 36 px |

Every control in this table is verified in the design-system preview with keyboard-only Playwright tests and an axe scan in both themes ([26-implementation-guidelines.md](26-implementation-guidelines.md)). Component names for the inventory are listed in [25-component-inventory.md](25-component-inventory.md).
