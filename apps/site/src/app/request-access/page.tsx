import type { Metadata } from 'next';

import { RequestForm } from '@/components/request-form';

export const metadata: Metadata = {
  title: 'Request access',
  description: 'idraft is onboarding teams by invitation. Tell us what you track and we will reply with next steps.',
};

export default function RequestAccessPage() {
  return (
    <section className="relative isolate mx-auto grid max-w-[1320px] gap-14 overflow-x-clip px-5 pt-36 pb-24 md:px-8 lg:grid-cols-12 lg:gap-16 lg:pt-40">
      <div aria-hidden="true" className="absolute -top-40 -right-40 -z-10 size-[44rem] rounded-full bg-wash blur-[120px]" />
      <div className="lg:col-span-7">
        <h1 className="text-[clamp(2.6rem,5vw,4.6rem)] leading-[1] font-semibold tracking-[-0.055em] text-balance">Request access to idraft.</h1>
        <p className="mt-6 max-w-[48ch] text-lg leading-relaxed text-ink-2 md:text-xl">We are onboarding teams by invitation. Tell us what you track and we will reply with next steps.</p>
        <div className="mt-12 rounded-[2rem] bg-ink/[0.04] p-1.5 ring-1 ring-ink/[0.06]">
          <div className="rounded-[calc(2rem-0.375rem)] bg-surface p-6 sm:p-10">
            <RequestForm />
          </div>
        </div>
      </div>
      <div className="hidden lg:col-span-5 lg:block">
        <div className="sticky top-32 rounded-[2rem] bg-ink/[0.04] p-1.5 shadow-lift ring-1 ring-ink/[0.06]">
          <div className="rounded-[calc(2rem-0.375rem)] bg-gradient-to-br from-violet-wash via-surface to-mint-wash p-8">
            <h2 className="text-2xl font-semibold tracking-[-0.035em]">What happens next</h2>
            <ol className="mt-8 flex flex-col gap-6">
              {[
                ['bg-violet', 'We read your note', 'A person looks at what you track and why.'],
                ['bg-coral', 'We reply with next steps', 'Usually within two working days.'],
                ['bg-mint', 'You add your first topics', 'A site, a few keywords and a few prompts are enough to start.'],
              ].map(([tone, title, body], index) => (
                <li key={title} className="flex gap-4">
                  <span className={`grid size-9 shrink-0 place-items-center rounded-full font-mono text-sm font-semibold text-white ${tone}`}>{index + 1}</span>
                  <div>
                    <p className="font-semibold">{title}</p>
                    <p className="mt-1 leading-relaxed text-ink-2">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
