/**
 * The other names to store for an entity, as word aliases: each once whatever its case, and not its own
 * name, which the matcher already finds by itself (doc 13 stage 4, `match_method: 'alias_name'`).
 */
export function otherNames(name: string, others: readonly string[]): string[] {
  const seen = new Set<string>([name.trim().toLocaleLowerCase()]);
  return others
    .map((alias) => alias.trim())
    .filter((alias) => {
      const key = alias.toLocaleLowerCase();
      if (alias === '' || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
