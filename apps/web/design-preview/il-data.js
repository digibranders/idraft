/**
 * Internal links: the illustrative crawl of eventussecurity.com that the Internal links mock reads
 * (docs/superpowers/specs/2026-11-16-internal-link-tracker-design.md). Every link has a placement as section 6.3
 * classifies it: content (editorial), auto_generated (previous, next and related posts), navigation, footer and
 * breadcrumb (template). Page numbers are sample data; the shapes (redirects, a broken target, a canonicalised page,
 * a noindex page, orphans, a post reachable only through "Next") are the cases the screens must show.
 */

export const HOST = 'eventussecurity.com';

/** The workspace's tier list (spec 5.1): position gives the code (T1) and the colour. Up to 8. */
export const tiers = [
  { id: 'tier-1', name: 'Money pages', description: 'Service, pricing and contact pages that bring leads' },
  { id: 'tier-2', name: 'Supporting pages', description: 'Hubs, industries, comparisons and case studies that lead to money pages' },
  { id: 'tier-3', name: 'Content pages', description: 'Blog posts, guides and resources' },
  { id: 'tier-4', name: 'Utility pages', description: 'About, legal, partners and careers' },
];

// id, path, title, manual tier (null = rule or untiered), status, extra
const P = (id, path, title, tier = null, extra = {}) => ({ id, path, title, manualTier: tier, status: 200, indexable: true, reason: '', inSitemap: true, tags: [], clicks: 0, impressions: 0, setBy: tier ? 'Priya Nair' : null, setOn: tier ? '12 Nov' : null, since: 1, ...extra });

export const pages = [
  P('home', '/', 'Eventus Security: managed security services', 'tier-2', { clicks: 2140, impressions: 31800 }),
  P('services', '/services', 'Managed security services', 'tier-2', { clicks: 410, impressions: 9200 }),
  P('soc', '/services/soc-as-a-service', 'SOC as a service', null, { clicks: 1320, impressions: 28400, tags: ['India'] }),
  P('mdr', '/services/managed-detection-and-response', 'Managed detection and response', null, { clicks: 860, impressions: 19700 }),
  P('vapt', '/services/vapt', 'Vulnerability assessment and penetration testing', null, { clicks: 940, impressions: 22100, tags: ['India'] }),
  P('siem', '/services/managed-siem', 'Managed SIEM', null, { clicks: 380, impressions: 11200 }),
  P('ir', '/services/incident-response', 'Incident response retainer', null, { clicks: 290, impressions: 8800 }),
  P('cloud', '/services/cloud-security', 'Cloud security posture management', null, { clicks: 120, impressions: 6400, tags: ['Campaign Q4'] }),
  P('iso', '/services/iso-27001-compliance', 'ISO 27001 compliance', null, { clicks: 510, impressions: 12900, tags: ['Compliance'] }),
  P('pci', '/services/pci-dss-compliance', 'PCI DSS compliance', null, { clicks: 330, impressions: 9100, tags: ['Compliance'] }),
  P('ot', '/services/ot-security', 'OT security', null, { clicks: 18, impressions: 1900 }),
  P('pentest', '/services/penetration-testing', 'Redirects to /services/vapt', null, { status: 301, redirect: 'vapt', inSitemap: false }),
  P('hunt', '/services/threat-hunting', 'Not found', null, { status: 404, inSitemap: false, indexable: false, reason: 'Not found (404)' }),
  P('socin', '/services/soc-as-a-service-india', 'SOC as a service in India', null, { indexable: false, reason: 'Canonical points to /services/soc-as-a-service', clicks: 40, impressions: 2100 }),
  P('pricing', '/pricing', 'Plans and pricing', 'tier-1', { clicks: 690, impressions: 10400 }),
  P('contact', '/contact', 'Talk to a security expert', 'tier-1', { clicks: 450, impressions: 5200 }),
  P('thanks', '/contact/thank-you', 'Thank you', null, { indexable: false, reason: 'noindex meta tag', inSitemap: false }),
  P('industries', '/industries', 'Industries we protect', null, { clicks: 90, impressions: 3100 }),
  P('banking', '/industries/banking', 'Cyber security for banks', null, { clicks: 260, impressions: 7300, tags: ['India', 'Compliance'] }),
  P('health', '/industries/healthcare', 'Cyber security for healthcare', null, { clicks: 70, impressions: 2600 }),
  P('mfg', '/industries/manufacturing', 'Cyber security for manufacturing', null, { clicks: 55, impressions: 2300 }),
  P('compare', '/compare/eventus-vs-in-house-soc', 'Eventus vs an in-house SOC', 'tier-2', { clicks: 140, impressions: 3900 }),
  P('case', '/resources/case-studies/private-bank-soc', 'Case study: SOC for a private bank', 'tier-2', { clicks: 85, impressions: 2200 }),
  P('blog', '/blog', 'Blog', null, { clicks: 160, impressions: 4100 }),
  P('b1', '/blog/what-is-a-soc', 'What is a SOC?', null, { clicks: 1810, impressions: 46200 }),
  P('b2', '/blog/soc-vs-mdr', 'SOC vs MDR: which one you need', null, { clicks: 940, impressions: 21800 }),
  P('b3', '/blog/vapt-checklist', 'VAPT checklist for 2026', null, { clicks: 720, impressions: 17400, tags: ['India'] }),
  P('b4', '/blog/siem-use-cases', '12 SIEM use cases', null, { clicks: 510, impressions: 13300 }),
  P('b5', '/blog/rbi-cyber-security-framework', 'The RBI cyber security framework', null, { clicks: 640, impressions: 15100, tags: ['India', 'Compliance'] }),
  P('b6', '/blog/incident-response-plan-template', 'Incident response plan template', null, { clicks: 430, impressions: 10200 }),
  P('b7', '/blog/cloud-misconfigurations', 'Seven cloud misconfigurations', null, { clicks: 260, impressions: 7800 }),
  P('b8', '/blog/iso-27001-checklist', 'ISO 27001 checklist', null, { clicks: 380, impressions: 9600, tags: ['Compliance'] }),
  P('b9', '/blog/ransomware-trends-2023', 'Ransomware trends 2023', null, { clicks: 34, impressions: 2900 }),
  P('b10', '/blog/threat-report-2022', 'Threat report 2022', null, { clicks: 6, impressions: 900 }),
  P('webinar', '/webinars/soc-maturity', 'Webinar: SOC maturity', null, { clicks: 22, impressions: 640, tags: ['Campaign Q4'], since: 3 }),
  P('about', '/about', 'About Eventus Security', 'tier-4', { clicks: 95, impressions: 2400 }),
  P('careers', '/careers', 'Careers', null, { clicks: 120, impressions: 1800 }),
  P('partners', '/partners', 'Partners', 'tier-4', { clicks: 14, impressions: 600 }),
  P('privacy', '/privacy-policy', 'Privacy policy', 'tier-4', { clicks: 9, impressions: 410 }),
  P('terms', '/terms', 'Terms of service', 'tier-4', { clicks: 4, impressions: 230 }),
];

/** URL rules of the project (spec 5.2), in order; the first match wins and a manual tier beats every rule. */
export const rules = [
  { id: 'r1', match: 'prefix', value: '/services/', tier: 'tier-1' },
  { id: 'r2', match: 'prefix', value: '/industries/', tier: 'tier-2' },
  { id: 'r3', match: 'exact', value: '/industries', tier: 'tier-2' },
  { id: 'r4', match: 'pattern', value: '/blog/*', tier: 'tier-3' },
  { id: 'r5', match: 'exact', value: '/blog', tier: 'tier-3' },
];

export const tagNames = ['Campaign Q4', 'Compliance', 'India'];

// -------------------------------------------------------------------------------------------------
// Links

const NAV = ['home', 'services', 'soc', 'mdr', 'vapt', 'industries', 'blog', 'pricing', 'about', 'contact'];
const FOOT = ['privacy', 'terms', 'careers', 'partners', 'iso', 'pci'];
const NAV_TEXT = { home: 'Home', services: 'Services', soc: 'SOC as a service', mdr: 'MDR', vapt: 'VAPT', industries: 'Industries', blog: 'Blog', pricing: 'Pricing', about: 'About', contact: 'Contact us', privacy: 'Privacy', terms: 'Terms', careers: 'Careers', partners: 'Partners', iso: 'ISO 27001', pci: 'PCI DSS' };

// Links a writer placed in the body: [from, to, anchor]
const EDITORIAL = [
  ['home', 'soc', '24x7 SOC as a service'], ['home', 'mdr', 'managed detection and response'], ['home', 'vapt', 'VAPT services'], ['home', 'case', 'how a private bank cut alert noise'], ['home', 'contact', 'Talk to an expert'], ['home', 'banking', 'security for banks'],
  ['services', 'soc', 'SOC as a service'], ['services', 'mdr', 'MDR'], ['services', 'vapt', 'VAPT'], ['services', 'siem', 'Managed SIEM'], ['services', 'ir', 'Incident response'], ['services', 'cloud', 'Cloud security'], ['services', 'iso', 'ISO 27001'], ['services', 'pci', 'PCI DSS'],
  ['soc', 'mdr', 'add MDR'], ['soc', 'siem', 'managed SIEM'], ['soc', 'ir', 'incident response retainer'], ['soc', 'pricing', 'See plans'], ['soc', 'contact', 'Book a consultation'], ['soc', 'b1', 'what a SOC does'], ['soc', 'case', 'private bank case study'], ['soc', 'hunt', 'threat hunting'], ['soc', 'compare', 'in-house SOC vs Eventus'],
  ['mdr', 'soc', 'SOC as a service'], ['mdr', 'ir', 'incident response'], ['mdr', 'pricing', 'MDR pricing'], ['mdr', 'contact', 'Get a quote'], ['mdr', 'b2', 'SOC vs MDR'],
  ['vapt', 'pci', 'PCI DSS testing'], ['vapt', 'iso', 'ISO 27001 audits'], ['vapt', 'contact', 'Scope a test'], ['vapt', 'b3', 'VAPT checklist'],
  ['siem', 'soc', 'SOC team'], ['siem', 'b4', 'SIEM use cases'], ['siem', 'contact', 'Talk to an expert'],
  ['ir', 'soc', '24x7 monitoring'], ['ir', 'b6', 'incident response plan template'], ['ir', 'contact', 'Call the response team'],
  ['cloud', 'b7', 'common cloud misconfigurations'], ['cloud', 'contact', 'Book a cloud review'],
  ['iso', 'b8', 'ISO 27001 checklist'], ['iso', 'vapt', 'VAPT'], ['iso', 'contact', 'Plan your audit'],
  ['pci', 'vapt', 'penetration testing'], ['pci', 'contact', 'Talk to a QSA partner'], ['pci', 'banking', 'banks and fintechs'],
  ['pricing', 'contact', 'Get a quote'], ['pricing', 'soc', 'SOC as a service'], ['pricing', 'mdr', 'MDR'],
  ['contact', 'thanks', 'Send'],
  ['industries', 'banking', 'Banking'], ['industries', 'health', 'Healthcare'], ['industries', 'mfg', 'Manufacturing'],
  ['banking', 'soc', 'SOC for banks'], ['banking', 'b5', 'RBI framework'], ['banking', 'case', 'private bank case study'], ['banking', 'pci', 'PCI DSS'],
  ['health', 'soc', 'SOC as a service'], ['health', 'ir', 'incident response'],
  ['mfg', 'soc', 'SOC as a service'], ['mfg', 'cloud', 'cloud security'],
  ['compare', 'soc', 'SOC as a service'], ['compare', 'mdr', 'MDR'], ['compare', 'pricing', 'compare plans'], ['compare', 'contact', 'Talk to an expert'],
  ['blog', 'b1', 'What is a SOC?'], ['blog', 'b2', 'SOC vs MDR'], ['blog', 'b3', 'VAPT checklist'], ['blog', 'b4', 'SIEM use cases'], ['blog', 'b5', 'RBI framework'], ['blog', 'b6', 'IR plan template'], ['blog', 'b7', 'Cloud misconfigurations'], ['blog', 'b8', 'ISO 27001 checklist'],
  ['b1', 'soc', 'SOC as a service'], ['b1', 'b2', 'SOC vs MDR'], ['b1', 'siem', 'SIEM'], ['b1', 'webinar', 'watch the SOC maturity webinar'],
  ['b2', 'mdr', 'managed detection and response'], ['b2', 'soc', 'SOC as a service'], ['b2', 'b1', 'what a SOC is'],
  ['b3', 'vapt', 'VAPT services'], ['b3', 'pentest', 'penetration testing'], ['b3', 'pci', 'PCI DSS'],
  ['b4', 'siem', 'managed SIEM'], ['b4', 'soc', 'SOC'], ['b4', 'b2', 'here'],
  ['b5', 'banking', 'security for banks'], ['b5', 'pci', 'PCI DSS'], ['b5', 'soc', 'SOC as a service'],
  ['b6', 'ir', 'incident response retainer'], ['b6', 'b1', 'read more'],
  ['b7', 'cloud', 'cloud security review'], ['b7', 'b8', 'click here'],
  ['b8', 'iso', 'ISO 27001 compliance'], ['b8', 'vapt', 'VAPT'],
  ['b9', 'soc', 'SOC as a service'], ['b9', 'b1', 'learn more'],
  ['case', 'soc', 'SOC as a service'], ['case', 'banking', 'banking'], ['case', 'contact', 'Talk to us'],
  ['about', 'soc', 'our SOC'], ['about', 'careers', 'join the team'], ['about', 'partners', 'our partners'],
  ['webinar', 'soc', 'SOC as a service'], ['webinar', 'b1', 'What is a SOC?'],
  ['careers', 'about', 'about us'],
];

// The blog template writes previous and next links, and two related posts (auto-generated, spec 6.3 rule 1)
const CHAIN = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'];
const RELATED = { b1: ['b2', 'b4'], b2: ['b1', 'b6'], b3: ['b8', 'b4'], b4: ['b1', 'b2'], b5: ['b8', 'b3'], b6: ['b2', 'b1'], b7: ['b8', 'b3'], b8: ['b3', 'b5'], b9: ['b1', 'b2'] };
const CRUMBS = { services: ['home'], industries: ['home'], blog: ['home'] };

const byId = Object.fromEntries(pages.map((page) => [page.id, page]));
const titleOf = (id) => byId[id].title;

function buildLinks() {
  const list = [];
  const add = (from, to, anchor, placement, rel = 'follow') => list.push({ id: `l${list.length + 1}`, from, to, anchor, placement, rel });
  EDITORIAL.forEach(([from, to, anchor]) => add(from, to, anchor, 'content'));
  CHAIN.forEach((id, index) => {
    if (index > 0) add(id, CHAIN[index - 1], `Previous: ${titleOf(CHAIN[index - 1])}`, 'auto_generated');
    if (index < CHAIN.length - 1) add(id, CHAIN[index + 1], `Next: ${titleOf(CHAIN[index + 1])}`, 'auto_generated');
    RELATED[id].forEach((to) => add(id, to, titleOf(to), 'auto_generated'));
  });
  pages.forEach((page) => {
    if (page.status !== 200 || page.id === 'thanks') return;
    NAV.forEach((to) => to !== page.id && add(page.id, to, NAV_TEXT[to], 'navigation'));
    FOOT.forEach((to) => to !== page.id && add(page.id, to, NAV_TEXT[to], 'footer', to === 'privacy' || to === 'terms' ? 'nofollow' : 'follow'));
    const crumbs = page.path.startsWith('/services/') ? ['home', 'services'] : page.path.startsWith('/industries/') ? ['home', 'industries'] : page.path.startsWith('/blog/') ? ['home', 'blog'] : CRUMBS[page.id] ?? [];
    crumbs.forEach((to) => add(page.id, to, NAV_TEXT[to], 'breadcrumb'));
  });
  return list;
}

export const links = buildLinks();

// -------------------------------------------------------------------------------------------------
// Crawl history (spec slices 2 and 3). The links above are the site as the latest crawl (n 4) saw it. Every link
// carries the first and the last crawl number it was seen in; the table below says what changed on the way.

links.forEach((link) => Object.assign(link, { since: 1, lastSeen: 4 }));
// A page that is new in crawl 3 brings its own links with it
links.filter((link) => link.from === 'webinar' || link.to === 'webinar').forEach((link) => Object.assign(link, { since: 3 }));

// Editorial links that already exist above, with when they were first or last seen: [from, to, patch]
const HISTORY = [
  ['b2', 'mdr', { lastSeen: 3 }], ['compare', 'pricing', { lastSeen: 3 }], ['case', 'contact', { lastSeen: 3 }], // lost in crawl 4
  ['b6', 'ir', { lastSeen: 2 }], // lost in crawl 3
  ['soc', 'compare', { since: 3 }], ['b5', 'soc', { since: 2 }],
  ['b1', 'webinar', { since: 4 }], // the webinar page was published a week before anyone linked to it
];
HISTORY.forEach(([from, to, patch]) => Object.assign(links.find((link) => link.from === from && link.to === to && link.placement === 'content'), patch));

// Editorial links that only existed in some crawls: [from, to, anchor, patch]
[
  ['mfg', 'ot', 'OT security', { lastSeen: 2 }], // the only link into OT security; it was an orphan from crawl 3
  ['b3', 'b8', 'ISO 27001 checklist', { since: 4 }], ['siem', 'ir', 'incident response', { since: 4 }],
  ['cloud', 'about', 'who we are', { since: 4 }], ['cloud', 'careers', 'join our cloud team', { since: 4 }], ['cloud', 'partners', 'our cloud partners', { since: 4 }],
  ['b8', 'b9', 'read more'], ['b6', 'b9', 'click here'],
].forEach(([from, to, anchor, patch]) => links.push({ id: `l${links.length + 1}`, from, to, anchor, placement: 'content', rel: 'follow', since: 1, lastSeen: 4, ...patch }));

// Links out of a page count once per target by placement order (content, auto-generated, template): keep that order
const PLACEMENT_RANK = { content: 0, auto_generated: 1 };
links.sort((a, b) => (PLACEMENT_RANK[a.placement] ?? 2) - (PLACEMENT_RANK[b.placement] ?? 2));

const pagesIn = (n) => pages.filter((page) => page.since <= n).length;

/** Crawl runs, newest first (spec 6.2); `n` is the order, 1 the oldest. The first came from adding the website. */
export const crawls = [
  { id: 'c4', n: 4, when: '14 Nov 2026, 02:10', short: '14 Nov', trigger: 'Schedule', state: 'ready', pages: pagesIn(4), cost: 0.006 },
  { id: 'c3', n: 3, when: '7 Nov 2026, 02:12', short: '7 Nov', trigger: 'Schedule', state: 'ready', pages: pagesIn(3), cost: 0.006 },
  { id: 'c2', n: 2, when: '31 Oct 2026, 16:40', short: '31 Oct', trigger: 'Manual', state: 'ready', pages: pagesIn(2), cost: 0.006 },
  { id: 'c1', n: 1, when: '30 Oct 2026, 11:05', short: '30 Oct', trigger: 'Manual', state: 'ready', pages: pagesIn(1), cost: 0.006 },
];

/** Project settings of the crawl (spec 7.8). alerts.channel is 'app', 'email' or 'slack'. */
export const crawlSettings = { schedule: 'weekly', renderJs: false, subdomains: '', mapOnAdd: true, alerts: { lostTop: true, maxPosition: 2, threshold: 1, channel: 'app' } };

// -------------------------------------------------------------------------------------------------
// Tracked keywords, AI citations and mentions (spec slices 2 and 3)

/** Tracked keywords: change is places moved since the last check (positive = improved); rank null = not in the top 100. */
const K = (keyword, page, rank, volume, change) => ({ keyword, page, rank, volume, change });
export const keywords = [
  K('soc as a service', 'soc', 4, 2900, 2), K('managed soc', 'soc', 7, 1600, -1), K('soc services india', 'soc', 9, 880, 3),
  K('vapt services', 'vapt', 5, 2400, 1), K('vapt service provider india', 'vapt', 8, 1300, -2),
  K('managed detection and response', 'mdr', 11, 3600, -3), K('mdr services india', 'mdr', 8, 1100, 2), K('managed xdr', 'mdr', null, 700, 0),
  K('managed siem', 'siem', 14, 1900, -1), K('siem as a service', 'siem', 19, 1000, -2),
  K('iso 27001 consultant', 'iso', 6, 2200, 2), K('iso 27001 certification cost', 'iso', 11, 1700, 1),
  K('pci dss compliance', 'pci', 13, 3100, -4), K('pci dss penetration testing', 'pci', 10, 800, 2),
  K('incident response retainer', 'ir', 18, 720, -2),
  K('cloud security posture management', 'cloud', 22, 2600, -5),
  K('ot security services', 'ot', 24, 320, 0),
  K('cyber security for banks', 'banking', 15, 880, 2), K('healthcare cybersecurity services', 'health', 26, 720, 1),
  K('in-house soc vs outsourced soc', 'compare', 10, 390, 1), K('eventus security', 'home', 1, 480, 0),
  K('what is a soc', 'b1', 3, 5400, 1), K('security operations center', 'b1', 12, 8100, -2),
  K('soc vs mdr', 'b2', 5, 1000, 3),
  K('vapt checklist', 'b3', 6, 1300, 0), K('vulnerability assessment checklist', 'b3', 14, 900, 1),
  K('siem use cases', 'b4', 8, 1500, 2),
  K('rbi cyber security framework', 'b5', 4, 2100, 1), K('rbi cyber security guidelines', 'b5', 9, 1200, -1),
  K('incident response plan template', 'b6', 7, 2700, -2),
  K('cloud misconfigurations', 'b7', 12, 590, 4),
  K('iso 27001 checklist', 'b8', 9, 1900, -3),
].map((row, index) => ({ id: `k${index + 1}`, ...row }));

/** AI answers that cited the page in the last 28 days, per engine. Pages that are not listed have none. */
export const citations = [
  { page: 'b1', chatgpt: 14, gemini: 9, aimode: 6 }, { page: 'soc', chatgpt: 11, gemini: 8, aimode: 7 }, { page: 'vapt', chatgpt: 8, gemini: 5, aimode: 4 },
  { page: 'b2', chatgpt: 7, gemini: 4, aimode: 3 }, { page: 'b5', chatgpt: 6, gemini: 5, aimode: 4 }, { page: 'iso', chatgpt: 5, gemini: 3, aimode: 2 },
  { page: 'mdr', chatgpt: 5, gemini: 4, aimode: 3 }, { page: 'b3', chatgpt: 4, gemini: 2, aimode: 2 }, { page: 'pci', chatgpt: 3, gemini: 2, aimode: 1 },
  { page: 'banking', chatgpt: 3, gemini: 1, aimode: 2 }, { page: 'siem', chatgpt: 2, gemini: 2, aimode: 1 }, { page: 'b8', chatgpt: 2, gemini: 1, aimode: 1 },
  { page: 'ir', chatgpt: 2, gemini: 1, aimode: 0 }, { page: 'compare', chatgpt: 1, gemini: 1, aimode: 0 },
];

/**
 * Where a page's text mentions a topic that another page covers (the real feature reads the text, spec slice 3).
 * `page` mentions `phrase`, which `target` is about. Some of these pages already link there by an editorial link.
 */
export const mentions = [
  { page: 'b4', phrase: 'incident response retainer', target: 'ir', context: 'Teams without an incident response retainer often lose a full day just finding the right people to call.' },
  { page: 'b3', phrase: 'ISO 27001', target: 'iso', context: 'Many buyers now ask for ISO 27001 evidence before they accept a test report from a new vendor.' },
  { page: 'b7', phrase: 'managed detection and response', target: 'mdr', context: 'A managed detection and response team can catch these misconfigurations within hours instead of weeks.' },
  { page: 'b8', phrase: 'PCI DSS', target: 'pci', context: 'The card data controls in PCI DSS overlap with several ISO 27001 Annex A requirements.' },
  { page: 'banking', phrase: 'managed SIEM', target: 'siem', context: 'Banks that run a managed SIEM get one view of branch, cloud and card system logs.' },
  { page: 'health', phrase: 'VAPT', target: 'vapt', context: 'A yearly VAPT cycle covers patient portals, medical devices and the hospital network behind them.' },
  { page: 'b2', phrase: 'pricing', target: 'pricing', context: 'Teams usually compare pricing first, but staffing and tooling costs matter more over three years.' },
  { page: 'b2', phrase: 'managed detection and response', target: 'mdr', context: 'Managed detection and response adds active containment to the alerts that a SOC alone provides.' },
  { page: 'case', phrase: 'cloud security', target: 'cloud', context: 'After the pilot, the bank also asked for cloud security reviews of every new workload it launched.' },
  { page: 'b5', phrase: 'incident response', target: 'ir', context: 'The framework expects a tested incident response process and a report to the regulator within hours.' },
  { page: 'webinar', phrase: 'managed SIEM', target: 'siem', context: 'We also show how a managed SIEM feeds the maturity model that we use throughout the session.' },
  { page: 'about', phrase: 'contact our team', target: 'contact', context: 'If you want to discuss a project, contact our team and we reply to every request within a day.' },
  { page: 'b1', phrase: 'in-house SOC', target: 'compare', context: 'Some firms ask whether an in-house SOC costs less than a managed one once night shifts are counted.' },
  { page: 'b9', phrase: 'SOC as a service', target: 'soc', context: 'Several ransomware crews hit firms that had no SOC as a service watching their network at night.' },
  { page: 'b1', phrase: 'managed SIEM', target: 'siem', context: 'Most providers pair a SOC with a managed SIEM that collects and correlates the logs for analysts.' },
  { page: 'soc', phrase: 'managed detection and response', target: 'mdr', context: 'Some customers add managed detection and response to get containment as well as alerts from the SOC.' },
  { page: 'home', phrase: 'VAPT', target: 'vapt', context: 'Our VAPT team tests applications, networks and cloud accounts against the attack paths criminals use.' },
  { page: 'mfg', phrase: 'cloud security', target: 'cloud', context: 'Plants that move data to the cloud need cloud security reviews of every new connection they add.' },
  { page: 'banking', phrase: 'PCI DSS', target: 'pci', context: 'Card issuers and acquirers in India must prove PCI DSS controls to their partner banks each year.' },
  { page: 'b3', phrase: 'VAPT services', target: 'vapt', context: 'Our VAPT services follow this checklist and add a free retest once the critical fixes are done.' },
];
