// The checks a node runs in CI before it publishes (#12): its schemas and
// examples are valid, its release snapshots match the sources, an exact
// version already online did not change, and no model redefines a term of a
// model it extends. Other nodes that cannot be reached are noted and skipped:
// a node that is down never fails someone else's build (docs/node.md, section 5).
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buildNode } from './node.mjs';
import { catalogUrls } from './urls.mjs';
import { verifyRelease } from './releases.mjs';

/** The term definitions of an @context (object or array; imported URLs are not followed). */
export function contextDefs(context) {
  return Object.assign({}, ...(Array.isArray(context) ? context : [context]).filter((p) => p && typeof p === 'object'));
}

/**
 * The terms of an @context with their full IRIs. `inherited`: definitions of
 * a context it imports, for prefixes it uses but does not define itself.
 */
export function contextTerms(context, inherited = {}) {
  const own = contextDefs(context);
  const defs = { ...inherited, ...own };
  const raw = (v) => (typeof v === 'string' ? v : v?.['@id']);
  const expand = (iri) => {
    if (typeof iri !== 'string') return undefined;
    const i = iri.indexOf(':');
    const prefix = i > 0 ? raw(defs[iri.slice(0, i)]) : undefined;
    return prefix && !iri.slice(i + 1).startsWith('//') ? prefix + iri.slice(i + 1) : iri;
  };
  return new Map(Object.keys(own).filter((k) => !k.startsWith('@')).map((k) => [k, expand(raw(defs[k]))]).filter(([, v]) => v));
}

/**
 * Check the node in `dir`. Options: `offline` skips what needs the network
 * (the published files, the models it extends, schemas on other sites);
 * `fetch` for tests; `timeout` per request in ms. Returns { problems, notes }: any problem fails the check.
 */
export async function checkNode(dir, { offline = false, fetch: fetchUrl = globalThis.fetch, timeout = 20000 } = {}) {
  // A node that hangs is treated like one that is down: noted, not waited for.
  const fetch = (url) => fetchUrl(url, { signal: AbortSignal.timeout(timeout) });
  const problems = [];
  const notes = [];
  const out = await mkdtemp(join(tmpdir(), 'datamodels-check-'));
  try {
    let built;
    try { built = await buildNode(dir, { out, pages: false }); } catch (e) { return { problems: [e.message], notes }; }
    const { node, subjects, exactPaths } = built;
    const urls = catalogUrls(node.baseUrl, { iris: node.iris });
    const getJson = async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return res.json();
    };

    // Schemas and examples. A schema of this node is read from the build; one on another site only online.
    const ajv = new Ajv2020({ allErrors: true, strict: false, loadSchema: async (uri) => {
      if (uri.startsWith(`${urls.baseUrl}/`)) return JSON.parse(await readFile(join(out, uri.slice(urls.baseUrl.length + 1)), 'utf8'));
      if (offline) throw new Error(`${uri} is on another site (not read with --offline)`);
      return getJson(uri);
    } });
    addFormats(ajv);
    for (const s of subjects) for (const m of s.models) {
      const where = `${s.name}/${m.type}`;
      let validate;
      try { validate = await ajv.compileAsync(m.schema); } catch (e) { problems.push(`${where}/schema.json: ${e.message}`); continue; }
      if (m.examples['example.json'] && !validate(m.examples['example.json'])) problems.push(`${where}/examples/example.json: ${ajv.errorsText(validate.errors)}`);
    }

    // Release snapshots (models/<subject>/releases/vX.Y.Z/), where the node keeps them.
    for (const s of subjects) problems.push(...await verifyRelease(s, { urls, languages: node.languages }));

    if (offline) { notes.push('offline: the published files and the models this node extends were not checked'); return { problems, notes }; }

    // An exact version that is already online must be served unchanged; one that is not online yet is new.
    for (const path of exactPaths) {
      const url = `${urls.baseUrl}${path}`;
      let res;
      try { res = await fetch(url); } catch (e) { notes.push(`${url}: not reachable (${e.cause?.code ?? e.message}), not compared`); continue; }
      if (res.status === 404) continue;
      if (!res.ok) { notes.push(`${url}: HTTP ${res.status}, not compared`); continue; }
      const online = Buffer.from(await res.arrayBuffer());
      if (!online.equals(await readFile(join(out, path.slice(1))))) problems.push(`${url}: a published version changed. A published file never changes; give the subject a new version instead.`);
    }

    // Terms of an extended model keep their IRIs here.
    const indexes = new Map();
    for (const s of subjects) {
      for (const m of s.models) for (const ext of m.catalog?.extends ?? []) {
        const where = `${s.name}/${m.type}: extends ${ext.typeIri} v${ext.version}`;
        try {
          if (!indexes.has(ext.index)) indexes.set(ext.index, getJson(ext.index));
          const index = await indexes.get(ext.index);
          const entry = (index.models ?? []).find((e) => e.typeIri === ext.typeIri && e.version === ext.version);
          if (!entry) { problems.push(`${where}: not listed in ${ext.index}`); continue; }
          const theirContext = (await getJson(entry.contextUrl))['@context'];
          const theirs = contextTerms(theirContext);
          // Prefixes of the extended context may be used here without being defined again.
          const ours = contextTerms(s.context['@context'], contextDefs(theirContext));
          for (const [term, iri] of ours) if (theirs.has(term) && theirs.get(term) !== iri) problems.push(`${where}: redefines ${term} (${theirs.get(term)} there, ${iri} here)`);
        } catch (e) {
          notes.push(`${where}: not checked, ${e.cause?.code ?? e.message}`);
        }
      }
    }
    return { problems, notes };
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}
