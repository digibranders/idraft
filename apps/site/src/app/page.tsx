import { Bento } from '@/components/bento';
import { Closing } from '@/components/closing';
import { Engines } from '@/components/engines';
import { Faq } from '@/components/faq';
import { Hero } from '@/components/hero';
import { Nav } from '@/components/nav';
import { ScrollRungs } from '@/components/scroll-rungs';
import { Setup } from '@/components/setup';
import { Story } from '@/components/story';

export default function Home() {
  return (
    <>
      <Nav />
      <ScrollRungs />
      <main>
        <Hero />
        <Engines />
        <Story />
        <Bento />
        <Setup />
        <Faq />
      </main>
      <Closing />
    </>
  );
}
