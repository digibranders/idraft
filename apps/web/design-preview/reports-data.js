/**
 * Reports (route #/reports): the mock data. The report is what a guest link shows: the last 28 days of
 * Eventus Security, per engine, with counts behind every percentage. No costs, no prompt or answer texts.
 * "Today" is fixed so the dates read the same on every load.
 */
export const TODAY = new Date('2026-11-24T10:00:00Z');
export const HOST = 'eventussecurity.com';
export const SHARE_ORIGIN = 'https://app.idraft.ai/public/reports/';
export const RECIPIENTS_MAX = 10;
export const SCHEDULES_MAX = 10;
export const EXPIRY_CHOICES = [['7', '7 days'], ['30', '30 days'], ['90', '90 days']];
export const RHYTHMS = [['weekly', 'Weekly, on Monday'], ['monthly', 'Monthly, on the 1st']];

const day = (offset) => new Date(TODAY.getTime() + offset * 86400000);
export const addDays = (date, days) => new Date(date.getTime() + days * 86400000);

export const links = [
  { id: 'l1', createdAt: day(-9), expiresAt: day(21), revokedAt: null },
  { id: 'l2', createdAt: day(-41), expiresAt: day(-11), revokedAt: null },
  { id: 'l3', createdAt: day(-20), expiresAt: day(10), revokedAt: day(-15) },
];

export const schedules = [
  { id: 's1', frequency: 'weekly', recipients: ['anita.rao@eventus-clients.example', 'ops@eventus-clients.example'], paused: false, nextRunAt: new Date('2026-11-30T06:00:00Z'), lastSentAt: new Date('2026-11-23T06:00:00Z'), lastError: null },
  { id: 's2', frequency: 'monthly', recipients: ['board@eventus-clients.example'], paused: false, nextRunAt: new Date('2026-12-01T06:00:00Z'), lastSentAt: null, lastError: '1 of 1 emails were not sent' },
];

const week = (start, mentioned, cited, sov) => ({ start, mentioned, cited, sov });
export const REPORT = {
  host: HOST,
  from: '2026-10-28',
  to: '2026-11-24',
  timezone: 'Asia/Kolkata',
  promptCount: 24,
  engines: [
    {
      code: 'chatgpt',
      name: 'ChatGPT',
      mentioned: { n: 71, d: 192 },
      cited: { n: 38, d: 192 },
      sov: { n: 71, d: 214 },
      weeks: [
        week('2026-10-26', { n: 13, d: 48 }, { n: 6, d: 48 }, { n: 13, d: 55 }),
        week('2026-11-02', { n: 15, d: 48 }, { n: 8, d: 48 }, { n: 15, d: 53 }),
        week('2026-11-09', { n: 19, d: 48 }, { n: 11, d: 48 }, { n: 19, d: 54 }),
        week('2026-11-16', { n: 24, d: 48 }, { n: 13, d: 48 }, { n: 24, d: 52 }),
      ],
    },
    {
      code: 'gemini',
      name: 'Gemini',
      mentioned: { n: 44, d: 168 },
      cited: { n: 29, d: 168 },
      sov: { n: 44, d: 201 },
      weeks: [
        week('2026-10-26', { n: 8, d: 42 }, { n: 5, d: 42 }, { n: 8, d: 50 }),
        week('2026-11-02', { n: 9, d: 42 }, { n: 6, d: 42 }, { n: 9, d: 51 }),
        week('2026-11-09', { n: 12, d: 42 }, { n: 8, d: 42 }, { n: 12, d: 49 }),
        week('2026-11-16', { n: 15, d: 42 }, { n: 10, d: 42 }, { n: 15, d: 51 }),
      ],
    },
  ],
  brands: [
    { name: 'Eventus Security', role: 'own', engines: [{ code: 'chatgpt', mentioned: { n: 71, d: 192 }, sov: { n: 71, d: 214 } }, { code: 'gemini', mentioned: { n: 44, d: 168 }, sov: { n: 44, d: 201 } }] },
    { name: 'CyberNX', role: 'competitor', engines: [{ code: 'chatgpt', mentioned: { n: 96, d: 192 }, sov: { n: 96, d: 214 } }, { code: 'gemini', mentioned: { n: 81, d: 168 }, sov: { n: 81, d: 201 } }] },
    { name: 'Wipro CyberSecurity', role: 'competitor', engines: [{ code: 'chatgpt', mentioned: { n: 47, d: 192 }, sov: { n: 47, d: 214 } }, { code: 'gemini', mentioned: { n: 76, d: 168 }, sov: { n: 76, d: 201 } }] },
  ],
  domains: [
    { domain: 'eventussecurity.com', role: 'own', units: 67, share: { n: 67, d: 413 } },
    { domain: 'cybernx.com', role: 'competitor', units: 58, share: { n: 58, d: 413 } },
    { domain: 'gartner.com', role: 'third_party', units: 41, share: { n: 41, d: 413 } },
    { domain: 'techtarget.com', role: 'third_party', units: 33, share: { n: 33, d: 413 } },
    { domain: 'clutch.co', role: 'third_party', units: 27, share: { n: 27, d: 413 } },
    { domain: 'wikipedia.org', role: 'third_party', units: 19, share: { n: 19, d: 413 } },
  ],
};

export const stateOf = (link) => {
  if (link.revokedAt) return 'revoked';
  return link.expiresAt <= TODAY ? 'expired' : 'active';
};
