'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { AnalyticsChooser } from './analytics-chooser';
import { isDomainProperty, type Product, type ProductSection as Section } from './google-model';
import type { GoogleScope } from './google-queries';
import { PropertyChooser } from './property-chooser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Integration } from '@/lib/api/types';

export interface ProductSectionProps {
  product: Product;
  section: Section;
  scope: GoogleScope;
  account: string | null;
  /** The member may change connections and properties. */
  canManage: boolean;
  /** Google no longer accepts the saved sign-in (the banner at the top says so for both products). */
  reauth: boolean;
  /** Asks to switch the chosen property off so another can be chosen. */
  onChange: (integration: Integration) => void;
  /** Called once a property is saved. */
  onChosen: () => void;
  onReconnect: () => void;
}

/**
 * One product of the Google connection, with a property of its own (24-page-templates.md section 9.12):
 * the property chosen, with a way to change it; the picker when the connection has none for this product;
 * or, when the person did not grant this product's permission, what to do about it. The state of one product
 * never decides the other's: a connection can have Search Console and not GA4.
 */
export function ProductSection({
  product,
  section,
  scope,
  account,
  canManage,
  reauth,
  onChange,
  onChosen,
  onReconnect,
}: ProductSectionProps): ReactElement {
  const t = useTranslations('integrations');
  const titleId = `${product}-property-title`;
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-5 py-4"
    >
      <div>
        <h2 id={titleId} className="type-section-title">
          {t(`product.${product}.title`)}
        </h2>
        {product === 'ga4' ? <p className="mt-1 type-meta">{t('product.ga4.importNote')}</p> : null}
      </div>
      {section.kind === 'chosen' ? (
        <dl>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="type-meta text-foreground-tertiary">{t('product.property')}</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-2 type-body text-foreground">
              <span className="type-mono wrap-anywhere">{section.integration.external_property}</span>
              {product === 'gsc' ? (
                <Badge variant="outline">
                  {t(
                    `propertyTypes.${isDomainProperty(section.integration.external_property) ? 'domain' : 'urlPrefix'}`,
                  )}
                </Badge>
              ) : null}
              {canManage && !reauth ? (
                <Button variant="link" onClick={() => onChange(section.integration)}>
                  {t('product.change')}
                </Button>
              ) : null}
            </dd>
          </div>
        </dl>
      ) : null}
      {section.kind === 'choose' && product === 'gsc' ? (
        <PropertyChooser
          {...scope}
          connection={section.connection}
          account={account}
          onChosen={onChosen}
          onReconnect={onReconnect}
        />
      ) : null}
      {section.kind === 'choose' && product === 'ga4' ? (
        <AnalyticsChooser
          {...scope}
          connection={section.connection}
          account={account}
          onChosen={onChosen}
          onReconnect={onReconnect}
        />
      ) : null}
      {section.kind === 'access-missing' ? (
        <div className="flex flex-col items-start gap-2">
          <p className="type-body">{t(`product.${product}.accessMissing`)}</p>
          {section.integration === null ? null : (
            <p className="type-meta">
              {t('product.keptProperty', { property: section.integration.external_property })}
            </p>
          )}
          {canManage ? (
            <Button size="sm" onClick={onReconnect}>
              {t('product.reconnect')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {section.kind === 'unavailable' ? (
        <p className="type-body text-foreground-secondary">
          {reauth ? t('product.reconnectFirst') : t('product.noneChosen')}
        </p>
      ) : null}
    </section>
  );
}
