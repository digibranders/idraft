import type { LinkGraph } from '@/lib/internal-links/types';

/**
 * A small crawl for the Link map: a home page, two money pages, a hub with three posts, two case studies that link
 * to the same guides, and four pages no body link reaches. `tierIds` are the workspace's tiers in order (T1 first).
 */
export function linkGraphFixture(runId: string, tierIds: readonly string[], includeAuto: boolean): LinkGraph {
  const [t1, t2, t3, t4] = tierIds;
  const node = (
    url_id: string,
    path: string,
    title: string,
    tier_id: string | undefined,
    links_in: number,
    links_out: number,
    sitewide_from = 0,
  ): LinkGraph['nodes'][number] => ({ url_id, path, title, tier_id: tier_id ?? null, links_in, links_out, sitewide_from });
  const edge = (source: string, target: string, links = 1): LinkGraph['edges'][number] => ({ source, target, links });
  const edges = [
    edge('1', '2'),
    edge('1', '3'),
    edge('4', '5'),
    edge('4', '6'),
    edge('4', '7'),
    edge('5', '2'),
    edge('8', '2'),
    edge('8', '10'),
    edge('8', '11'),
    edge('9', '2'),
    edge('9', '10'),
    edge('9', '11'),
    edge('10', '3', 2),
    ...(includeAuto ? [edge('5', '6'), edge('6', '5')] : []),
  ];
  const count = (id: string, end: 'source' | 'target'): number => edges.filter((item) => item[end] === id).length;
  const page = (id: string, path: string, title: string, tier: string | undefined, sitewide = 0) =>
    node(id, path, title, tier, count(id, 'target'), count(id, 'source'), sitewide);
  return {
    run_id: runId,
    include_auto: includeAuto,
    pages_total: 15,
    truncated: false,
    home_url_id: '1',
    nodes: [
      page('1', '/', 'Eventus Security', t1, 14),
      page('2', '/managed-soc-service', 'Managed SOC service', t1, 14),
      page('3', '/incident-response', 'Incident response', t1, 14),
      page('4', '/blog', 'Blog', t2, 14),
      page('5', '/blog/soc-modernization', 'Why SOC modernization matters', t3),
      page('6', '/blog/ransomware-groups', 'Five ransomware groups', t3),
      page('7', '/blog/ai-in-the-soc', 'AI in the SOC', t3),
      page('8', '/india/bfsi/case-study/digital-bank', 'Digital bank case study', t2),
      page('9', '/india/bfsi/case-study/stockbroker', 'Stockbroker case study', t2),
      page('10', '/cybersecurity/soc/siem', 'What is SIEM?', t3),
      page('11', '/cybersecurity/soc/soar', 'What is SOAR?', t3),
      page('12', '/cybersecurity/soc/edr', 'What is EDR?', t3),
      page('13', '/cybersecurity/threat-hunting', 'What is threat hunting?', t3),
      page('14', '/privacy-policy', 'Privacy policy', t4, 14),
      page('15', '/old-landing', 'Old landing page', undefined),
    ],
    edges,
  };
}
