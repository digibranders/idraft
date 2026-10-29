import { Bento } from '@/components/bento';
import { Compare } from '@/components/compare';
import { CtaBand } from '@/components/cta-band';
import { Engines } from '@/components/engines';
import { Faq } from '@/components/faq';
import { Journey } from '@/components/journey';
import { HomeHero } from '@/components/home-hero';
import { HorizontalEngines } from '@/components/horizontal-engines';
import { FeaturesTeaser } from '@/components/features-teaser';
import { Roles } from '@/components/roles';

export default function Home() {
  return (
    <>
      <HomeHero />
      <Engines />
      <Journey />
      <HorizontalEngines />
      <Bento />
      <Compare />
      <FeaturesTeaser />
      <Roles />
      <Faq />
      <CtaBand title="See your rank and your answer together." body="We are onboarding teams by invitation. Tell us what you track and we will reply with next steps." />
    </>
  );
}
