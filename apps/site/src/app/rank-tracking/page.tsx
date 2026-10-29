import type { Metadata } from 'next';
import { Bookmarks, FileArrowUp, Funnel, GlobeHemisphereWest, Link as LinkIcon, SquaresFour } from '@phosphor-icons/react/dist/ssr';

import { CapabilityList } from '@/components/capability-list';
import { CtaBand } from '@/components/cta-band';
import { PageHero } from '@/components/page-hero';
import { ScreenFrame } from '@/components/mock/screen-frame';
import { RankStates } from '@/components/rank-states';

export const metadata: Metadata = {
  title: 'Rank tracking',
  description: 'Daily Google rankings by country and device, with the ranking page, SERP features and honest states for every gap.',
};

const ITEMS = [
  { icon: GlobeHemisphereWest, title: 'Every country and device', body: 'Track the same keyword in several locations on desktop and mobile, each as its own series.' },
  { icon: LinkIcon, title: 'The page that ranks', body: 'See which URL ranks, how the position moved since the previous check, and when the ranking page changed.' },
  { icon: SquaresFour, title: 'SERP features', body: 'Know whether a featured snippet, a video, a map pack or an AI Overview showed, and whether you own it.' },
  { icon: Funnel, title: 'Depth you choose', body: 'Top 20 every day and top 100 every week by default, so you pay for precision where traffic is.' },
  { icon: Bookmarks, title: 'Groups, tags and priority', body: 'Organise keywords by topic, tag and priority, and filter any view down to the set you are working on.' },
  { icon: FileArrowUp, title: 'Bring your list', body: 'Import up to 10,000 keywords from a CSV with column mapping and a report of every row that was skipped.' },
] as const;

export default function RankTrackingPage() {
  return (
    <>
      <PageHero
        eyebrow="Rank tracking"
        title="Know where you rank, and how sure we are."
        lead="Daily Google positions for every keyword, country and device, with the page that ranks and a clear state for every check."
        visual={<ScreenFrame src="/screens/keyword-inspector.png" alt="The Keywords screen of the idraft app with one keyword open: volume by month, difficulty, cost per click, groups and topics." />}
      />
      <CapabilityList title="Everything a position needs around it." lead="A number alone does not explain a drop. Each row carries what you need to read it." items={ITEMS} />
      <RankStates />
      <CtaBand title="Put your keywords on a record you can trust." />
    </>
  );
}
