import type { Metadata } from 'next';
import Image from 'next/image';

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
        <div className="sticky top-32 rounded-t-[12rem] rounded-b-[2rem] bg-ink/[0.04] p-1.5 shadow-lift ring-1 ring-ink/[0.06]">
          <div className="relative aspect-[4/5] overflow-hidden rounded-t-[11.6rem] rounded-b-[1.6rem]">
            <Image src="/images/arch.png" alt="A tall rounded arch of frosted glass filled with soft blue light." fill priority sizes="30vw" className="object-cover" />
          </div>
        </div>
      </div>
    </section>
  );
}
