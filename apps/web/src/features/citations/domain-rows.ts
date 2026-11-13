import type { CitationRead } from './citation-reads';
import type { RowTree } from '@/components/app/data-table/types';
import type { SourceDomainRow, SourcePagePage, SourcePageRow } from '@/lib/citations/types';

/**
 * The rows of the Domains table: a tree of two levels. A domain is a level 1 row that opens onto its top pages
 * (level 2), then a "View all N pages" row when it has more, or a row that says its pages are loading or could
 * not be loaded. Pure: the data the reads gave, in display order, with the tree facts the table asks for.
 */

/** The pages a domain opens onto; more than these is one "View all" row. */
export const PAGES_PER_DOMAIN = 10;

/** A domain, one of its pages, the row that opens all of them, or the row that stands in while they cannot be listed. */
export type CitationTableRow =
  | { kind: 'domain'; id: string; domain: SourceDomainRow }
  | { kind: 'page'; id: string; parentId: string; page: SourcePageRow }
  | { kind: 'more'; id: string; parentId: string; registrable: string; total: number }
  | { kind: 'pages-loading' | 'pages-failed'; id: string; parentId: string };

/** The read of one domain's pages: what it has, and whether it is on its way or failed. */
export type ChildPagesRead = Pick<CitationRead<SourcePagePage>, 'status' | 'data'>;

/**
 * A domain row's id: its registrable domain, its role and the entity whose rule matched. One registrable domain
 * can have several rows (the same host matched by a competitor's rule and as a third party), so the domain alone
 * is not an id.
 */
export const domainRowId = (domain: SourceDomainRow): string =>
  `${domain.registrable_domain}|${domain.domain_role}|${domain.role_entity_id ?? ''}`;

export interface CitationRows {
  /** In display order: each domain, and right under an open one its pages. */
  rows: readonly CitationTableRow[];
  /** The tree facts of each row, by row id (`DataTable`'s `rowTree`). */
  tree: ReadonlyMap<string, RowTree>;
}

/** The rows under an open domain, from what its read has. Pages already read stay, whatever a later read did. */
function childRows(domain: SourceDomainRow, parentId: string, read: ChildPagesRead | undefined): CitationTableRow[] {
  if (read?.data === undefined) {
    const kind = read?.status === 'error' ? 'pages-failed' : 'pages-loading';
    return [{ kind, id: `${parentId}|${kind}`, parentId }];
  }
  const { data, page } = read.data;
  const rows = data.map((entry): CitationTableRow => ({
    kind: 'page',
    id: `${parentId}|page|${entry.url_id}`,
    parentId,
    page: entry,
  }));
  if (page.total > data.length) {
    rows.push({
      kind: 'more',
      id: `${parentId}|more`,
      parentId,
      registrable: domain.registrable_domain,
      total: page.total,
    });
  }
  return rows;
}

/**
 * `domains` are the rows the server gave, in its order. `expanded` holds the ids of the open domains, and
 * `childReads` the read of each one's pages (by the domain's row id): a read that has not started is on its way.
 */
export function buildRows(
  domains: readonly SourceDomainRow[],
  expanded: ReadonlySet<string>,
  childReads: ReadonlyMap<string, ChildPagesRead>,
): CitationRows {
  const rows: CitationTableRow[] = [];
  const tree = new Map<string, RowTree>();
  domains.forEach((domain, index) => {
    const id = domainRowId(domain);
    const open = expanded.has(id);
    rows.push({ kind: 'domain', id, domain });
    tree.set(id, { level: 1, expanded: open, setSize: domains.length, posInSet: index + 1 });
    if (!open) return;
    const children = childRows(domain, id, childReads.get(id));
    children.forEach((child, place) => {
      rows.push(child);
      tree.set(child.id, {
        level: 2,
        setSize: children.length,
        posInSet: place + 1,
        // Only a page is a row to choose; the rest stand in for pages
        ...(child.kind === 'page' ? {} : { selectable: false }),
      });
    });
  });
  return { rows, tree };
}
