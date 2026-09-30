# 09: Frontend Stack for the Design System

Research date: 2026-09-29. All URLs accessed 2026-09-29 unless stated.

Fixed stack: Next.js (App Router), React, TypeScript, Tailwind CSS v4, shadcn/ui on Base UI (not Radix), TanStack Table, TanStack Virtual, TanStack Query, Apache ECharts, Lucide, React Hook Form, Zod, nuqs, date-fns, Geist Sans and Geist Mono.

Labels used:
- **VERIFIED**: read on the primary source (docs, changelog, GitHub, npm registry, or the shipped package files) at the URL or command given.
- **INFERRED**: my reasoning from verified facts, or common practice without a primary source fetched this session.
- **UNVERIFIED**: secondary source only, or the primary page failed.

npm figures come from `npm view <pkg> version time dist-tags peerDependencies --json` run on 2026-09-29. Where I say "package files", I ran `npm pack` on the exact version and read the shipped code or fonts.

---

## 0. Headline findings

1. **shadcn/ui now defaults to Base UI.** Since July 2026, `shadcn init` / `shadcn create` pick Base UI unless you pass `-b radix`. CLI is **shadcn 4.21.0** (2026-09-04). Styles are published per base, e.g. `base-nova`, `base-vega`, `base-maia`, `base-lyra`, `base-mira`, `base-luma`, `base-sera`, `base-rhea`. `--defaults` means `--template=next --preset=base-nova`. VERIFIED.
2. **shadcn switched its class helper to a new `cn` package** (0.4.0, by shadcn, MIT), a drop-in for `twMerge(clsx(...))`. New components import `cn` from `"cn"`. Custom tokens need `createCn` from `cn/config`. VERIFIED.
3. **Base UI is stable: `@base-ui/react` 1.8.0** (2026-09-04). v1.0.0 shipped 2025-12-11. The old `@base-ui-components/react` is deprecated ("renamed to @base-ui/react"). Drawer (stable since 1.3.0) and OTP Field (stable since 1.6.0) exist. There is no public Calendar or Date Picker primitive. VERIFIED.
4. **TanStack Table v9 is stable** (9.0.0 on 2026-08-04, now 9.2.4). `useReactTable` became `useTable`, features are tree-shakable and registered via `tableFeatures({...})`, state moved to TanStack Store. shadcn's Data Table guide already uses the v9 API. A `useLegacyTable` shim exists. VERIFIED.
5. **ECharts 6.1.0** (2026-05-19) is current. v6 brought a new default theme, `setTheme()` for runtime theme switching, dark mode, chord series, jitter/beeswarm, axis breaks, matrix coordinate system and `registerCustomSeries`. VERIFIED.
6. **Geist Sans default digits are proportional.** The font has `tnum` (all tabular digits are 600 units wide), so `tabular-nums` works. **Neither Geist Sans nor Geist Mono has a `zero` feature**, so Tailwind's `slashed-zero` does nothing. VERIFIED by reading the font files.
7. **`next/font/google` Geist loses the stylistic sets.** The Google Fonts latin subset keeps `tnum`, `pnum`, `frac`, `liga` but drops `ss01` to `ss11`, `case`, `sups`, `subs`, `ordn`. The `geist` npm package (1.7.2) ships the full font through `next/font/local`. VERIFIED.
8. **Lucide 1.x** (lucide-react 1.48.0). v1 removed all brand icons, sets `aria-hidden` by default, deprecated `absoluteStrokeWidth` in favour of `nonScalingStroke`, and added `LucideProvider`. VERIFIED.
9. **Next.js 16.3.7** (published 2026-09-29, a security release). React 19.3.0 is current. Turbopack is the default bundler; `proxy.ts` replaces `middleware.ts`. VERIFIED.
10. **Lost Pixel is archived** (team joined Figma, 2026-04-22). Ladle has had no npm release since 2025-11-04. Storybook 10.6.0 with `@storybook/nextjs-vite` supports Next 16. VERIFIED.
11. **Tailwind Labs joined Shopify** (2026-09-09). Tailwind stays MIT. Tailwind CSS is **4.3.3**. VERIFIED.

---

## 1. Version table (npm, 2026-09-29)

| Package | Latest | Published | Other dist-tags / notes | Status |
|---|---|---|---|---|
| shadcn (CLI) | 4.21.0 | 2026-09-04 | CLI v4.0.0 on 2026-03-06 | VERIFIED |
| @base-ui/react | 1.8.0 | 2026-09-04 | 1.0.0 on 2025-12-11 | VERIFIED |
| @base-ui-components/react | 1.0.0-rc.0 | 2025-12-04 | deprecated: "Package was renamed to @base-ui/react" | VERIFIED |
| cn | 0.4.0 | n/a | shadcn's clsx + tailwind-merge replacement | VERIFIED |
| tailwindcss / @tailwindcss/postcss | 4.3.3 | 2026-07-16 | 4.2.0 on 2026-02-18, 4.3.0 on 2026-05-08, `v3-lts` 3.4.19 | VERIFIED |
| tw-animate-css | 1.4.0 | 2025-09-24 | | VERIFIED |
| tailwind-merge | 3.7.0 | 2026-09-12 | `tailwind-merge-2` tag 2.6.1 for Tailwind v3 | VERIFIED |
| class-variance-authority | 0.7.1 | 2024-11-26 | no release in 22 months | VERIFIED |
| cva (successor name) | 0.0.0 latest, 1.0.0-beta.12 beta | modified 2026-09-17 | still beta | VERIFIED |
| tailwind-variants | 3.3.1 | 2026-08-03 | 3.0.0 on 2025-08-24 | VERIFIED |
| eslint-plugin-better-tailwindcss | 4.7.0 | 2026-07-19 | peers: eslint 7 to 10, oxlint ^1.35, tailwindcss ^3.3 or ^4.1.17 | VERIFIED |
| eslint-plugin-tailwindcss | 4.4.0 | 2026-08-21 | 4.0.0 on 2026-01-12; peers eslint ^9 or ^10, tailwindcss ^4 | VERIFIED |
| prettier-plugin-tailwindcss | 0.8.1 | 2026-07-15 | | VERIFIED |
| stylelint | 17.15.0 | | stylelint-config-tailwindcss 1.0.1 | VERIFIED |
| @tanstack/react-table | 9.2.4 | 2026-08-28 | 9.0.0 on 2026-08-04; last v8 was 8.21.3 (2025-04-14) | VERIFIED |
| @tanstack/react-virtual | 3.14.13 | 2026-09-14 | no v4 tag | VERIFIED |
| @tanstack/react-query | 5.104.0 | 2026-09-26 | no v6 tag; `previous` = 4.44.0 | VERIFIED |
| echarts | 6.1.0 | 2026-05-19 | 6.0.0 on 2025-07-30 | VERIFIED |
| echarts-for-react | 3.0.6 | 2026-01-21 | peer `echarts ^3 or ^4 or ^5 or ^6`, `react ^15 or >=16` | VERIFIED |
| geist | 1.7.2 | 2026-06-01 | peer `next >=13.2.0` | VERIFIED |
| lucide-react | 1.48.0 | 2026-09-24 | 1.0.0 on 2026-03-23 | VERIFIED |
| nuqs | 2.10.1 | 2026-08-25 | peer `next >=14.2.0`, `react >=18.2.0` | VERIFIED |
| date-fns | 4.4.0 | 2026-05-29 | `next` tag 5.0.0-alpha.0 | VERIFIED |
| @date-fns/tz | 1.5.0 | 2026-05-21 | | VERIFIED |
| next | 16.3.7 | 2026-09-29 | canary 16.4.0-canary.52; backport 15.5.26 | VERIFIED |
| react / react-dom | 19.3.0 | 2026-09-09 | | VERIFIED |
| react-hook-form | 7.89.0 | 2026-09-26 | 8.0.0-beta.4 (same day) | VERIFIED |
| @hookform/resolvers | 5.9.1 | | peer `zod ^3.25.0 or ^4.0.0`, imports `zod/v4/core` | VERIFIED |
| zod | 4.6.5 | 2026-09-13 | | VERIFIED |
| react-day-picker | 10.0.1 | 2026-05-15 | 10.0.0 on 2026-05-08; depends on date-fns ^4.1 and @date-fns/tz ^1.4.1 | VERIFIED |
| cmdk | 1.1.1 | 2025-03-14 | repo last push 2025-10-29 (README edit) | VERIFIED |
| sonner | 2.0.8 | 2026-08-09 | repo pushed 2026-08-10 | VERIFIED |
| storybook / @storybook/nextjs-vite | 10.6.0 | 2026-09-02 | `next` tag 11.0.0-alpha.1; `v9` tag 9.1.20 | VERIFIED |
| @ladle/react | 5.1.1 | 2025-11-04 | depends on vite ^6.0.5 | VERIFIED |
| @playwright/test | 1.63.0 | 2026-09-04 | | VERIFIED |
| @argos-ci/playwright | 7.6.0 | | | VERIFIED |
| lost-pixel | 3.22.0 | 2024-11-14 | repo archived | VERIFIED |

---

## 2. shadcn/ui with Base UI

Sources:
- Changelog index: https://ui.shadcn.com/docs/changelog
- Base UI as default: https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default
- CLI: https://ui.shadcn.com/docs/cli and `npx shadcn@4.21.0 init --help`
- Theming: https://ui.shadcn.com/docs/theming
- Tailwind v4 notes: https://ui.shadcn.com/docs/tailwind-v4
- `cn` package: https://ui.shadcn.com/docs/changelog/2026-09-cn and https://github.com/shadcn-ui/cn
- Registry JSON: `https://ui.shadcn.com/r/styles/<style>/<item>.json`

### 2.1 Timeline (VERIFIED, changelog index)

| Date | Entry |
|---|---|
| 2025-02 | Tailwind v4 support |
| 2025-08 | shadcn CLI 3.0 and MCP server |
| 2025-12 | `npx shadcn create` |
| 2026-01 | Base UI documentation; RTL support |
| 2026-02 | Blocks for Radix and Base UI; unified Radix UI package |
| 2026-03 | shadcn/cli v4 |
| 2026-04 | `shadcn apply`, `shadcn preset`, partial preset apply, pointer cursor |
| 2026-05 | `shadcn eject`, package imports and target aliases |
| 2026-07 | **Base UI as the default**; React Aria base; new Toast; @shadcn/helpers; shadcn/typeset |
| 2026-08 | Private GitHub registries; Questionnaire component |
| 2026-09 | `cn` package |

### 2.2 How to init with Base UI (VERIFIED)

`shadcn init` and `shadcn create` are aliases. From `init --help` (4.21.0):

```
-t, --template <template>  (next, start, vite, react-router, laravel, astro)
-b, --base <base>          the component library to use. (base, radix, aria)
-p, --preset [name]        use a preset configuration
-d, --defaults             use default configuration: --template=next --preset=base-nova
--css-variables            (default: true)
--rtl / --no-rtl, --pointer / --no-pointer, --monorepo / --no-monorepo
```

Recommended non-interactive command for us:

```bash
pnpm dlx shadcn@latest init -t next -b base --preset base-nova
```

The changelog states Base UI is now the default for `init` and `shadcn/create`, and that Radix "is not being deprecated". Migration from Radix is done through an AI skill (`pnpm dlx skills add shadcn/ui`), not a codemod.

Registry style names (VERIFIED by HTTP 200 on `/r/styles/<name>/button.json`): `base-vega`, `base-nova`, `base-maia`, `base-lyra`, `base-mira`, `base-luma`, `base-sera`, `base-rhea`, and the same eight with `radix-` prefix. The `components.json` docs page still only shows `"new-york"` as a `style` example, so it lags the registry.

Base colors (`tailwind.baseColor`): `neutral`, `stone`, `zinc`, `mauve`, `olive`, `mist`, `taupe`. VERIFIED.

Other CLI commands: `add`, `apply [preset]` (with `--only theme` or `--only font`), `preset decode|resolve|url|open`, `eject` (inlines `shadcn/tailwind.css` and removes the dependency; irreversible), `migrate cn`. VERIFIED.

### 2.3 What a base-nova project installs (VERIFIED, registry JSON)

`/r/styles/base-nova/index.json`:
- dependencies: `class-variance-authority`, `cn`, `lucide-react`, `@base-ui/react`
- CSS: `@import "tw-animate-css"; @import "shadcn/tailwind.css";` plus `@layer base { * { @apply border-border outline-ring/50 } body { @apply bg-background text-foreground } }`

`shadcn/tailwind.css` (in the `shadcn` npm package, `exports["./tailwind.css"]`) defines accordion keyframes, a `no-scrollbar` utility, scroll-fade properties, and custom variants that match **both** Radix and Base UI state attributes, for example:

```css
@custom-variant data-open {
  &:where([data-state="open"]),
  &:where([data-open]:not([data-open="false"])) { @slot; }
}
```

Also `data-closed`, `data-checked`, `data-unchecked`, `data-selected`, `data-disabled`, `data-active`, `data-horizontal`, `data-vertical`. So `data-open:` utilities work for Base UI popups. VERIFIED (package files).

The base-nova Button imports `Button as ButtonPrimitive` from `@base-ui/react/button`, `cva` from `class-variance-authority`, and `cn` from `"cn"`. Its `secondary` variant uses an arbitrary value: `hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]`. This matters for any "no arbitrary values" lint rule (section 5). VERIFIED.

### 2.4 Component coverage and caveats

The components index lists 75 entries, including: Accordion, Alert, Alert Dialog, Aspect Ratio, Attachment, Avatar, Badge, Breadcrumb, Bubble, Button, Button Group, Calendar, Card, Carousel, Chart, Checkbox, Collapsible, Combobox, Command, Context Menu, Data Table, Date Picker, Dialog, Direction, Drawer, Dropdown Menu, Empty, Field, Hover Card, Input, Input Group, Input OTP, Item, Kbd, Label, Marker, Menubar, Message, Message Scroller, Native Select, Navigation Menu, Pagination, Popover, Progress, Questionnaire, Radio Group, Resizable, Scroll Area, Select, Separator, Sheet, Sidebar, Skeleton, Slider, Spinner, Switch, Table, Tabs, Textarea, Toast, Toggle, Toggle Group, Tooltip, Typography. VERIFIED (https://ui.shadcn.com/docs/components).

Dependencies of notable base-nova items (VERIFIED, registry JSON):

| Item | npm deps | Built on | Notes |
|---|---|---|---|
| command | `cmdk` | cmdk, not Base UI | registryDependencies: dialog, input-group |
| toast | `@base-ui/react` | Base UI Toast | new July 2026; "supports actions, status types, promises, stacking, and swipe dismissal" |
| sonner | `sonner`, `next-themes` | sonner | still in the base-nova registry, but the docs URL `/docs/components/base/sonner` 308-redirects to `/docs/components/base/toast`; Radix docs still have Sonner |
| calendar | `react-day-picker@latest`, `date-fns` | React DayPicker (now v10) | docs: set `timeZone` on the client in `useEffect` to avoid hydration mismatch |
| date-picker | none (composition doc page) | Calendar + Popover | no registry item (404); docs page exists |
| data-table | none (guide) | `@tanstack/react-table` v9 `useTable` + `tableFeatures` | no registry item (404) |
| sidebar | none extra | button, input, separator, sheet, skeleton, tooltip, use-mobile | exists for base |
| drawer | `@base-ui/react` | Base UI Drawer | Radix variant historically used vaul (INFERRED) |
| resizable | `react-resizable-panels` | third party | |
| input-otp | `input-otp` | third party | Base UI has its own OTPField since 1.6.0 |
| chart | `recharts@3.8.0` | Recharts v3 | we use ECharts instead; reuse only `--chart-*` tokens |
| carousel | `embla-carousel-react` | third party | |

So "Radix-only" is not the right frame any more. The real caveat is that several shadcn Base UI components still wrap third-party libraries: **Command (cmdk)**, Calendar (react-day-picker), Resizable, Input OTP, Carousel, Chart (Recharts). VERIFIED.

### 2.5 Theming conventions (VERIFIED)

Token names (from https://ui.shadcn.com/docs/theming and `/r/colors/neutral.json`):

`--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--border`, `--input`, `--ring`, `--chart-1` to `--chart-5`, `--radius`, `--sidebar`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-border`, `--sidebar-ring`.

- Values are OKLCH, e.g. light `--primary: oklch(0.205 0 0)`, dark `--border: oklch(1 0 0 / 10%)`.
- `--radius: 0.625rem` with derived `radius-sm` to `radius-4xl`.
- No `--destructive-foreground`, no success, warning or info tokens. We must add our own semantic status tokens.
- In the neutral base color, `--chart-1` to `--chart-5` are **greyscale** (`oklch(0.87 0 0)` to `oklch(0.269 0 0)`). Five greys is not a usable categorical palette for an analytics app. We need our own categorical, sequential and diverging palettes.
- Tailwind mapping via `@theme inline { --color-background: var(--background); ... }`.
- Dark mode variant as documented by shadcn: `@custom-variant dark (&:is(.dark *));`. Tailwind's own doc uses `(&:where(.dark, .dark *))`. The `:where` form has zero specificity; the `:is` form does not. INFERRED: pick one and keep it consistent.
- `tw-animate-css` replaced `tailwindcss-animate` (2025-03-19). Components use `data-slot` attributes and no `forwardRef` (React 19 style).

### 2.6 The `cn` package (VERIFIED)

- "`cn` is a drop-in replacement for `twMerge(clsx(...))`. It is smaller, faster and ships the same API."
- Migration: `pnpm dlx shadcn@latest migrate cn`. Existing `lib/utils.ts` keeps working.
- Custom config: `import { createCn } from "cn/config"`, then `createCn({ extend: { classGroups: { "font-size": [{ text: ["hero"] }] } } })`. Also exports `fromTheme`, `validators`, `mergeConfigs`, `defaultConfig`. Prefix support: `createCn({ prefix: "tw" })`.
- Limitations from README: Tailwind v3 users stay on tailwind-merge v2; dynamically built names (`"p-" + size`) are not detected; the CLI needs Node 20+.
- INFERRED: if we add custom font sizes (e.g. `text-2xs`, `text-dense`) or spacing names, register them in `createCn` so merges resolve conflicts correctly. Test this with unit tests.

---

## 3. Base UI

Sources: https://base-ui.com/react/overview/releases, https://base-ui.com/react/handbook/composition, https://base-ui.com/react/handbook/animation, https://base-ui.com/react/components/popover, https://base-ui.com/react/components/menu, https://base-ui.com/react/components/autocomplete, https://base-ui.com/react/overview/accessibility, and `npm view @base-ui/react exports`.

### 3.1 Status (VERIFIED)

- Package: `@base-ui/react` 1.8.0. Stable since v1.0.0 on 2025-12-11 ("35 unstyled UI components").
- Peers: `react` and `react-dom` `^17 || ^18 || ^19`. Optional peers `date-fns ^4.0.0` and `@date-fns/tz ^1.2.0`, and the package has internal `temporal` and `temporal-adapter-date-fns` modules. INFERRED: date components are being built but are not public yet.

Release highlights:

| Version | Date | Highlights |
|---|---|---|
| 1.8.0 | 2026-09-04 | Combobox `createItems` API; Toast updates via function; `keepMounted` on Avatar.Image |
| 1.7.0 | 2026-08-04 | ScrollArea thumb overscroll on WebKit; bundle size and perf |
| 1.6.0 | 2026-06-18 | OTPField stable; Accordion keyboard nav aligned with APG; Drawer.VirtualKeyboardProvider |
| 1.5.0 | 2026-05-19 | popup mount/unmount 50 to 85% faster; NumberField Persian digits |
| 1.4.0 | 2026-04-13 | OTPField (preview); Toast update by id |
| 1.3.0 | 2026-03-12 | Drawer stable; Menu Viewport transitions; Label parts for Select, Combobox, Slider; Tooltip `closeOnClick` |
| 1.2.0 | 2026-02-12 | Drawer (preview); `useFilteredItems` for Autocomplete and Combobox |
| 1.1.0 | 2026-01-15 | `loopFocus`; CSPProvider |
| 1.0.0 | 2025-12-11 | stable; new package name |

### 3.2 Component list (VERIFIED from package `exports`, 1.8.0)

Accordion, AlertDialog, Autocomplete, Avatar, Button, Checkbox, CheckboxGroup, Collapsible, Combobox, ContextMenu, Dialog, **Drawer**, Field, Fieldset, Form, Input, Menu, Menubar, Meter, NavigationMenu, NumberField, **OTPField**, Popover, PreviewCard, Progress, Radio, RadioGroup, ScrollArea, Select, Separator, Slider, Switch, Tabs, Toast, Toggle, ToggleGroup, Toolbar, Tooltip.

Utilities and providers: `CSPProvider`, `DirectionProvider`, `mergeProps`, `useRender`, `unstable-use-media-query`.

Not present: Calendar, DatePicker, Textarea, standalone Label (labels come from `Field.Label` and the per-component Label parts), Table, Command. VERIFIED (absence from exports).

### 3.3 Behaviours that shape the design system

**Composition via `render`, not `asChild`** (VERIFIED):
- Element form: `<Menu.Trigger render={<MyButton size="md" />}>`.
- Function form: `render={(props, state) => <span {...props}>...</span>}` for state-dependent output.
- Custom components must forward `ref` and spread all props.
- `nativeButton` on triggers: "Set to `false` if the rendered element is not a button (for example, `<div>`)".

**State data attributes** (VERIFIED, Popover and Menu pages):

| Part | Attributes |
|---|---|
| Popover.Trigger | `data-popup-open`, `data-pressed`, `data-disabled` |
| Popover.Positioner | `data-open`, `data-closed`, `data-anchor-hidden`, `data-side`, `data-align` |
| Popover.Popup | `data-open`, `data-closed`, `data-side`, `data-align`, `data-instant`, `data-starting-style`, `data-ending-style` |
| Menu.Item | `data-highlighted`, `data-disabled` |

**Portal / Positioner / Popup pattern** (VERIFIED): Root, Trigger, Portal, Backdrop, Positioner, Popup, Arrow, Viewport, Title, Description, Close. Positioner exposes `--anchor-width`, `--anchor-height`, `--available-width`, `--available-height`, `--positioner-width`, `--positioner-height`, `--transform-origin`. Popup exposes `--popup-width`, `--popup-height`. Use `max-h-(--available-height)` and `origin-(--transform-origin)` in Tailwind.

**Animation** (VERIFIED): use `[data-starting-style]` and `[data-ending-style]` with CSS transitions (preferred because "a transition can be smoothly cancelled midway"), or `[data-open]` / `[data-closed]` with keyframes. Base UI waits on `element.getAnimations()` before unmounting. If a transition does not animate opacity, animate it to `0.9999` so Base UI can detect it. For Motion, use `keepMounted` on Portal plus `AnimatePresence`, or `actionsRef.current.unmount()`.

**Accessibility** (VERIFIED): follows WAI-ARIA Authoring Practices for keyboard support; exposes `initialFocus` / `finalFocus`. We remain responsible for visible focus styles (`:focus-visible`), colour contrast, and labels (use Field, Fieldset, Form).

**Command palette** (VERIFIED): the Autocomplete docs include a "Command Palette" example with Autocomplete inside a Dialog. Render the list without a popup via `<Autocomplete.Root inline open>`. Modes: `list` (default), `both`, `inline`, `none`. Items get `data-highlighted`.

---

## 4. Tailwind CSS v4

Sources: https://tailwindcss.com/docs/theme, https://tailwindcss.com/docs/dark-mode, https://tailwindcss.com/docs/functions-and-directives, https://tailwindcss.com/docs/font-variant-numeric, https://tailwindcss.com/docs/font-feature-settings, https://tailwindcss.com/blog/tailwindcss-v4-3, https://tailwindcss.com/blog/tailwind-is-joining-shopify, https://tailwindcss.com/docs/installation/framework-guides/nextjs, and `tailwindcss@4.3.3/theme.css` (package files).

### 4.1 Version and recent features (VERIFIED)

- **4.3.3**. v4.2 (2026-02-18) added `mauve`, `olive`, `mist`, `taupe` palettes, `@tailwindcss/webpack`, logical property utilities (`mbs-*`, `pbs-*`, `inline-*`, `block-*`), and `font-features-*`.
- v4.3 (2026-05-08) added `scrollbar-thin`, `scrollbar-none`, `scrollbar-thumb-*`, `scrollbar-track-*`, `scrollbar-gutter-*`, `@container-size` for block-size container queries, `zoom-*`, `tab-*`, stacked `@variant hover:focus` and `@variant hover, focus`, and `--default(...)` for functional `@utility`.
- Tailwind Labs joined Shopify on 2026-09-09: "Everything will always be MIT-licensed".

### 4.2 CSS-first config (VERIFIED)

Directives: `@import`, `@theme`, `@source`, `@utility`, `@variant`, `@custom-variant`, `@apply`, `@reference`, `@config` (legacy JS config), `@plugin` (legacy JS plugin). Functions: `--alpha()`, `--spacing()`, `theme()` (deprecated).

- `@theme` defines tokens that create utilities. `@theme inline` inlines the value (use when the token references another variable, e.g. shadcn tokens or `--font-sans: var(--font-geist-sans)`). `@theme static` always emits all variables.
- Namespaces: `--color-*`, `--font-*`, `--text-*`, `--font-weight-*`, `--tracking-*`, `--leading-*`, `--breakpoint-*`, `--container-*`, `--spacing-*`, `--radius-*`, `--shadow-*`, `--inset-shadow-*`, `--drop-shadow-*`, `--blur-*`, `--perspective-*`, `--zoom-*`, `--aspect-*`, `--ease-*`, `--animate-*`, `--tab-size-*`.
- **Restricting the theme**: `--color-*: initial;` removes every default colour utility (e.g. `bg-red-500` stops existing). `--*: initial;` wipes the whole default theme.
- **Spacing**: default `--spacing: 0.25rem`; `px-4` is `calc(var(--spacing) * 4)`. Any integer multiple works (`p-13` is valid). INFERRED: the multiplier model means "on-grid" is not enforced by the framework; we enforce it by lint.
- **Text sizes with line height**: `--text-sm: 0.875rem; --text-sm--line-height: calc(1.25 / 0.875);`. Same pattern for custom sizes. There is also `--text-*--letter-spacing` and `--text-*--font-weight` (INFERRED from the same double-dash convention; not re-read this session).
- **Default palette in OKLCH**: 286 `oklch(` values in `theme.css`, e.g. `--color-blue-500: oklch(62.3% 0.214 259.815)`.
- **Default font features**: `theme.css` sets `--default-font-feature-settings: --theme(--font-sans--font-feature-settings, initial)`. So `--font-sans--font-feature-settings` in `@theme` sets document-wide OpenType features. VERIFIED (package files).
- **Dark mode**: class based `@custom-variant dark (&:where(.dark, .dark *));` or data attribute `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));`.
- **Container queries** are built in: `@container` on the parent, `@sm:` etc. on children, driven by `--container-*` (e.g. `--container-3xs: 16rem`).

### 4.3 Numeric typography utilities (VERIFIED)

`normal-nums`, `ordinal`, `slashed-zero`, `lining-nums`, `oldstyle-nums`, `proportional-nums`, `tabular-nums`, `diagonal-fractions`, `stacked-fractions`. They compose (`slashed-zero tabular-nums`). `font-features-['tnum','ss09']` and `font-features-(--my-features)` set raw `font-feature-settings`. See section 8 for why `slashed-zero` is useless with Geist.

### 4.4 Next.js setup (VERIFIED)

```bash
npm install tailwindcss @tailwindcss/postcss postcss
```

```js
// postcss.config.mjs
const config = { plugins: { "@tailwindcss/postcss": {} } };
export default config;
```

`app/globals.css`: `@import "tailwindcss";`

Caveats (INFERRED from common practice plus the verified facts above):
- Next 16 builds with Turbopack by default; the PostCSS plugin path is the documented route. Do not use `@tailwindcss/vite` in the Next app; it is for Vite (Storybook's Vite builder can still read the same `postcss.config.mjs`).
- next/font exposes a CSS variable on `<html>` (e.g. `--font-geist-sans`); map it with `@theme inline { --font-sans: var(--font-geist-sans); }`, otherwise the class is resolved too early.
- Automatic source detection ignores `.gitignore`d paths; add `@source` for classes in packages outside the app (monorepo UI package).

---

## 5. Enforcement tooling

Sources: https://github.com/schoero/eslint-plugin-better-tailwindcss (plus `docs/rules/no-restricted-classes.md`, `docs/settings/settings.md`), https://github.com/francoismassart/eslint-plugin-tailwindcss, https://github.com/tailwindlabs/prettier-plugin-tailwindcss, package files of eslint-plugin-better-tailwindcss 4.7.0.

### 5.1 eslint-plugin-better-tailwindcss 4.7.0 (VERIFIED)

Rules shipped in 4.7.0 (from `lib/rules`): `enforce-canonical-classes`, `enforce-consistent-class-order`, `enforce-consistent-important-position`, `enforce-consistent-line-wrapping`, `enforce-consistent-variable-syntax`, `enforce-consistent-variant-order`, `enforce-logical-properties`, `enforce-motion-safe-variant`, `enforce-shorthand-classes`, `no-concatenated-classes`, `no-conflicting-classes`, `no-deprecated-classes`, `no-duplicate-classes`, `no-restricted-classes`, **`no-unknown-classes`**, `no-unnecessary-whitespace`.

- **`no-unregistered-classes` no longer exists.** The rule is now `no-unknown-classes`, with no alias in 4.7.0. Configs copied from older blog posts will fail. VERIFIED (package files).
- Presets: `stylistic`, `correctness`, `recommended`, each with `-error` / `-warn` suffixes; `legacy-` prefix for eslintrc.
- Tailwind v4 needs `settings["better-tailwindcss"].entryPoint` pointing at the CSS entry (e.g. `app/globals.css`). `cwd` for monorepos. `detectComponentClasses` for `@layer components` classes. Recognises `cn`, `cva`, `tv`, `clsx`, `twMerge` calls by default.
- Also runs under oxlint (peer `oxlint ^1.35.0`).

**Banning arbitrary values** with `no-restricted-classes` (VERIFIED from the rule doc): patterns are regexes; the doc gives `\[([^\[\]])*?\](?!:)` to match arbitrary values while skipping arbitrary variants (the `(?!:)` excludes `[&_svg]:`). Example:

```js
"better-tailwindcss/no-restricted-classes": ["error", {
  restrict: [
    { pattern: "\\[([^\\[\\]])*?\\](?!:)", message: "Arbitrary values are not allowed. Add a token to @theme." },
    { pattern: "^([a-zA-Z0-9:/_-]*:)?(bg|text|border|ring|fill|stroke)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\\d{2,3}(\\/\\d{1,3})?$",
      message: "Use semantic tokens (bg-primary, text-muted-foreground), not palette colours." }
  ]
}]
```

INFERRED caveats:
- shadcn's own components contain arbitrary values (`hover:bg-[color-mix(...)]`, `[&_svg:not([class*='size-'])]:size-4`). Scope the ban to `app/**` and feature code and exclude `components/ui/**`, or accept and document exceptions.
- The cleaner way to remove palette colours is `--color-*: initial;` in `@theme` and then `no-unknown-classes` flags `bg-red-500` as unknown. This is stronger than a regex.
- `(bg|p)-(--token)` CSS-variable shorthand also uses parentheses, not brackets; decide whether to ban it too.

### 5.2 eslint-plugin-tailwindcss 4.4.0 (VERIFIED)

"Made for Tailwind CSS v4". Requires `cssConfigPath` pointing at the v4 CSS file. Nine rules: `classnames-order`, `enforces-canonical-classname`, `enforces-negative-arbitrary-values`, `enforces-shorthand`, `important-modifier-suffix`, **`no-arbitrary-value`**, `no-contradicting-classname`, `no-custom-classname`, `no-unnecessary-arbitrary-value`. Peers: ESLint 9 or 10 only (flat config).

`no-arbitrary-value` is a direct ban with no regex. Either plugin works. Recommendation: **better-tailwindcss** for its richer rule set, oxlint support and regex control; do not run both.

### 5.3 Prettier and Stylelint

- prettier-plugin-tailwindcss 0.8.1: for v4 set `"tailwindStylesheet": "./app/globals.css"` and `"tailwindFunctions": ["cn", "cva", "tv"]`. It "must be loaded last" in the plugins array. VERIFIED.
- If Prettier sorts classes, turn off `better-tailwindcss/enforce-consistent-class-order` to avoid two sorters fighting. INFERRED.
- Stylelint 17.15.0: Tailwind v4 at-rules (`@theme`, `@utility`, `@variant`, `@custom-variant`, `@source`, `@reference`, `@plugin`, `@config`, `@apply`) trigger `at-rule-no-unknown`. Add them to `ignoreAtRules`, or use `stylelint-config-tailwindcss` 1.0.1. UNVERIFIED beyond search results (https://github.com/UberMorgott/quality-gate/issues/95, https://tailkits.com/blog/how-to-fix-unknown-at-rule-error-in-tailwind-css/). Stylelint adds little if almost all CSS lives in one `globals.css`; INFERRED.

---

## 6. Variant helpers and merge

| Library | Version | Last publish | Tailwind v4 | Notes |
|---|---|---|---|---|
| class-variance-authority | 0.7.1 | 2024-11-26 | framework agnostic | used by every shadcn component, including base-nova; stable, but no release in 22 months |
| cva (renamed successor) | 1.0.0-beta.12 | modified 2026-09-17 | framework agnostic | still beta; `latest` tag is a 0.0.0 placeholder |
| tailwind-variants | 3.3.1 | 2026-08-03 | yes | v3 made tailwind-merge optional (`tailwind-variants/lite`); slots and compound slots; responsive variants removed because v4 has no `content.transform` |
| tailwind-merge | 3.7.0 | 2026-09-12 | 3.x = v4 | 3.5.0 added v4.2 support, 3.6.0 added v4.3 support |
| cn | 0.4.0 | | v4 only | shadcn's replacement; `createCn` for custom tokens |

All VERIFIED from npm and https://github.com/dcastil/tailwind-merge/releases, https://github.com/heroui-inc/tailwind-variants.

Recommendation (INFERRED): keep **class-variance-authority + cn**, because every file `shadcn add` writes uses them and diffing upstream updates stays cheap. Use tailwind-variants only if we need slots for multi-part components; do not mix both in primitives.

---

## 7. TanStack Table, Virtual, Query

Sources: https://tanstack.com/blog/announcing-tanstack-table-v9, https://tanstack.com/table/latest/docs/framework/react/guide/migrating, https://www.infoq.com/news/2026/07/tanstack-table-v9-beta/, https://tanstack.com/virtual/latest/docs/api/virtualizer, https://tanstack.com/table/v8/docs/framework/react/examples/virtualized-rows, package files of @tanstack/table-core 9.2.4.

### 7.1 TanStack Table v9 (VERIFIED)

- 9.0.0 announced 2026-08-04. Now 9.2.4. React peer `>=18`, React Compiler compatible.
- Claimed perf: "79% reduction in average processing time for the core row model", retained heap down up to 86% versus v8.
- API changes: `useReactTable` becomes `useTable`; features are registered, row models are slots on `tableFeatures`:

```tsx
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
})
const table = useTable({ features, columns, data })
```

- State: `table.state`, `table.store.state`, per-slice `table.atoms.<slice>`. The v8 `onStateChange` is gone; subscribe to `table.store`.
- Call methods on instances (`row.getValue('name')`), not destructured.
- `createColumnHelper<typeof features, Person>()`.
- `FlexRender` on the table instance (`<table.FlexRender header={header} />`).
- `tableOptions()` and `createTableHook()` for reusable configs. `useLegacyTable` accepts v8-style options (bundles all features).
- Feature exports in 9.2.4: `cellSelectionFeature`, `cellSpanningFeature`, `columnFacetingFeature`, `columnFilteringFeature`, `columnGroupingFeature`, `columnOrderingFeature`, `columnPinningFeature`, `columnResizingFeature`, `columnSizingFeature`, `columnVisibilityFeature`, `globalFilteringFeature`, `rowAggregationFeature`, `rowExpandingFeature`, `rowPaginationFeature`, `rowPinningFeature`, `rowSelectionFeature`, `rowSortingFeature`.
- Row model factories: `createCoreRowModel`, `createExpandedRowModel`, `createFacetedRowModel`, `createFilteredRowModel`, `createGroupedRowModel`, `createPaginatedRowModel`, `createSortedRowModel`; registries `sortFns`, `filterFns`, `aggregationFns`.
- Options still present: `columnResizeMode`, `enableColumnPinning`, `enableRowPinning`, `manualSorting`, `manualFiltering`, `manualPagination`, `manualGrouping`, `manualExpanding`.
- There is an `experimental-worker-plugin` entry.

All the features on our list (pinning, sizing, resize mode, ordering, visibility, selection, expanding, grouping, manual sorting/filtering/pagination) exist in v9. New in v9 and useful for analytics: **cell selection** (rectangular ranges) and **cell spanning**.

Caveat (INFERRED): most community examples, including TanStack's own virtualized-rows example URL, are still v8. Budget for translating them.

### 7.2 TanStack Virtual 3.14.13 (VERIFIED unless marked)

Virtualizer options: `estimateSize` ("estimate the largest possible size ... of your items"), `measureElement` (dynamic sizes), `overscan` (default 1), `scrollMargin`, `isScrollingResetDelay` (150 ms), `getItemKey` (override the index default), `rangeExtractor` ("useful ... for rendering sticky items, headers, footers"), `useAnimationFrameWithResizeObserver` ("should not be enabled in most cases").

Pattern from the TanStack Table virtualized-rows example (VERIFIED via search summary of the example page): scroll container with `overflow: auto; position: relative` and fixed height; `<table style="display: grid">`; `<thead>` with `display: grid; position: sticky; top: 0; z-index: 1`; rows absolutely positioned with `transform: translateY(...)`; dynamic heights via `ref={node => rowVirtualizer.measureElement(node)}` with `data-index`.

Recommendation for a dense grid (INFERRED):
- Fixed row heights per density (e.g. 28, 32, 36 px). Return the exact value from `estimateSize` and skip `measureElement`. It removes layout thrash and scroll jumps.
- Sticky header inside the same scroll container (CSS sticky), not virtualized.
- Pinned columns via `position: sticky; left/right` with offsets from `column.getStart('left')` / `getAfter('right')`.
- Virtualize columns only when column count is large (more than about 30).
- `overscan` 8 to 12 rows for fast wheel scrolling.
- `getItemKey` returns the row id so selection and focus survive sort and filter.

### 7.3 TanStack Query (VERIFIED)

v5 is current (5.104.0, 2026-09-26). No v6 dist-tag exists on npm today.

---

## 8. Geist fonts

Sources: `npm pack geist@1.7.2` (font files read with fontTools), Google Fonts CSS API `https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900` (latin subset files downloaded and read), `next@16.3.7` `dist/compiled/@next/font/dist/google/font-data.json`.

### 8.1 Availability (VERIFIED)

- `geist` npm 1.7.2 exports `geist/font/sans`, `geist/font/mono`, `geist/font/sans-non-variable`, `geist/font/mono-non-variable`, `geist/font/pixel`. It wraps `next/font/local` with CSS variables `--font-geist-sans` and `--font-geist-mono`, `weight: "100 900"`.
- `next/font/google` has `Geist` and `Geist_Mono`: weights 100 to 900 plus `variable`, normal and italic, `wght` axis 100 to 900. Subsets: Geist `cyrillic`, `cyrillic-ext`, `latin`, `latin-ext`, `vietnamese`; Geist Mono adds `symbols2`.

### 8.2 OpenType features (VERIFIED, font files)

| Feature | Geist Sans (npm, v1.800) | Geist Mono (npm, v1.700) | Geist via Google latin subset | Geist Mono via Google latin subset |
|---|---|---|---|---|
| `wght` axis | 100 to 900 | 100 to 900 | 100 to 900 | 100 to 900 |
| default digits | **proportional** (advances 384 to 663) | fixed 600 | proportional | fixed 600 |
| `tnum` | yes (all digits 600) | no (not needed) | **yes** | no |
| `pnum` | yes | no | yes | no |
| `zero` (slashed zero) | **no** | **no** | no | no |
| `case` | yes | yes | **dropped** | **dropped** |
| `frac`, `numr`, `dnom` | yes | yes | yes | yes |
| `sups`, `subs`, `sinf`, `ordn` | yes | yes | dropped | dropped |
| `liga`, `dlig` | yes | no | `liga` only | no |
| stylistic sets | `ss01` to `ss11` | `ss01` to `ss04`, `ss06` to `ss11` | **all dropped** | **all dropped** |
| `kern` | yes | no | yes | no |
| latin woff2 size | 69,652 B (full, variable) | 71,368 B | 29,288 B | 23,108 B |

Stylistic set names (from the fonts' `name` table):
- Geist Sans: `ss01` No tail a, `ss02` Alt a, `ss03` Alt l, `ss04` Alt R, `ss05` Alt I, `ss06` Alt G, `ss07` Alt arrows, `ss08` Rounded dot, **`ss09` Alt numbers (replaces 0 and 1)**, `ss10` Alternative enclosing shapes, `ss11` Contextual brand styles.
- Geist Mono: same pattern, but **`ss09` is "Non-slashed zero"**. INFERRED: Geist Mono's default zero is slashed or otherwise distinguished; turning on `ss09` removes that.

Implications:
1. `tabular-nums` on table cells works with Geist Sans from either source. Apply it to numeric columns, KPI values, axis-like labels, and any live-updating number. Do not set `tnum` globally: Geist's proportional digits read better in prose. INFERRED.
2. `slashed-zero` has no effect with Geist Sans or Geist Mono. If the product needs zero/O disambiguation in IDs or codes, use Geist Mono (whose default zero is already distinct, per the `ss09` name) rather than a feature flag.
3. If we want `ss09` "Alt numbers", `case`, or any stylistic set, load Geist from the **`geist` npm package**, not `next/font/google`. Cost: about 40 KB more for the Sans latin file because the local file is not subset. INFERRED from the byte sizes above.
4. Recommendation: use the `geist` npm package for both families (full feature set, no network fetch at build, same CSS variable names shadcn templates use).

---

## 9. Lucide

Sources: https://lucide.dev/guide/version-1, https://lucide.dev/guide/packages/lucide-react, `lucide-react@1.48.0` type definitions (package files), https://www.infoq.com/news/2026/06/lucide-v1-icons/.

- lucide-react **1.48.0** (2026-09-24). v1.0.0 on 2026-03-23. VERIFIED.
- Defaults: `size` 24, `color` `currentColor`, `strokeWidth` 2. VERIFIED.
- `absoluteStrokeWidth` is `@deprecated Use nonScalingStroke instead.` in the 1.48.0 types. VERIFIED.
- `LucideProvider` (props `size`, `color`, `strokeWidth`, `absoluteStrokeWidth`, `nonScalingStroke`, `className`) and `useLucideContext` set defaults for a subtree. VERIFIED (types).
- v1 breaking changes: all brand icons removed (GitHub, Slack, Figma, LinkedIn, YouTube, etc.; docs point to Simple Icons); `aria-hidden` is set by default, so meaningful icons need `aria-label` or `title`; UMD build removed; ESM and CJS only. VERIFIED.
- Tree shaking: named imports only bundle the icons used. The dynamic loader (`lucide-react/dynamic`) defeats that and should stay out of the design system. INFERRED.
- Recommendation: wrap in `<LucideProvider size={16} strokeWidth={1.5}>` (or 1.75) for dense UI, and use `nonScalingStroke` when icons are scaled so stroke weight stays constant. INFERRED design choice.
- Brand logos (Google, Bing, OpenAI, etc. for an SEO tool) must come from another source (Simple Icons or vendor SVGs with their usage terms). INFERRED.

---

## 10. nuqs and date-fns

- **nuqs 2.10.1** (2026-08-25). App Router adapter: `import { NuqsAdapter } from 'nuqs/adapters/next/app'`, wrap `{children}` in the root layout. Peer `next >=14.2.0`. VERIFIED (https://nuqs.dev/docs/adapters, npm). The docs page did not state anything specific to Next 16; npm peers allow it.
- **date-fns 4.4.0** (2026-05-29); 5.0.0-alpha.0 exists under `next`. VERIFIED.
- **@date-fns/tz 1.5.0** (2026-05-21). `TZDate` (1.2 KB) and `TZDateMini` (916 B); `tz()` feeds the date-fns v4 `in` option: `isSameDay(a, b, { in: tz("Europe/Prague") })`. The standalone repo says it "has moved to the date-fns monorepo". VERIFIED (https://github.com/date-fns/tz).
- Alignment: react-day-picker 10 depends on `date-fns ^4.1.0` and `@date-fns/tz ^1.4.1`; Base UI has optional peers on the same. One date stack across the app. VERIFIED.

---

## 11. Next.js

Sources: https://nextjs.org/blog/next-16, https://nextjs.org/blog/next-16-3, https://nextjs.org/blog, https://react.dev/blog, npm.

Current: **next 16.3.7** (2026-09-29, security release fixing nine issues per the blog), React **19.3.0** (2026-09-09: View Transitions, Fragment Refs, and more). VERIFIED.

Next 16.0 (2025-10-21) changes that affect us (VERIFIED):
- Turbopack is the default for `dev` and `build`; `--webpack` opts out.
- `proxy.ts` replaces `middleware.ts` (Node runtime); `middleware.ts` is deprecated.
- Cache Components via `cacheComponents: true` and `"use cache"`; `experimental.ppr` and `dynamicIO` removed.
- React Compiler support stable (`reactCompiler: true`), off by default.
- `next lint` removed; `next build` no longer lints. Run ESLint directly (matters for our lint gate). `@next/eslint-plugin-next` defaults to flat config.
- Async only: `await params`, `await searchParams`, `await cookies()`, `await headers()`.
- Node 20.9+, TypeScript 5.1+, browsers Chrome/Edge/Firefox 111+, Safari 16.4+.
- `next/image` defaults changed (`qualities: [75]`, `minimumCacheTTL` 4 h).
- Parallel route slots need explicit `default.js`.
- Automatic `scroll-behavior: smooth` removed; opt in with `data-scroll-behavior="smooth"` on `<html>`.

Next 16.3 (2026-08-03) (VERIFIED): up to 90% less dev memory; build disk cache on by default; TypeScript 7 for type checking; native Node streams (up to 22% more SSR throughput); `catchError` custom error boundaries; `next/root-params`; Instant Navigations (`cacheComponents` + `partialPrefetching`), `@next/playwright` `instant()` helper; experimental Rust React Compiler and `useOffline`.

next/font (INFERRED from well-known behaviour, consistent with section 8): fonts are downloaded at build and self-hosted; no runtime request to Google; `variable` option exposes a CSS custom property; size-adjusted fallback reduces CLS.

---

## 12. Component explorer

| Option | Status (2026-09-29) | Pros | Cons |
|---|---|---|---|
| **Storybook 10.6.0 + `@storybook/nextjs-vite`** | Active; peers `next ^14.1 or ^15 or ^16`, `vite ^5 to ^8`, React 16.8 to 19. ESM-only since 10.0 ("29% lighter"). VERIFIED | Official "recommended" Next framework; `next/font/google` works; Tailwind via PostCSS with no extra config; experimental RSC (`experimentalRSC: true`); Vitest component tests, a11y addon, Chromatic integration, MCP | Runs on Vite, not Turbopack, so two bundlers; `next/font/local` needs relative `src` and ignores preload/display/fallback options (affects the `geist` package); `storybook` package alone is 22 MB unpacked; Node-only server code must be mocked |
| **Ladle 5.1.1** | Last npm release 2025-11-04; repo pushed 2026-06-28 (dependency upgrades, release pipeline); 46 open issues; Vite ^6. VERIFIED | Very fast, small, CSF-compatible | No Next.js integration (next/font, next/image, RSC need shims); slow release cadence; single maintainer risk (INFERRED) |
| **Histoire** | Vue/Svelte oriented. Not applicable. INFERRED | | |
| **Custom `/design-system` route in the Next app** | n/a | Same bundler, same fonts, same providers, zero extra deps; pages double as Playwright screenshot targets | No controls/args UI, docs, or addon ecosystem; we build the index and prop playground ourselves; must be excluded from production (route group + env check) |

Recommendation (INFERRED): start with a **custom `/design-system` route** (gated in production) as the single source for visual regression, because it renders with the real Next pipeline and the `geist` local font exactly as shipped. Add Storybook 10 only if designers or other teams need an interactive catalogue; if added, use `@storybook/nextjs-vite`.

---

## 13. Visual regression

### 13.1 Playwright `toHaveScreenshot` (VERIFIED unless marked)

Sources: https://playwright.dev/docs/test-snapshots, https://playwright.dev/docs/api/class-pageassertions#page-assertions-to-have-screenshot-1.

- Defaults: `animations: "disabled"` ("stops CSS animations, CSS transitions and Web Animations"), `caret: "hide"`, `scale: "css"`, `threshold: 0.2`, `fullPage: false`.
- It waits "until two consecutive page screenshots yield the same result". It does not explicitly wait for fonts.
- Options: `mask`, `maskColor`, `stylePath`, `maxDiffPixels`, `maxDiffPixelRatio`, `timeout`.
- Snapshot names include browser and platform because rendering and fonts differ; "run tests in the same environment where the baseline screenshots were generated". Configure defaults under `expect.toHaveScreenshot` and paths via `snapshotPathTemplate`.

Practices (INFERRED):
- Run baselines and CI in the official Playwright Docker image pinned to the same version as `@playwright/test` (1.63.0), Chromium only.
- `await page.evaluate(() => document.fonts.ready)` before capturing.
- Fix `deviceScaleFactor: 1`, viewport, `locale`, `timezoneId` (with `@date-fns/tz` this keeps dates stable), `colorScheme` (capture light and dark).
- Freeze time with `page.clock` and seed data; mask live timestamps.
- Use `stylePath` to hide carets, scrollbars and spinners; ECharts canvas output is deterministic if animation is disabled in the chart option (`animation: false`) under test.
- Capture per-component states from the `/design-system` route rather than full pages.

### 13.2 Hosted services

| Service | Free tier | Paid entry | Open source | Status |
|---|---|---|---|---|
| Chromatic | 5,000 snapshots/month, Chrome only, unlimited users | Starter $179/month (35,000), Pro $399/month (85,000); overage $0.008 | proprietary SaaS; free for OSS on request | VERIFIED (https://www.chromatic.com/pricing) |
| Percy (BrowserStack) | "5,000 free monthly screenshots, unlimited users, and unlimited projects" | public price not listed; Percy tab on BrowserStack pricing shows no plans | proprietary | Free tier VERIFIED (https://www.browserstack.com/docs/percy/overview/plans-and-billing); paid pricing UNVERIFIED |
| Argos | Hobby: up to 5,000 screenshots/month, 30-day retention | Pro $100/month with 35,000 screenshots; overage $0.004 ($0.0015 for Storybook screenshots) | repo `argos-ci/argos` MIT, active (pushed 2026-09-29) | VERIFIED (https://argos-ci.com/pricing, GitHub API). Whether Hobby allows commercial use: UNVERIFIED |
| Lost Pixel | n/a | n/a | MIT, **archived**; README: "We are sunsetting the product" (team joined Figma, 2026-04-22) | VERIFIED (GitHub) |

Recommendation (INFERRED): **Playwright `toHaveScreenshot` in Docker, baselines committed to the repo** costs nothing and is enough for a single team. Add **Argos** when review UX matters (it ingests Playwright screenshots via `@argos-ci/playwright` 7.6.0, cheapest paid tier, open-source server). Avoid Lost Pixel.

---

## 14. Other caveats

| Topic | Finding | Status |
|---|---|---|
| react-hook-form and React 19 | 7.89.0 (2026-09-26) peer `react ^16.8 or ^17 or ^18 or ^19`. v8 is in beta (8.0.0-beta.4, same day). 7.85.0 notes "Enhanced Activity component support". Stay on v7 | VERIFIED (npm, https://github.com/react-hook-form/react-hook-form/releases) |
| Zod 4 with RHF | @hookform/resolvers 5.9.1 peers `zod ^3.25.0 or ^4.0.0`; zod resolver imports `zod/v4/core` | VERIFIED (package files) |
| cmdk | 1.1.1 from 2025-03-14; repo last commit 2025-10-29 (README). Peers React 18/19. Works, but effectively dormant | VERIFIED facts; "dormant" INFERRED |
| Command palette | shadcn Command (Base UI style) still uses cmdk. Base UI Autocomplete has an official Command Palette example inside Dialog, with `inline open`. Prefer Base UI Autocomplete for one fewer dependency and consistent `data-*` styling | VERIFIED facts; preference INFERRED |
| sonner vs Toast | sonner 2.0.8 (2026-08-09), maintained. shadcn's Base UI docs redirect Sonner to the new Base UI Toast. Use shadcn `toast` (Base UI) in a Base UI project | VERIFIED |
| Calendar | shadcn Calendar uses react-day-picker 10 (2026-05). Base UI has no date primitive yet | VERIFIED |
| Charts in shadcn | shadcn Chart is Recharts 3.8.0. We use ECharts; reuse only the `--chart-*` token names with our own OKLCH palette | VERIFIED facts |
| echarts-for-react | 3.0.6 (2026-01-21), repo pushed 2026-01-21. Peer allows ECharts 6 and any React >=16. README lists StrictMode and SSR as known considerations and needs `transpilePackages: ['echarts', 'zrender']` | VERIFIED (https://github.com/hustcc/echarts-for-react, npm) |
| ECharts recommendation | Write a thin client wrapper (about 80 lines): `echarts/core` + `use([...])`, `init(el, theme, { renderer })` in `useEffect`, `setOption(option, { notMerge })`, `ResizeObserver` calling `resize()`, `dispose()` on unmount, `setTheme()` on theme change. This avoids the wrapper's StrictMode issues and lets us type options with `ComposeOption` | INFERRED |

### 14.1 ECharts 6 details (VERIFIED)

Sources: https://echarts.apache.org/handbook/en/basics/release-note/v6-feature/, https://echarts.apache.org/en/changelog.html, https://echarts.apache.org/handbook/en/basics/import/, https://echarts.apache.org/handbook/en/best-practices/canvas-vs-svg/, https://echarts.apache.org/handbook/en/best-practices/aria/, `echarts@6.1.0` type definitions.

- New default theme built on design tokens; old look via `echarts/theme/v5.js`. Axis label anti-overflow may shift layouts (`grid.outerBoundsMode: 'none'` to disable). Rich label styles now inherit plain label styles.
- `chart.setTheme(theme: string | ThemeOption, opts?)` switches theme without dispose; dark mode support.
- New: chord series, scatter `jitter` (beeswarm with `jitterOverlap: false`), axis breaks (`installAxisBreak`), matrix coordinate system, `registerCustomSeries(seriesType, renderItem)` and https://github.com/apache/echarts-custom-series (violin, contour, bar range, line range, etc.), graph thumbnail.
- 6.1.0 (2026-05-18): axis `dataMin` / `dataMax`, `containShape`, log axis ignores non-positive values, VisualMap `seriesTargets`, Matrix `triggerEvent`.
- Tree shaking: import from `echarts/core`, `echarts/charts`, `echarts/components`, `echarts/renderers` (`CanvasRenderer` or `SVGRenderer`, one required), `echarts/features` (`LabelLayout`, `UniversalTransition`); register with `use([...])`; type with `ComposeOption<...>`.
- Accessibility: import `AriaComponent` from `echarts/components` (not included by default since v5). Option shape in 6.1.0 types: `aria: { enabled?: boolean, label?: {...}, decal?: { show?: boolean, decals?: ... } }`. `enabled` generates an `aria-label` description; `decal.show` adds patterns for colour-blind users.
- Sampling: line `sampling?: 'none' | 'average' | 'min' | 'max' | 'minmax' | 'sum' | 'lttb' | SamplingFunc`. Use `'lttb'` for dense time series; `'minmax'` (since 5.5) keeps extremes.
- Renderer: Canvas for large element counts (over about 1k), heatmaps, big scatter; SVG for lower memory, crisp zoom, many small instances (sparklines in table cells). Since 5.3 SVG uses a virtual DOM and is faster.

---

## 15. Concrete recommendations

1. `pnpm dlx shadcn@latest init -t next -b base --preset base-nova`, then replace the neutral theme with our own OKLCH tokens, add status tokens (success, warning, info, destructive-foreground) and a real categorical chart palette mapped to `--chart-1..N`.
2. In `globals.css`: `@theme { --color-*: initial; }` then re-declare only semantic colours via `@theme inline`; define a dense type scale with `--text-*--line-height`; keep `--spacing: 0.25rem`.
3. Lint: eslint-plugin-better-tailwindcss 4.7.0 with `entryPoint`, `no-unknown-classes`, `no-conflicting-classes`, `no-restricted-classes` (arbitrary value regex, scoped to exclude `components/ui/**`). Prettier plugin for ordering with `tailwindFunctions: ["cn","cva","tv"]`. Run ESLint directly (Next 16 dropped `next lint`).
4. Variants: class-variance-authority + `cn` (configure `createCn` for custom tokens).
5. Tables: TanStack Table v9 `useTable` with only the features used; TanStack Virtual with fixed row heights per density and a CSS-sticky header; `tabular-nums` on numeric cells.
6. Charts: ECharts 6.1 via a thin in-house wrapper, tree-shaken imports, `AriaComponent` on, `setTheme()` wired to the app theme, `sampling: 'lttb'` on long series, SVG renderer for in-cell sparklines.
7. Fonts: `geist` npm package (full OpenType features); `tnum` per component, not global; do not rely on `slashed-zero`.
8. Icons: lucide-react 1.x with `LucideProvider`; separate brand-logo set.
9. Toasts: shadcn `toast` (Base UI). Command palette: Base UI Autocomplete in Dialog.
10. Explorer and VRT: `/design-system` route plus Playwright `toHaveScreenshot` in Docker; add Argos later if needed.
