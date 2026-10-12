// What a host other than GitHub Pages needs to serve a node as GitHub Pages
// does (#51): the content type of each kind of file, CORS, and the IRI
// redirects of slash IRIs. build writes them as `_headers` and `_redirects`,
// the files Cloudflare (Pages and Workers static assets) and Netlify read from
// the folder they publish. GitHub Pages ignores both: it sends CORS and picks
// the same types from the file extension (application/json for schemas), and
// it cannot redirect, so slash IRIs there need w3id.org. The 404 page
// (404.html) needs no file: Cloudflare Pages and Netlify serve it for an
// address with no page, Workers static assets with not_found_handling: 404-page.

// [path pattern, content type]. Patterns that both hosts read the same way:
// a `*` only at the end (it matches the rest of the path, folders included;
// Netlify may not match `*` before an extension) and `:name` for one folder.
// Each folder holds one kind of file, so one rule each; no two rules match
// the same file, so no header is sent twice (Cloudflare would join them).
const TYPES = [
  ['/catalog.json', 'application/json'],
  ['/llms.txt', 'text/plain'],
  ['/context/*', 'application/ld+json'],
  ['/vocab/*', 'application/ld+json'],
  ['/schema/*', 'application/schema+json'],
  ['/examples/:subject/:type/example.json', 'application/json'],
  ['/examples/:subject/:type/example-normalized.jsonld', 'application/ld+json'],
  ['/mapping/*', 'application/yaml'],
  ['/adapters/csv/*', 'text/csv'],
  ['/adapters/table-schema/*', 'application/json'],
  ['/adapters/ai/*', 'application/json'],
  ['/adapters/postgis/*', 'application/sql'],
];

/** The `_headers` file of a node: CORS for every file, and the content type of each machine-readable one. */
export function headersFile() {
  return [
    '# Response headers of this data model node, written by datamodels build.',
    '# Cloudflare (Pages, Workers static assets) and Netlify read this file;',
    '# GitHub Pages ignores it and picks the types from the file extension.',
    '#',
    '# Browsers and JSON-LD processors read contexts and schemas from other',
    '# sites, so CORS is open for every file. Nothing here is private.',
    '/*',
    '  Access-Control-Allow-Origin: *',
    '  X-Content-Type-Options: nosniff',
    '',
    ...TYPES.flatMap(([path, type]) => [path, `  Content-Type: ${type}; charset=utf-8`]),
    '',
  ].join('\n');
}

// Cloudflare (Pages and Workers static assets) accepts at most 2,000 static
// redirects in `_redirects` (all of ours are static); Netlify has no such limit.
export const CLOUDFLARE_REDIRECTS = 2000;

/** A note for build when Cloudflare would ignore some of the redirects, or null. */
export function redirectsNote(count) {
  if (count <= CLOUDFLARE_REDIRECTS) return null;
  return `_redirects has ${count} IRI redirects; Cloudflare Pages and Workers accept at most ${CLOUDFLARE_REDIRECTS}. On Cloudflare, add the rest as Bulk Redirects, or use hash IRIs.`;
}

/**
 * The `_redirects` file for the [from, to] paths of buildNode() (slash IRIs:
 * each IRI to the page that documents it), or null when there are none (hash
 * IRIs). 302, not 301, so a node can still change where its IRIs lead.
 */
export function redirectsFile(redirects) {
  if (!redirects.length) return null;
  return [
    '# Redirects of this data model node, written by datamodels build: each IRI',
    '# (slash IRIs) leads to the page that documents it. Cloudflare and Netlify',
    '# read this file; on another host, turn these lines into its redirect rules.',
    ...redirects.map(([from, to]) => `${from} ${to} 302`),
    '',
  ].join('\n');
}
