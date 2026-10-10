// The checks a node runs in CI before it publishes (#12): its schemas and
// examples are valid, every type and attribute is a term of its @context with
// the same IRI (#26), its release snapshots match the sources, an exact
// version already online did not change, and no model redefines a term of a
// model it extends. Other nodes that cannot be reached are noted and skipped:
// a node that is down never fails someone else's build (docs/node.md, section 5).
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buildNode } from './node.mjs';
import { catalogUrls } from './urls.mjs';

// A schema on another site that could not be read: noted and skipped, never a problem of this node.
class Unavailable extends Error {}

// The NGSI-LD core context (v1.8): every broker knows its terms (location,
// observedAt, …) without a node defining them, and they cannot be redefined.
const CORE_CONTEXT = JSON.parse(readFileSync(new URL('./ngsi-ld-core-context-v1.8.jsonld', import.meta.url), 'utf8'))['@context'];

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

const FULL_IRI = /^(https?|urn):/;

/**
 * Every type and attribute of a subject's models is a term of its @context and
 * expands to the model's IRI for it: otherwise JSON-LD drops the attribute, or
 * gives it another meaning than the schema and the pages say. `imported`: the
 * term definitions of the contexts it imports by URL, or null when they could
 * not be read (then a term that is not found is only noted). Returns { problems, notes }.
 */
export function termProblems(subject, urls, imported = {}) {
  const problems = [];
  const notes = [];
  const context = subject.context['@context'];
  const core = contextTerms(CORE_CONTEXT);
  const own = contextTerms(context, imported ?? {});
  const known = new Map([...core, ...(imported ? contextTerms(imported) : []), ...own]);
  const ctx = `${subject.name}/context.jsonld`;
  for (const [term, iri] of own) if (core.has(term) && core.get(term) !== iri) problems.push(`${ctx}: redefines the NGSI-LD core term ${term} (${core.get(term)})`);
  // A term found nowhere: a problem, unless it may be in an imported context that could not be read.
  const missing = (where, what) => (imported ? problems : notes).push(`${where}: ${what} is not in the @context${imported ? '' : ', or in a context it imports that could not be read'}`);
  const expandsTo = (where, name, iri, expected) => {
    if (!FULL_IRI.test(iri)) (imported ? problems : notes).push(`${where}: the @context maps ${name} to ${iri}, which is not a full IRI (is its prefix defined?)`);
    else if (iri !== expected) problems.push(`${where}: ${name} is ${expected ?? '(no x-iri)'} in the schema, but the @context expands it to ${iri}`);
  };
  for (const m of subject.models) {
    const where = `${subject.name}/${m.type}`;
    if (m.kind === 'entity') {
      if (!known.has(m.type)) missing(where, `the type ${m.type}`);
      else expandsTo(where, m.type, known.get(m.type), urls.modelUrls(subject, m).typeIri);
    }
    for (const [name, prop] of Object.entries(m.schema.properties ?? {})) {
      if (name === 'id' || name === 'type') continue;
      if (!known.has(name)) missing(where, `the attribute ${name}`);
      else expandsTo(where, name, known.get(name), prop?.['x-iri']);
    }
  }
  return { problems, notes };
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
    // The build also stops on a release snapshot (models/<subject>/releases/vX.Y.Z/) that differs from the sources.
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
      if (offline) throw new Unavailable(`${uri} is on another site, not read with --offline`);
      try { return await getJson(uri); } catch (e) { throw new Unavailable(`${uri} could not be read (${e.cause?.code ?? e.message})`); }
    } });
    addFormats(ajv);
    for (const s of subjects) for (const m of s.models) {
      const where = `${s.name}/${m.type}`;
      let validate;
      // A schema another one referenced is already loaded (from the build, the same bytes): use it.
      try { validate = (m.schema.$id && ajv.getSchema(m.schema.$id)) || await ajv.compileAsync(m.schema); } catch (e) {
        if (e instanceof Unavailable) notes.push(`${where}/schema.json: not validated, ${e.message}`); else problems.push(`${where}/schema.json: ${e.message}`);
        continue;
      }
      if (m.examples['example.json'] && !validate(m.examples['example.json'])) problems.push(`${where}/examples/example.json: ${ajv.errorsText(validate.errors)}`);
    }

    // Types and attributes against the @context; contexts it imports by URL are read online only.
    for (const s of subjects) {
      const imports = [s.context['@context']].flat().filter((p) => typeof p === 'string');
      let imported = {};
      for (const url of imports) {
        if (offline) { imported = null; break; }
        try {
          const theirs = (await getJson(url))?.['@context'];
          if (theirs == null || typeof theirs !== 'object') throw new Error('no term definitions');
          imported = { ...imported, ...contextDefs(theirs) };
        } catch (e) { notes.push(`${s.name}/context.jsonld: ${url} could not be read (${e.cause?.code ?? e.message})`); imported = null; break; }
      }
      const found = termProblems(s, urls, imported);
      problems.push(...found.problems);
      notes.push(...found.notes);
    }

    if (offline) { notes.push('offline: the published files and the models this node extends were not checked'); return { problems, notes }; }

    // An exact version that is already online must be served unchanged; one that is not online yet is new.
    for (const path of exactPaths) {
      const url = `${urls.baseUrl}${path}`;
      let online;
      try {
        const res = await fetch(url);
        if (res.status === 404) continue;
        if (!res.ok) { notes.push(`${url}: HTTP ${res.status}, not compared`); continue; }
        // The body too: a server can send its headers and then stall or break off.
        online = Buffer.from(await res.arrayBuffer());
      } catch (e) { notes.push(`${url}: not reachable (${e.cause?.code ?? e.message}), not compared`); continue; }
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
          const entry = (index.models ?? []).find((e) => e.typeIri === ext.typeIri);
          if (!entry) { problems.push(`${where}: not listed in ${ext.index}`); continue; }
          // An index lists the current version; an older one is at the same path with its own version (docs/node.md, section 1).
          const contextUrl = entry.version === ext.version ? entry.contextUrl : entry.contextUrl.replace(`/v${entry.version}.jsonld`, `/v${ext.version}.jsonld`);
          if (contextUrl === entry.contextUrl && entry.version !== ext.version) { notes.push(`${where}: not checked, ${ext.index} lists v${entry.version} and the @context of v${ext.version} could not be found`); continue; }
          const theirContext = (await getJson(contextUrl))?.['@context'];
          // A context file without @context would make every term look new, so nothing could be compared.
          if (theirContext == null) { problems.push(`${where}: ${contextUrl} has no @context`); continue; }
          if (typeof theirContext !== 'object') { notes.push(`${where}: not checked, the @context of ${contextUrl} only imports another one`); continue; }
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
