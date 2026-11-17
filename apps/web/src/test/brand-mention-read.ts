/**
 * Whether a summary request is the read of the Overview hooks that carries the entity cells of the topic rows and the
 * total (`rows=topics` with `include=entities`), which gives share of voice its brand-mention counts. A test that counts
 * the page's own summary requests leaves it out.
 */
export const isBrandMentionRead = (url: URL): boolean =>
  url.searchParams.get('rows') === 'topics' &&
  url.searchParams
    .getAll('include')
    .flatMap((value) => value.split(','))
    .includes('entities');
