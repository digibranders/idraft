/**
 * Types for customizable layouts: which cards and headline numbers a person sees on a screen.
 * Spec: docs/superpowers/specs/2026-09-30-layout-customization-design.md (sections 4, 6 and 7).
 *
 * Everything in this folder is pure: no React, no DOM, no fetching. It is destined for packages/contracts,
 * where the API's list of valid keys is generated from the same catalog.
 */

export const WIDTHS = ['third', 'half', 'two_thirds', 'full'] as const;
export type Width = (typeof WIDTHS)[number];

/** A customizable place. More screens are added to the catalog as they are built. */
export type ScreenKey = 'overview' | 'inspector.keyword';

export type Channel = 'seo' | 'ai';
export type CardGroup = 'seo' | 'ai' | 'cross' | 'activity';
export type Breakpoint = 'wide' | 'medium' | 'narrow';

/** Engine codes of ai.engines (docs/04-data-model.md) that headline numbers and card options may name. */
export type EngineCode = 'chatgpt_web' | 'gemini_web' | 'google_ai_mode' | 'google_ai_overview';

/** One card type placed on a screen. */
export interface CardItem {
  /** Stable within the document; used for keys, focus and reordering. */
  id: string;
  type: string;
  /** Only on screens whose cards have widths (dashboard pages). */
  width?: Width;
  /** Only on card types that declare options. Values are always project-agnostic. */
  options?: Record<string, string>;
}

/** One headline metric in the strip at the top of a page. */
export interface NumberItem {
  id: string;
  /** Metric registry key (docs/16-metrics-methodology.md section 2.1). */
  metric: string;
  /** Required on AI metrics, which are never pooled across engines; absent on SEO metrics. */
  engine?: EngineCode;
}

/** The stored document for one screen: a full snapshot, never a diff against a default. */
export interface LayoutDocument {
  schema: 1;
  /** Present on screens with a numbers zone. */
  numbers?: NumberItem[];
  /** Present on screens with a cards zone. */
  cards?: CardItem[];
}

/** An enum option of a card type. The first release has enum options only. */
export interface OptionDefinition {
  label: string;
  values: ReadonlyArray<{ value: string; label: string }>;
  default: string;
}

export interface CardTypeDefinition {
  key: string;
  title: string;
  /** One sentence: the question the card answers. Shown in the catalog. */
  description: string;
  group: CardGroup;
  screens: ReadonlyArray<ScreenKey>;
  /** Allowed widths, the first being the default. Empty for drawer cards, which have no widths. */
  widths: ReadonlyArray<Width>;
  /** 1 for most types; more for types that are useful several times with different options. */
  maxInstances: number;
  options: Readonly<Record<string, OptionDefinition>>;
  /** Channels the project must have: every one of `all`, and at least one of `any` when `any` is not empty. */
  channels: { all: ReadonlyArray<Channel>; any: ReadonlyArray<Channel> };
  /** Permission key the person must hold to see this card at all, or null. */
  permission: string | null;
  /** Integration the project must have connected, or null. */
  integration: string | null;
  status: 'active' | 'retired';
  /** Business date the type was released; the catalog shows "New" for 30 days. */
  addedOn: string;
}

export interface NumberDefinition {
  metric: string;
  label: string;
  channel: Channel;
  /** True for AI metrics: the number is always for one engine. */
  perEngine: boolean;
  screens: ReadonlyArray<ScreenKey>;
}

export interface ScreenDefinition {
  key: ScreenKey;
  title: string;
  zones: { numbers: boolean; cards: boolean; widths: boolean };
  /** The layout shipped in the code. It is what a person sees before anyone customizes. */
  builtin: LayoutDocument;
}

/** What the current project and person can use; decides card availability. */
export interface Capabilities {
  channels: ReadonlyArray<Channel>;
  permissions: ReadonlyArray<string>;
  integrations: ReadonlyArray<string>;
}

export type Availability = { state: 'available' } | { state: 'unavailable'; reason: string } | { state: 'hidden' };

export type LayoutSource = 'personal' | 'team' | 'builtin';
