import type { Metadata } from 'next';
import {
  ChartLineUp,
  ChatsCircle,
  Compass,
  FileMagnifyingGlass,
  FileText,
  Globe,
  Graph,
  Plugs,
  Users,
} from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';

import { CtaBand } from '@/components/cta-band';
import { PageHero } from '@/components/page-hero';
import { Reveal } from '@/components/reveal';
import { ScreenFrame } from '@/components/mock/screen-frame';

export const metadata: Metadata = {
  title: 'Features',
  description: 'Rank tracking, AI visibility, source intelligence, website audit, page performance, discovery, competitors, reports and integrations, on one record per topic.',
};

type Feature = { icon: Icon; title: string; body: string; tone: string; href?: string };

// Each group has its own color family, so the page reads as groups of work rather than one long list.
const GROUPS: readonly { heading: string; lead: string; items: readonly Feature[] }[] = [
  {
    heading: 'Search',
    lead: 'Know where every page stands in Google, and why.',
    items: [
      { icon: ChartLineUp, title: 'Rank tracking', body: 'Daily positions by country and device, with the ranking page, SERP features and an honest state for every check.', tone: 'bg-wash text-cobalt-deep', href: '/rank-tracking' },
      { icon: FileMagnifyingGlass, title: 'Website audit', body: 'Crawl your site and list what holds pages back: crawlability and indexing, broken links and redirects, duplicate content, structured data and Core Web Vitals, tied to the keywords you track.', tone: 'bg-wash text-cobalt-deep' },
      { icon: FileText, title: 'Page performance', body: 'Clicks, impressions, CTR and position for each URL from Search Console, compared month over month, with each page flagged as growing, stable or slipping.', tone: 'bg-wash text-cobalt-deep' },
    ],
  },
  {
    heading: 'AI answers',
    lead: 'See what AI says about your topics, and who it trusts.',
    items: [
      { icon: ChatsCircle, title: 'AI visibility', body: 'Mentions, position and citations in ChatGPT, Gemini, Google AI Overviews and AI Mode, each with the checks behind it.', tone: 'bg-violet-wash text-violet', href: '/ai-visibility' },
      { icon: Globe, title: 'Sources', body: 'Every source an answer cites, grouped by domain and by type, with first seen and last seen dates.', tone: 'bg-violet-wash text-violet', href: '/sources' },
      { icon: Graph, title: 'Matrix', body: 'Keywords and prompts side by side, so a topic that ranks but goes unnamed, or the other way round, is easy to see.', tone: 'bg-violet-wash text-violet' },
    ],
  },
  {
    heading: 'Around the work',
    lead: 'Find what to track next, follow rivals and share the result.',
    items: [
      { icon: Compass, title: 'Discovery', body: 'Suggested keywords and prompts, found from your rankings, your rivals and the questions people ask AI, waiting in an inbox you approve.', tone: 'bg-amber-wash text-ink' },
      { icon: Users, title: 'Competitors', body: 'Every rival you follow, on the same keywords and prompts, with who is gaining in search and in AI answers.', tone: 'bg-amber-wash text-ink', href: '/sources' },
      { icon: FileText, title: 'Reports', body: 'Rankings, AI answers and sources in one shareable report, with the evidence behind each number.', tone: 'bg-mint-wash text-mint' },
      { icon: Plugs, title: 'Integrations', body: 'Search Console, analytics and other first-party sources next to the data idraft collects.', tone: 'bg-mint-wash text-mint' },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <>
      <PageHero
        eyebrow="Features"
        title="Everything on one record."
        lead="Rankings, AI answers, a website audit, page performance, discovery, competitors, reports and integrations, all tied to the same topics."
        visual={<ScreenFrame src="/screens/p-overview.png" alt="The Overview screen of the idraft app: SEO visibility and the mention rate in every AI engine, with a trend chart and the rank distribution." />}
      />

      {GROUPS.map((group) => (
        <section key={group.heading} className="mx-auto max-w-[1320px] px-5 py-16 md:px-8 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
            <Reveal className="lg:col-span-4">
              <div className="lg:sticky lg:top-32">
                <h2 className="text-[clamp(2.1rem,3.6vw,3.2rem)] leading-[1.05] font-semibold tracking-[-0.045em]">{group.heading}</h2>
                <p className="mt-4 max-w-[30ch] text-lg leading-relaxed text-ink-2">{group.lead}</p>
              </div>
            </Reveal>
            <ul className="grid gap-4 sm:grid-cols-2 lg:col-span-8">
              {group.items.map((item, index) => {
                const Glyph = item.icon;
                return (
                  <li key={item.title} className={group.items.length % 2 === 1 && index === 0 ? 'sm:col-span-2' : ''}>
                    <Reveal delay={(index % 2) * 0.07} className="h-full">
                      <div className="h-full rounded-[2rem] bg-ink/[0.04] p-1.5 ring-1 ring-ink/[0.06]">
                        <div className="flex h-full flex-col rounded-[calc(2rem-0.375rem)] bg-surface p-7">
                          <span className={`grid size-12 place-items-center rounded-2xl ${item.tone}`}>
                            <Glyph size={24} weight="duotone" aria-hidden="true" />
                          </span>
                          <h3 className="mt-6 text-xl font-semibold tracking-[-0.03em]">{item.title}</h3>
                          <p className="mt-2 leading-relaxed text-ink-2">{item.body}</p>
                        </div>
                      </div>
                    </Reveal>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ))}

      <CtaBand title="Start with the topics that matter most." body="Request access and tell us which keywords, prompts and pages you want to follow first." />
    </>
  );
}
