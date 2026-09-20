/**
 * Top-level paths the router owns. A family slug may never collide with one:
 * /<family> is registered last and would otherwise shadow them.
 */
export const RESERVED_SLUGS = new Set([
  'p',
  'dl',
  'run',
  'files',
  'screenshots',
  'static',
  'admin',
  'health',
  'catalog',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
  'api',
  'search',
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}
