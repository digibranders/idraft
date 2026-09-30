import { getRequestConfig } from 'next-intl/server';

import messages from '../../messages/en.json';

import { LOCALE, TIME_ZONE } from './locale';

export default getRequestConfig(() => ({ locale: LOCALE, messages, timeZone: TIME_ZONE }));
