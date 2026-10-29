import { Button } from '@/components/button';

export default function NotFound() {
  return (
    <section className="mx-auto flex min-h-[80dvh] max-w-[1320px] flex-col items-start justify-center px-5 pt-32 pb-20 md:px-8">
      <p className="font-mono text-[clamp(5rem,16vw,12rem)] leading-none font-medium tracking-[-0.06em] text-cobalt">404</p>
      <h1 className="mt-6 text-[clamp(2rem,4vw,3.4rem)] leading-[1.05] font-semibold tracking-[-0.045em]">This page is not ranked anywhere.</h1>
      <p className="mt-4 max-w-[44ch] text-lg leading-relaxed text-ink-2">The link may be old or mistyped. The home page is a good place to start again.</p>
      <div className="mt-9">
        <Button href="/">Back to the home page</Button>
      </div>
    </section>
  );
}
