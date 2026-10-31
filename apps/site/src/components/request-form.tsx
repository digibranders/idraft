'use client';

import { useState } from 'react';

import { CONTACT_EMAIL } from '@/content';

import { Button } from './button';
import { Select } from './select';

const FOCUS_OPTIONS = ['Rankings and AI answers', 'Rankings only', 'AI answers only', 'Website audits', 'Something else'] as const;

type Errors = Partial<Record<'name' | 'email' | 'site', string>>;

const FIELD = 'w-full rounded-2xl bg-surface px-4 py-3.5 text-[15px] text-ink ring-1 ring-ink/15 transition duration-300 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-cobalt';
const LABEL = 'mb-2 block text-sm font-medium text-ink';
const ERROR = 'mt-2 text-sm text-[#b42318]';

/**
 * There is no form backend yet. Submitting validates the fields and opens a ready-to-send email to the team,
 * and the page says so. Replace with a POST when the access request endpoint exists.
 */
export function RequestForm() {
  const [errors, setErrors] = useState<Errors>({});
  const [sent, setSent] = useState(false);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const read = (key: string) => String(data.get(key) ?? '').trim();
    const next: Errors = {};
    if (!read('name')) next.name = 'Tell us your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(read('email'))) next.email = 'Enter a work email, for example name@company.com.';
    if (!read('site')) next.site = 'Enter the site you want to track.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const body = [`Name: ${read('name')}`, `Work email: ${read('email')}`, `Site: ${read('site')}`, `Interested in: ${read('focus')}`, '', read('note')].join('\n');
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Request access to idraft')}&body=${encodeURIComponent(body)}`;
    setSent(true);
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className={LABEL}>Your name</label>
          <input id="name" name="name" autoComplete="name" required aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'name-error' : undefined} className={FIELD} />
          {errors.name ? <p id="name-error" className={ERROR}>{errors.name}</p> : null}
        </div>
        <div>
          <label htmlFor="email" className={LABEL}>Work email</label>
          <input id="email" name="email" type="email" autoComplete="email" required aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'email-error' : undefined} className={FIELD} />
          {errors.email ? <p id="email-error" className={ERROR}>{errors.email}</p> : null}
        </div>
      </div>
      <div>
        <label htmlFor="site" className={LABEL}>Site to track</label>
        <input id="site" name="site" inputMode="url" autoComplete="url" placeholder="example.com" required aria-invalid={Boolean(errors.site)} aria-describedby={errors.site ? 'site-error' : undefined} className={FIELD} />
        {errors.site ? <p id="site-error" className={ERROR}>{errors.site}</p> : null}
      </div>
      <div>
        <label htmlFor="focus" className={LABEL}>What are you most interested in?</label>
        <Select id="focus" name="focus" options={FOCUS_OPTIONS} />

      </div>
      <div>
        <label htmlFor="note" className={LABEL}>Anything we should know? <span className="font-normal text-ink-3">Optional</span></label>
        <textarea id="note" name="note" rows={4} className={FIELD} />
      </div>
      <div className="flex flex-wrap items-center gap-5">
        <Button>Request access</Button>
        <p className="text-sm text-ink-3">This opens a draft in your email app, addressed to {CONTACT_EMAIL}.</p>
      </div>
      <p role="status" className={`text-[15px] text-cobalt-deep transition duration-500 ${sent ? 'opacity-100' : 'opacity-0'}`}>
        {sent ? 'Your email draft is open. Send it and we will reply with next steps.' : ''}
      </p>
    </form>
  );
}
