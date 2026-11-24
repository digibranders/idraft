import { Check, Circle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { ProjectMark } from '@/components/app/shell/project-mark';
import { Icon } from '@/components/ui/icon';
import { normalizeDomain } from '@/lib/domains/normalize';
import { languageName } from '@/lib/format/language';
import { NO_LANGUAGE, WEEKDAYS } from '@/lib/projects/fields';
import { projectPath } from '@/lib/routes/paths';

/** One part of the form: a titled panel whose fields stay at the form width. */
export function FormSection({
  id,
  title,
  description,
  children,
}: Readonly<{ id: string; title: string; description: string; children: ReactNode }>): ReactNode {
  return (
    <section
      role="group"
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-surface p-4 md:p-5"
    >
      <div className="max-w-form">
        <h2 id={id} className="type-subsection-title">
          {title}
        </h2>
        <p className="mt-1 type-meta">{description}</p>
      </div>
      <div className="flex max-w-form flex-col gap-4">{children}</div>
    </section>
  );
}

export interface SummaryValues {
  name?: string | undefined;
  slug?: string | undefined;
  primary_domain?: string | undefined;
  brand?: string | undefined;
  location?: { name?: string | undefined } | null | undefined;
  timezone?: string | undefined;
  deep_check_weekday?: string | undefined;
  default_language_code?: string | undefined;
}

/**
 * What the project will be, as the person types it: the mark and name, then each setting, and what is still
 * missing before it can be created. It only reads the form; nothing here is a field.
 */
export function ProjectSummary({
  values,
  workspaceSlug,
}: Readonly<{ values: SummaryValues; workspaceSlug: string }>): ReactNode {
  const t = useTranslations('onboarding');
  const days = useTranslations('common.weekdays');
  const name = values.name?.trim() ?? '';
  const brand = values.brand?.trim() ?? '';
  const site = normalizeDomain(values.primary_domain ?? '');
  const host = site.ok ? site.display : null;
  const slug = values.slug?.trim() ?? '';
  const weekday = WEEKDAYS[Number(values.deep_check_weekday)];
  const language = values.default_language_code;
  const notSet = t('summary.notSet');
  const rows: readonly { label: string; value: string | null; mono?: boolean }[] = [
    { label: t('slug'), value: slug === '' ? null : projectPath(workspaceSlug, slug), mono: true },
    { label: t('domain'), value: host },
    { label: t('brand'), value: brand === '' ? null : brand },
    { label: t('location'), value: values.location?.name ?? null },
    { label: t('timezone'), value: values.timezone ?? null },
    { label: t('weekday'), value: weekday === undefined ? null : days(weekday) },
    {
      label: t('language'),
      value: language === undefined || language === NO_LANGUAGE ? null : languageName(language),
    },
  ];
  const needed = [
    { label: t('name'), done: name !== '' },
    { label: t('domain'), done: host !== null },
    { label: t('brand'), done: brand !== '' },
  ];
  const ready = needed.every((item) => item.done);
  return (
    <aside
      aria-labelledby="new-project-summary"
      className="flex min-w-0 flex-col rounded-lg border border-border bg-surface lg:sticky lg:top-topbar"
    >
      <div className="flex items-center gap-3 border-b border-border-subtle p-4">
        <ProjectMark name={name === '' ? '?' : name} domain={host} size="md" />
        <div className="flex min-w-0 flex-col">
          <h2 id="new-project-summary" className="type-subsection-title">
            {t('summary.title')}
          </h2>
          <span className="truncate type-meta">{name === '' ? t('summary.unnamed') : name}</span>
        </div>
      </div>
      <dl className="flex flex-col gap-3 p-4">
        {rows.map((row) => (
          <div key={row.label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="type-meta">{row.label}</dt>
            <dd
              className={
                row.value === null
                  ? 'type-body text-foreground-muted'
                  : row.mono === true
                    ? 'type-mono break-all text-foreground'
                    : 'truncate type-body text-foreground'
              }
            >
              {row.value ?? notSet}
            </dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-border-subtle p-4">
        <p className="type-body-strong">{ready ? t('summary.ready') : t('summary.needed')}</p>
        <ul role="list" className="mt-2 flex flex-col gap-1">
          {needed.map((item) => (
            <li key={item.label} className="flex items-center gap-2 type-body text-foreground-secondary">
              <Icon
                icon={item.done ? Check : Circle}
                size="sm"
                className={item.done ? 'text-positive-text' : 'text-foreground-muted'}
              />
              <span>{item.label}</span>
              <span className="sr-only">{item.done ? t('summary.done') : t('summary.todo')}</span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
