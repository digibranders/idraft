import type { Metadata } from 'next';
import { Binoculars, Clock, Graph, ListMagnifyingGlass, SealCheck, Swap } from '@phosphor-icons/react/dist/ssr';

import { CapabilityList } from '@/components/capability-list';
import { CtaBand } from '@/components/cta-band';
import { PageHero } from '@/components/page-hero';
import { ScreenFrame } from '@/components/mock/screen-frame';

export const metadata: Metadata = {
  title: 'Sources and rivals',
  description: 'See which sources AI answers cite, who earns the mention, and how your competitors move on the same keywords and prompts.',
};

const ITEMS = [
  { icon: ListMagnifyingGlass, title: 'Every cited source', body: 'Each URL an answer cites, cleaned and grouped by domain, so the same page is never counted twice.' },
  { icon: SealCheck, title: 'Who the AI trusts', body: 'Domains sorted by type, such as publisher, forum, review site or competitor, so you see where mentions are earned.' },
  { icon: Graph, title: 'The source graph', body: 'See which sources feed which answers, and which topics lean on the same few domains.' },
  { icon: Swap, title: 'Rivals on the same scale', body: 'Track competitors on your keywords and prompts and see who is gaining in search and in AI answers.' },
  { icon: Clock, title: 'First seen, last seen', body: 'Know when a source started being cited and whether it still is, so opportunities carry a date.' },
  { icon: Binoculars, title: 'Opportunities, with evidence', body: 'Pages and publishers worth a closer look, shown with the data behind them and never described as a guarantee.' },
] as const;

export default function SourcesPage() {
  return (
    <>
      <PageHero
        eyebrow="Sources and rivals"
        title="See who the answers trust, and who is catching up."
        lead="Every source an AI answer cites and every competitor on your topics, on the same record as your own results."
        visual={<ScreenFrame src="/screens/p-overview.png" alt="The Overview screen: SEO visibility and the mention rate in every AI engine, with a trend chart and the rank distribution." />}
      />
      <CapabilityList title="From a citation to a plan." lead="Knowing who gets cited tells you where to earn a mention." items={ITEMS} />
      <CtaBand title="Learn where the mentions are earned." />
    </>
  );
}
