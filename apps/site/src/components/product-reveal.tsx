import { HeroDashboard } from './hero-dashboard';
import { Reveal } from './reveal';

/**
 * The proof, right after the cinematic first screen: the product itself, tilted back and rising flat as you
 * scroll into it. Honest about what it is: the real layout with illustrative data, and you can click through it.
 */
export function ProductReveal() {
  return (
    <section aria-labelledby="product-reveal" className="mx-auto max-w-[1320px] px-5 pt-16 pb-8 md:px-8 lg:pt-24">
      <Reveal>
        <div className="mx-auto max-w-3xl text-center">
          <h2 id="product-reveal" className="text-[clamp(2.2rem,4.4vw,3.8rem)] leading-[1.02] font-semibold tracking-[-0.05em] text-balance">
            This is the product.
          </h2>
          <p className="mx-auto mt-5 max-w-[46ch] text-lg leading-relaxed text-pretty text-ink-2">The real layout with illustrative data. Click through keywords, prompts, the matrix and sources.</p>
        </div>
      </Reveal>
      <div className="mt-12 lg:mt-16">
        <HeroDashboard />
      </div>
    </section>
  );
}
