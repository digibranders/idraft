import type messages from '../../messages/en.json';

// Makes message keys typed: `t('errors.notFound.title')` compiles, a misspelled key does not.
declare module 'next-intl' {
  interface AppConfig {
    Locale: 'en';
    Messages: typeof messages;
  }
}
