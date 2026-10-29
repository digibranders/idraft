import { Bento } from '@/components/bento';
import { ClimbStage } from '@/components/climb-stage';
import { Compare } from '@/components/compare';
import { CtaBand } from '@/components/cta-band';
import { Engines } from '@/components/engines';
import { Faq } from '@/components/faq';
import { HomeHero } from '@/components/home-hero';
import { HorizontalEngines } from '@/components/horizontal-engines';
import { ProductTour } from '@/components/product-tour';
import { Reveal } from '@/components/reveal';
import { RoadmapTeaser } from '@/components/roadmap-teaser';
import { Roles } from '@/components/roles';
import { TextReveal } from '@/components/text-reveal';

/*
 * data-stop marks where the climb ribbon passes: it alternates sides down the page (see ClimbStage).
 * The hero sits outside the stage so the ribbon starts as the first screen lets go.
 */
export default function Home() {
  return (
    <>
      <HomeHero />
      <ClimbStage>
        <Engines />
        <section data-stop="right" className="mx-auto max-w-[1320px] px-5 py-28 md:px-8 lg:py-44">
          <Reveal>
            <TextReveal text="Search is no longer ten blue links. People now get answers from AI, and those answers name brands. idraft shows where you rank and where you are named, together, with the evidence behind each number." />
          </Reveal>
        </section>
        <div data-stop="left">
          <ProductTour />
        </div>
        <HorizontalEngines />
        <div data-stop="right">
          <Bento />
        </div>
        <div data-stop="left">
          <Compare />
        </div>
        <RoadmapTeaser />
        <div data-stop="right">
          <Roles />
        </div>
        <Faq />
      </ClimbStage>
      <CtaBand title="See your rank and your answer together." body="We are onboarding teams by invitation. Tell us what you track and we will reply with next steps." />
    </>
  );
}
