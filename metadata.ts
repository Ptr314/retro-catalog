/**
 * programs.metadata: free-form "key:value" lines, written mostly by integrations.
 * This is the only parser on the server side — emulator templates ({meta:key}) and the
 * search haystack both read through it. catalog_db.py holds the importer's copy.
 */

/** Keys are lowercased; a line is split at its first colon, so values may contain colons (URLs). */
export function parseMetadata(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key && value) out.set(key, value);
  }
  return out;
}

/** What search should find: the values, minus links — every row has those and nobody types them. */
export function metadataSearchText(text: string): string {
  return [...parseMetadata(text).values()].filter((value) => !/^https?:\/\//i.test(value)).join(' ');
}
